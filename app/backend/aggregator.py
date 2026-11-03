"""
Events Aggregator for TwoDo
Orchestrates multi-source data ingestion, deduplication, database persistence,
collaborative couple voting stats, date-range filtering, and planner integration.
"""
import concurrent.futures
import json
import logging
import re
from datetime import datetime, timedelta
from .database import get_connection, get_couple_profile
from .sources.curated_seeds import get_base_seeds, generate_dynamic_city_activities
from .sources.brisbane_mega_catalog import get_brisbane_mega_catalog
from .sources.ticketmaster import fetch_ticketmaster_events
from .sources.openstreetmap import fetch_osm_attractions
from .sources.eventbrite import fetch_eventbrite_events
from .sources.web_search import fetch_web_events

logger = logging.getLogger("twodo.aggregator")

def sync_events_to_db(events_list):
    if not events_list:
        return

    conn = get_connection()
    now_str = datetime.now().isoformat()
    
    with conn:
        for ev in events_list:
            tags_json = json.dumps(ev.get("tags", [])) if isinstance(ev.get("tags"), list) else ev.get("tags", "[]")
            conn.execute("""
            INSERT INTO events (
                id, title, description, category, source, source_url, image_url,
                location_name, city, lat, lng, start_date, end_date, time_str,
                price_level, price_str, tags, insider_tip, is_custom, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                description = excluded.description,
                category = excluded.category,
                image_url = excluded.image_url,
                time_str = excluded.time_str,
                price_str = excluded.price_str,
                price_level = excluded.price_level,
                tags = excluded.tags,
                insider_tip = excluded.insider_tip
            """, (
                ev["id"],
                ev["title"],
                ev.get("description", ""),
                ev.get("category", "General"),
                ev.get("source", "Web"),
                ev.get("source_url", ""),
                ev.get("image_url", ""),
                ev.get("location_name", ""),
                ev.get("city", ""),
                ev.get("lat"),
                ev.get("lng"),
                ev.get("start_date", ""),
                ev.get("end_date", ""),
                ev.get("time_str", ""),
                ev.get("price_level", "$$"),
                ev.get("price_str", ""),
                tags_json,
                ev.get("insider_tip", ""),
                ev.get("is_custom", 0),
                now_str
            ))
    conn.close()

def fetch_all_sources(city="Brisbane", lat=None, lng=None, api_keys=None):
    if api_keys is None:
        profile = get_couple_profile()
        try:
            api_keys = json.loads(profile.get("api_keys_json", "{}"))
        except Exception:
            api_keys = {}

    all_events = []
    clean_city = city.strip().title()

    # 1. Base curated & cultural seeds matching city
    base_seeds = get_base_seeds()
    city_matches = [e for e in base_seeds if clean_city.lower() in e["city"].lower() or e["city"].lower() in clean_city.lower()]
    all_events.extend(city_matches)

    # 1b. Brisbane Mega Catalog (Extensive viral food, Reddit secrets, sports, workshops)
    if "brisbane" in clean_city.lower():
        all_events.extend(get_brisbane_mega_catalog())

    # 2. Dynamic City Activities tailored for this city
    dynamic_items = generate_dynamic_city_activities(clean_city, lat=lat, lng=lng)
    all_events.extend(dynamic_items)

    # 3. Concurrent network fetching (Ticketmaster, OSM, Eventbrite, Web Search)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        f_tm = executor.submit(fetch_ticketmaster_events, clean_city, lat, lng, api_keys.get("ticketmaster"))
        f_osm = executor.submit(fetch_osm_attractions, clean_city, lat, lng)
        f_eb = executor.submit(fetch_eventbrite_events, clean_city, lat, lng, api_keys.get("eventbrite"))
        f_web = executor.submit(fetch_web_events, clean_city, lat, lng)

        for future in concurrent.futures.as_completed([f_tm, f_osm, f_eb, f_web], timeout=6):
            try:
                res = future.result()
                if res:
                    all_events.extend(res)
            except Exception as e:
                logger.debug(f"Source fetcher error: {e}")

    # Deduplicate by ID and Title
    seen_ids = set()
    seen_titles = set()
    deduped = []
    for ev in all_events:
        t_key = ev["title"].strip().lower()
        if ev["id"] not in seen_ids and t_key not in seen_titles:
            seen_ids.add(ev["id"])
            seen_titles.add(t_key)
            deduped.append(ev)

    # Sync to DB
    sync_events_to_db(deduped)
    return deduped

def is_in_date_range(ev_date_str, date_range, custom_start=None, custom_end=None):
    if not date_range or date_range == 'all':
        return True
    
    if not ev_date_str:
        return True
    
    match = re.search(r'(\d{4}-\d{2}-\d{2})', ev_date_str)
    if not match:
        # Flexible string like "Open daily" or "Daily until sunset"
        return True
    
    try:
        ev_date = datetime.strptime(match.group(1), "%Y-%m-%d").date()
    except Exception:
        return True

    today = datetime.now().date()
    
    if date_range == 'today':
        return ev_date == today
    elif date_range == 'tomorrow':
        return ev_date == (today + timedelta(days=1))
    elif date_range == 'this_weekend':
        # Friday (weekday 4), Saturday (weekday 5), Sunday (weekday 6)
        if today.weekday() in [4, 5, 6]:
            fri = today - timedelta(days=(today.weekday() - 4))
        else:
            days_to_fri = (4 - today.weekday()) % 7
            fri = today + timedelta(days=days_to_fri)
        sun = fri + timedelta(days=2)
        return fri <= ev_date <= sun
    elif date_range == 'next_7_days':
        return today <= ev_date <= (today + timedelta(days=7))
    elif date_range == 'this_month':
        return today <= ev_date <= (today + timedelta(days=30))
    elif date_range == 'custom':
        if custom_start and custom_end:
            try:
                s = datetime.strptime(custom_start, "%Y-%m-%d").date()
                e = datetime.strptime(custom_end, "%Y-%m-%d").date()
                return s <= ev_date <= e
            except Exception:
                pass
        return True
        
    return True

def get_enriched_events(city=None, category=None, search=None, vote_filter=None, date_range='all', custom_start=None, custom_end=None, suburb=None, vibe=None, current_user="Emma"):
    conn = get_connection()
    profile = get_couple_profile()
    u1 = profile.get("user1_name", "Emma")
    u2 = profile.get("user2_name", "Jordan")

    query = """
    SELECT 
        e.*,
        v1.vote as u1_vote,
        v2.vote as u2_vote,
        p.id as planner_id,
        p.status as planner_status,
        p.scheduled_date as planner_date,
        p.time_slot as planner_slot,
        p.notes as planner_notes,
        p.budget as planner_budget
    FROM events e
    LEFT JOIN votes v1 ON e.id = v1.event_id AND v1.user_name = ?
    LEFT JOIN votes v2 ON e.id = v2.event_id AND v2.user_name = ?
    LEFT JOIN planner_items p ON e.id = p.event_id
    WHERE 1=1
    """
    params = [u1, u2]

    if city and city.strip():
        query += " AND (LOWER(e.city) LIKE ? OR LOWER(e.location_name) LIKE ?)"
        c_param = f"%{city.strip().lower()}%"
        params.extend([c_param, c_param])

    if category and category != "All":
        query += " AND e.category = ?"
        params.append(category)

    if suburb and suburb != "All":
        query += " AND (LOWER(e.location_name) LIKE ? OR LOWER(e.tags) LIKE ? OR LOWER(e.title) LIKE ?)"
        sub_param = f"%{suburb.strip().lower()}%"
        params.extend([sub_param, sub_param, sub_param])

    if vibe and vibe != "All":
        query += " AND (LOWER(e.tags) LIKE ? OR LOWER(e.description) LIKE ? OR LOWER(e.title) LIKE ?)"
        v_param = f"%{vibe.strip().lower()}%"
        params.extend([v_param, v_param, v_param])

    if search and search.strip():
        query += " AND (LOWER(e.title) LIKE ? OR LOWER(e.description) LIKE ? OR LOWER(e.tags) LIKE ? OR LOWER(e.source) LIKE ?)"
        s_param = f"%{search.strip().lower()}%"
        params.extend([s_param, s_param, s_param, s_param])

    rows = conn.execute(query, params).fetchall()
    conn.close()

    results = []
    for r in rows:
        item = dict(r)
        
        try:
            item["tags"] = json.loads(item["tags"]) if item["tags"] else []
        except Exception:
            item["tags"] = []

        # Date Range Filter check
        if not is_in_date_range(item.get("start_date") or item.get("time_str"), date_range, custom_start, custom_end):
            continue

        v1 = item.get("u1_vote")
        v2 = item.get("u2_vote")
        
        is_match = False
        match_level = "none"
        if v1 == "love" and v2 == "love":
            is_match = True
            match_level = "double_love"
        elif (v1 in ["love", "maybe"]) and (v2 in ["love", "maybe"]):
            is_match = True
            match_level = "mutual_interest"
            
        item["is_match"] = is_match
        item["match_level"] = match_level
        item["user1_name"] = u1
        item["user2_name"] = u2

        if vote_filter == "matches" and not is_match:
            continue
        elif vote_filter == "user1_likes" and v1 != "love":
            continue
        elif vote_filter == "user2_likes" and v2 != "love":
            continue
        elif vote_filter == "in_planner" and not item.get("planner_id"):
            continue
        elif vote_filter == "unvoted":
            if v1 or v2:
                continue

        results.append(item)

    def sort_key(x):
        score = 0
        if x.get("match_level") == "double_love":
            score += 100
        elif x.get("match_level") == "mutual_interest":
            score += 50
        if x.get("planner_id"):
            score += 30
        if x.get("u1_vote") == "love" or x.get("u2_vote") == "love":
            score += 10
        return score

    results.sort(key=sort_key, reverse=True)
    return results

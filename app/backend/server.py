"""
TwoDo - Couple Adventure & Date Planner HTTP Server
Pure Python 3 implementation with REST API, SQLite, and static file serving.
"""
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import urllib.parse
import os
import mimetypes
import logging
from datetime import datetime

from .database import init_db, get_connection, get_couple_profile, update_couple_profile
from .aggregator import fetch_all_sources, get_enriched_events
from .utils import generate_ics_calendar, format_text_summary

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("twodo.server")

STATIC_DIR = os.path.join(os.path.dirname(__file__), "..", "static")

class TwoDoHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        logger.info("%s - %s", self.address_string(), format % args)

    def send_json(self, data, status=200):
        body = json.dumps(data, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, message, status=400):
        self.send_json({"error": message}, status=status)

    def read_json_body(self):
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            if content_length > 0:
                raw_data = self.rfile.read(content_length).decode("utf-8")
                return json.loads(raw_data)
        except Exception as e:
            logger.warning(f"Failed to parse JSON body: {e}")
        return {}

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path == "/api/profile":
            self.send_json(get_couple_profile())
            return

        if path == "/api/events":
            city = query.get("city", [None])[0]
            cat = query.get("category", [None])[0]
            search = query.get("search", [None])[0]
            vote_filter = query.get("filter", [None])[0]
            date_range = query.get("date_range", ["all"])[0]
            custom_start = query.get("custom_start", [None])[0]
            custom_end = query.get("custom_end", [None])[0]
            suburb = query.get("suburb", [None])[0]
            vibe = query.get("vibe", [None])[0]

            events = get_enriched_events(
                city=city, category=cat, search=search, vote_filter=vote_filter,
                date_range=date_range, custom_start=custom_start, custom_end=custom_end,
                suburb=suburb, vibe=vibe
            )
            if not events and city:
                fetch_all_sources(city=city)
                events = get_enriched_events(
                    city=city, category=cat, search=search, vote_filter=vote_filter,
                    date_range=date_range, custom_start=custom_start, custom_end=custom_end,
                    suburb=suburb, vibe=vibe
                )

            self.send_json({"events": events, "count": len(events)})
            return

        if path == "/api/sync/status":
            self.send_json({
                "status": "active",
                "auto_sync": True,
                "interval_hours": 6,
                "server_time": datetime.now().isoformat(),
                "city": get_couple_profile().get("default_city", "Brisbane")
            })
            return

        if path == "/api/planner":
            conn = get_connection()
            rows = conn.execute("""
            SELECT 
                p.*,
                e.title, e.description, e.category, e.source, e.source_url,
                e.image_url, e.location_name, e.city, e.price_str, e.insider_tip,
                e.tags, e.lat, e.lng
            FROM planner_items p
            JOIN events e ON p.event_id = e.id
            ORDER BY 
                CASE 
                    WHEN p.status = 'scheduled' AND p.scheduled_date IS NOT NULL THEN 1 
                    ELSE 2 
                END,
                p.scheduled_date ASC,
                p.created_at DESC
            """).fetchall()
            conn.close()

            items = []
            for r in rows:
                it = dict(r)
                try:
                    it["tags"] = json.loads(it["tags"]) if it["tags"] else []
                except Exception:
                    it["tags"] = []
                items.append(it)

            self.send_json({"items": items, "count": len(items)})
            return

        if path == "/api/export/ics":
            conn = get_connection()
            rows = conn.execute("""
            SELECT p.*, e.title, e.description, e.location_name, e.insider_tip
            FROM planner_items p
            JOIN events e ON p.event_id = e.id
            WHERE p.status = 'scheduled' AND p.scheduled_date IS NOT NULL
            ORDER BY p.scheduled_date ASC
            """).fetchall()
            conn.close()

            profile = get_couple_profile()
            couple_names = f"{profile.get('user1_name', 'Partner 1')} & {profile.get('user2_name', 'Partner 2')}"
            ics_text = generate_ics_calendar([dict(r) for r in rows], couple_names=couple_names)
            
            body = ics_text.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/calendar; charset=utf-8")
            self.send_header("Content-Disposition", 'attachment; filename="twodo-itinerary.ics"')
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if path == "/api/export/summary":
            conn = get_connection()
            rows = conn.execute("""
            SELECT p.*, e.title, e.location_name, e.insider_tip
            FROM planner_items p
            JOIN events e ON p.event_id = e.id
            WHERE p.status = 'scheduled' AND p.scheduled_date IS NOT NULL
            ORDER BY p.scheduled_date ASC
            """).fetchall()
            conn.close()

            profile = get_couple_profile()
            couple_names = f"{profile.get('user1_name', 'Partner 1')} & {profile.get('user2_name', 'Partner 2')}"
            summary = format_text_summary([dict(r) for r in rows], couple_names=couple_names)
            self.send_json({"summary": summary})
            return

        if path == "/api/chat":
            conn = get_connection()
            rows = conn.execute("""
            SELECT id, sender_name, text, activity_id, activity_title, activity_image, created_at
            FROM messages
            ORDER BY id ASC
            LIMIT 200
            """).fetchall()
            conn.close()
            self.send_json({"success": True, "messages": [dict(r) for r in rows]})
            return

        self.serve_static(path)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        body = self.read_json_body()

        if path == "/api/profile":
            updated = update_couple_profile(body)
            self.send_json(updated)
            return

        if path == "/api/events/refresh":
            city = body.get("city") or "Brisbane"
            lat = body.get("lat")
            lng = body.get("lng")

            conn = get_connection()
            before_count = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
            conn.close()

            events = fetch_all_sources(city=city, lat=lat, lng=lng)
            enriched = get_enriched_events(city=city)

            conn = get_connection()
            after_count = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
            conn.close()

            newly_added = max(0, after_count - before_count)
            self.send_json({
                "message": f"Successfully pulled events for {city}",
                "newly_discovered_count": newly_added,
                "total_count": len(enriched),
                "events": enriched
            })
            return

        if path == "/api/events/custom":
            title = body.get("title", "").strip()
            if not title:
                self.send_error_json("Title is required")
                return

            import uuid
            new_id = f"custom-{uuid.uuid4().hex[:8]}"
            city = body.get("city", "Brisbane")
            tags = body.get("tags", ["Couple Choice"])
            if isinstance(tags, str):
                tags = [t.strip() for t in tags.split(",") if t.strip()]

            custom_event = {
                "id": new_id,
                "title": title,
                "description": body.get("description", "Couple custom discovery"),
                "category": body.get("category", "Date Night Specials"),
                "source": "Custom / Couple Rec",
                "source_url": body.get("source_url", ""),
                "image_url": body.get("image_url") or "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80",
                "location_name": body.get("location_name", city),
                "city": city,
                "lat": body.get("lat"),
                "lng": body.get("lng"),
                "start_date": body.get("start_date", ""),
                "end_date": body.get("end_date", ""),
                "time_str": body.get("time_str", "Anytime"),
                "price_level": body.get("price_level", "$$"),
                "price_str": body.get("price_str", ""),
                "tags": tags,
                "insider_tip": body.get("insider_tip", ""),
                "is_custom": 1,
                "created_at": datetime.now().isoformat()
            }

            conn = get_connection()
            with conn:
                conn.execute("""
                INSERT INTO events (
                    id, title, description, category, source, source_url, image_url,
                    location_name, city, lat, lng, start_date, end_date, time_str,
                    price_level, price_str, tags, insider_tip, is_custom, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    custom_event["id"], custom_event["title"], custom_event["description"],
                    custom_event["category"], custom_event["source"], custom_event["source_url"],
                    custom_event["image_url"], custom_event["location_name"], custom_event["city"],
                    custom_event["lat"], custom_event["lng"], custom_event["start_date"],
                    custom_event["end_date"], custom_event["time_str"], custom_event["price_level"],
                    custom_event["price_str"], json.dumps(custom_event["tags"]),
                    custom_event["insider_tip"], 1, custom_event["created_at"]
                ))
            conn.close()

            if body.get("add_to_planner", True):
                conn = get_connection()
                with conn:
                    conn.execute("""
                    INSERT INTO planner_items (event_id, status, scheduled_date, time_slot, notes, budget, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, (
                        new_id,
                        body.get("planner_status", "bucket_list"),
                        body.get("scheduled_date"),
                        body.get("time_slot", "evening"),
                        body.get("notes", ""),
                        body.get("budget", 0),
                        datetime.now().isoformat()
                    ))
                conn.close()

            self.send_json({"success": True, "event": custom_event})
            return

        if path == "/api/chat":
            sender_name = body.get("sender_name") or "Jordan"
            text = (body.get("text") or "").strip()
            activity_id = body.get("activity_id")
            activity_title = body.get("activity_title")
            activity_image = body.get("activity_image")

            if not text and not activity_id:
                self.send_error_json("Text or shared activity is required")
                return

            now_str = datetime.now().isoformat()
            conn = get_connection()
            with conn:
                cursor = conn.execute("""
                INSERT INTO messages (sender_name, text, activity_id, activity_title, activity_image, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """, (sender_name, text, activity_id, activity_title, activity_image, now_str))
                msg_id = cursor.lastrowid
            conn.close()

            self.send_json({
                "success": True,
                "message": {
                    "id": msg_id,
                    "sender_name": sender_name,
                    "text": text,
                    "activity_id": activity_id,
                    "activity_title": activity_title,
                    "activity_image": activity_image,
                    "created_at": now_str
                }
            })
            return

        if path == "/api/votes":
            event_id = body.get("event_id")
            user_name = body.get("user_name")
            vote = body.get("vote")
            note = body.get("note")

            if not event_id or not user_name:
                self.send_error_json("event_id and user_name are required")
                return

            profile = get_couple_profile()
            u1 = profile.get("user1_name", "Emma")
            u2 = profile.get("user2_name", "Jordan")

            conn = get_connection()
            with conn:
                voters_to_update = [u1, u2] if user_name.lower() in ["together", "both"] else [user_name]
                for v_user in voters_to_update:
                    if vote == "clear":
                        conn.execute("DELETE FROM votes WHERE event_id = ? AND user_name = ?", (event_id, v_user))
                    else:
                        conn.execute("""
                        INSERT INTO votes (event_id, user_name, vote, note, updated_at)
                        VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT(event_id, user_name) DO UPDATE SET
                            vote = excluded.vote,
                            note = COALESCE(excluded.note, votes.note),
                            updated_at = excluded.updated_at
                        """, (event_id, v_user, vote, note, datetime.now().isoformat()))

                if vote == "love":
                    existing = conn.execute("SELECT id FROM planner_items WHERE event_id = ?", (event_id,)).fetchone()
                    if not existing:
                        conn.execute("""
                        INSERT INTO planner_items (event_id, status, created_at)
                        VALUES (?, 'bucket_list', ?)
                        """, (event_id, datetime.now().isoformat()))

            v1_row = conn.execute("SELECT vote, note FROM votes WHERE event_id = ? AND user_name = ?", (event_id, u1)).fetchone()
            v2_row = conn.execute("SELECT vote, note FROM votes WHERE event_id = ? AND user_name = ?", (event_id, u2)).fetchone()
            conn.close()

            v1 = v1_row["vote"] if v1_row else None
            v2 = v2_row["vote"] if v2_row else None
            u1_note = v1_row["note"] if v1_row else None
            u2_note = v2_row["note"] if v2_row else None

            # STRICT MATCH: Only when BOTH partners vote 'love' is it a match!
            is_match = bool(v1 == "love" and v2 == "love")
            match_level = "double_love" if is_match else ("mutual_interest" if (v1 in ["love", "maybe"] and v2 in ["love", "maybe"]) else "none")

            self.send_json({
                "success": True,
                "event_id": event_id,
                "u1_vote": v1,
                "u2_vote": v2,
                "u1_note": u1_note,
                "u2_note": u2_note,
                "is_match": is_match,
                "match_level": match_level
            })
            return

        if path == "/api/planner":
            event_id = body.get("event_id")
            if not event_id:
                self.send_error_json("event_id is required")
                return

            status = body.get("status", "bucket_list")
            scheduled_date = body.get("scheduled_date")
            time_slot = body.get("time_slot", "evening")
            notes = body.get("notes", "")
            reservation_info = body.get("reservation_info", "")
            budget = float(body.get("budget", 0) or 0)

            conn = get_connection()
            with conn:
                existing = conn.execute("SELECT id FROM planner_items WHERE event_id = ?", (event_id,)).fetchone()
                if existing:
                    conn.execute("""
                    UPDATE planner_items SET
                        status = ?, scheduled_date = ?, time_slot = ?,
                        notes = ?, reservation_info = ?, budget = ?
                    WHERE id = ?
                    """, (status, scheduled_date, time_slot, notes, reservation_info, budget, existing["id"]))
                    p_id = existing["id"]
                else:
                    cur = conn.execute("""
                    INSERT INTO planner_items (event_id, status, scheduled_date, time_slot, notes, reservation_info, budget, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (event_id, status, scheduled_date, time_slot, notes, reservation_info, budget, datetime.now().isoformat()))
                    p_id = cur.lastrowid
            conn.close()

            self.send_json({"success": True, "planner_id": p_id, "status": status})
            return

        self.send_error_json("Not Found", 404)

    def do_PUT(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        body = self.read_json_body()

        if path.startswith("/api/planner/"):
            try:
                planner_id = int(path.split("/")[-1])
            except ValueError:
                self.send_error_json("Invalid planner ID")
                return

            conn = get_connection()
            with conn:
                conn.execute("""
                UPDATE planner_items SET
                    status = COALESCE(?, status),
                    scheduled_date = ?,
                    time_slot = COALESCE(?, time_slot),
                    notes = COALESCE(?, notes),
                    reservation_info = COALESCE(?, reservation_info),
                    budget = COALESCE(?, budget)
                WHERE id = ?
                """, (
                    body.get("status"),
                    body.get("scheduled_date"),
                    body.get("time_slot"),
                    body.get("notes"),
                    body.get("reservation_info"),
                    body.get("budget"),
                    planner_id
                ))
            conn.close()
            self.send_json({"success": True, "planner_id": planner_id})
            return

        self.send_error_json("Not Found", 404)

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/planner/"):
            try:
                planner_id = int(path.split("/")[-1])
            except ValueError:
                self.send_error_json("Invalid planner ID")
                return

            conn = get_connection()
            with conn:
                conn.execute("DELETE FROM planner_items WHERE id = ?", (planner_id,))
            conn.close()
            self.send_json({"success": True, "deleted_id": planner_id})
            return

        self.send_error_json("Not Found", 404)

    def serve_static(self, path):
        if path == "/" or path == "":
            rel_path = "index.html"
        else:
            rel_path = path.lstrip("/")

        full_path = os.path.join(STATIC_DIR, rel_path)
        
        if not os.path.abspath(full_path).startswith(os.path.abspath(STATIC_DIR)):
            self.send_error_json("Forbidden", 403)
            return

        if not os.path.exists(full_path) or os.path.isdir(full_path):
            full_path = os.path.join(STATIC_DIR, "index.html")

        mime, _ = mimetypes.guess_type(full_path)
        if not mime:
            mime = "text/html" if full_path.endswith(".html") else "application/octet-stream"

        try:
            with open(full_path, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", f"{mime}; charset=utf-8" if "text" in mime or "json" in mime or "javascript" in mime else mime)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            logger.error(f"Error reading file {full_path}: {e}")
            self.send_error_json("File read error", 500)

def get_local_ip():
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

def background_event_sync_worker(interval_hours=6):
    """Periodically pulls fresh events and viral food hotspots in the background."""
    import time
    time.sleep(15)  # initial startup buffer
    while True:
        try:
            logger.info("Automatic background event sync started...")
            profile = get_couple_profile()
            city = profile.get("default_city", "Brisbane")
            fetch_all_sources(city=city)
            logger.info(f"Automatic background sync completed for {city}.")
        except Exception as e:
            logger.error(f"Error in background sync worker: {e}")
        time.sleep(interval_hours * 3600)

def find_available_port(preferred_port=5050):
    import socket
    port = preferred_port
    for p in range(preferred_port, preferred_port + 100):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("0.0.0.0", p))
                return p
            except OSError:
                continue
    return preferred_port

def run_server(port=5050):
    init_db()
    profile = get_couple_profile()
    default_city = profile.get("default_city", "Brisbane")
    conn = get_connection()
    count = conn.execute("SELECT COUNT(*) as c FROM events").fetchone()["c"]
    conn.close()
    if count == 0:
        logger.info(f"Pre-seeding events database for {default_city}...")
        fetch_all_sources(city=default_city)

    # Launch automatic background event sync daemon
    import threading
    sync_thread = threading.Thread(target=background_event_sync_worker, args=(6,), daemon=True)
    sync_thread.start()

    actual_port = find_available_port(port)
    if actual_port != port:
        print(f"[Notice] Port {port} is occupied by another app on your Mac. Using free port {actual_port} instead!")

    local_ip = get_local_ip()
    server_address = ("0.0.0.0", actual_port)
    httpd = HTTPServer(server_address, TwoDoHandler)
    print(f"\n========================================================")
    print(f"  ❤️  TwoDo: The Couple's Adventure & Date Planner  ❤️")
    print(f"========================================================")
    print(f"  💻 Open on this Mac:            http://localhost:{actual_port}")
    print(f"  📱 Open on your Phone (Wi-Fi):  http://{local_ip}:{actual_port}")
    print(f"  🔄 Background Auto-Sync:        Active (Every 6 hours)")
    print(f"========================================================\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server gracefully...")
        httpd.server_close()

if __name__ == "__main__":
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5050
    run_server(port)

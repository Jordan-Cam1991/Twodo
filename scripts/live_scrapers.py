#!/usr/bin/env python3
"""
Modular Multi-Site Live Event Scrapers for TwoDo (Brisbane & South East Queensland).
===================================================================================
Pulls real, structured, upcoming events directly from official venues, stadiums,
ticketing platforms, councils, and SEQ what's-on hubs using standard-library HTTP
and HTML/JSON-LD/microformat parsing (zero external pip dependencies).

Priority order returned by `pull_all_seq_live_events`:
  1. Stadiums Queensland (`suncorpstadium.com.au`, `thegabba.com.au`, `cbussuperstadium.com.au`,
     `peoplefirststadium.com.au`, `qsac.com.au`, `sleemansports.com.au`)
  2. Major Brisbane Concert & Theatre Venues (`thetivoli.com.au`, `theprincesstheatre.com.au`,
     `qpac.com.au`, `brisbanepowerhouse.org`, `brisent.com.au`, `eatonshillhotel.com.au`)
  3. Regional Tourism & Museums (`visitsunshinecoast.com`, `whatsonmoretonbay.com`,
     `museumofbrisbane.com.au`, `concreteplayground.com`, `destinationgoldcoast.com`)
  4. Live Concert & Ticketing Aggregators (`songkick.com`, `moshtix.com.au`,
     `eventbrite.com.au`, `eventfinda.com.au`)
"""

from __future__ import annotations

import concurrent.futures
import gzip
import html
import json
import re
import ssl
import urllib.parse
import urllib.request
from datetime import datetime, timedelta


USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

CATEGORY_DEFAULT_IMAGES = {
    "Music & Concerts": "https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?auto=format&fit=crop&w=900&q=80",
    "Sports & Active": "https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&w=900&q=80",
    "Comedy & Shows": "https://images.unsplash.com/photo-1507676184212-d03ab07a01bf?auto=format&fit=crop&w=900&q=80",
    "Arts & Culture": "https://images.unsplash.com/photo-1518998053901-5348d3961a04?auto=format&fit=crop&w=900&q=80",
    "Food & Drink": "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=900&q=80",
    "Nightlife & Bars": "https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&w=900&q=80",
    "Markets & Pop-Ups": "https://images.unsplash.com/photo-1533900298318-6b8da08a523e?auto=format&fit=crop&w=900&q=80",
    "Outdoor & Adventure": "https://images.unsplash.com/photo-1551632811-561732d1e306?auto=format&fit=crop&w=900&q=80",
    "Sightseeing & Nature": "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=900&q=80",
    "Workshops & Classes": "https://images.unsplash.com/photo-1513364776144-60967b0f800f?auto=format&fit=crop&w=900&q=80",
}

NON_SEQ_LOCATION_TOKENS = (
    "online event", "online only", "webinar", "virtual event", "zoom",
    "sydney", "melbourne", "perth", "adelaide", "hobart", "canberra", "darwin",
    "new south wales", "victoria", "western australia", "south australia",
    "auckland", "wellington",
)

JUNK_EVENT_TOKENS = (
    "diploma", "cert iii", "cert iv", "accredited training", "first aid course",
    "cpr ", "white card", "forklift", "rsa course", "real estate seminar",
    "property investment", "wealth creation", "crypto", "forex", "b2b summit",
    "playgroup", "rhyme time", "baby bounce", "toddler", "immunisation",
    "jp signing", "justice of the peace", "council meeting", "agm",
    "graduation ceremony", "year 12 graduation", "valedictory", "school formal",
    "professionals'", "networking breakfast", "business luncheon", "ai summit",
    "real estate workshop", "financial planning", "aged care", "ndis expo",
)

VENUE_SUBURB_MAP = {
    "suncorp stadium": "Suncorp Stadium, Milton",
    "the gabba": "The Gabba, Woolloongabba",
    "cbus super stadium": "Cbus Super Stadium, Robina (Gold Coast)",
    "people first stadium": "People First Stadium, Carrara (Gold Coast)",
    "qsac": "QSAC, Nathan",
    "sleeman": "Sleeman Sports Complex, Chandler",
    "fortitude music hall": "The Fortitude Music Hall, Fortitude Valley",
    "the triffid": "The Triffid, Newstead",
    "triffid": "The Triffid, Newstead",
    "the tivoli": "The Tivoli, Fortitude Valley",
    "tivoli": "The Tivoli, Fortitude Valley",
    "princess theatre": "The Princess Theatre, Woolloongabba",
    "brisbane powerhouse": "Brisbane Powerhouse, New Farm",
    "powerhouse": "Brisbane Powerhouse, New Farm",
    "qpac": "QPAC, South Bank",
    "riverstage": "Riverstage, Brisbane CBD",
    "brisbane entertainment centre": "Brisbane Entertainment Centre, Boondall",
    "eatons hill": "Eatons Hill Hotel, Eatons Hill",
    "the brightside": "The Brightside, Fortitude Valley",
    "brightside": "The Brightside, Fortitude Valley",
    "the zoo": "The Zoo, Fortitude Valley",
    "crowbar": "Crowbar, Fortitude Valley",
    "miami marketta": "Miami Marketta, Gold Coast",
    "hota": "HOTA, Gold Coast",
    "nightquarter": "NightQuarter, Sunshine Coast",
    "lefty's": "Lefty's Music Hall, Milton",
    "brooklyn standard": "Brooklyn Standard, Brisbane CBD",
    "brisbane jazz club": "Brisbane Jazz Club, Kangaroo Point",
}

STADIUM_SITES = [
    {
        "url": "https://suncorpstadium.com.au/whats-on",
        "origin": "https://suncorpstadium.com.au",
        "venue": "Suncorp Stadium, Milton",
        "source": "Suncorp Stadium Official",
        "tags": ["Suncorp Stadium", "Milton", "Stadium"],
    },
    {
        "url": "https://thegabba.com.au/whats-on",
        "origin": "https://thegabba.com.au",
        "venue": "The Gabba, Woolloongabba",
        "source": "The Gabba Official",
        "tags": ["The Gabba", "Woolloongabba", "Stadium"],
    },
    {
        "url": "https://cbussuperstadium.com.au/whats-on",
        "origin": "https://cbussuperstadium.com.au",
        "venue": "Cbus Super Stadium, Robina (Gold Coast)",
        "source": "Cbus Super Stadium Official",
        "tags": ["Cbus Super Stadium", "Gold Coast", "Stadium"],
    },
    {
        "url": "https://peoplefirststadium.com.au/whats-on",
        "origin": "https://peoplefirststadium.com.au",
        "venue": "People First Stadium, Carrara (Gold Coast)",
        "source": "People First Stadium Official",
        "tags": ["People First Stadium", "Gold Coast", "Stadium"],
    },
    {
        "url": "https://qsac.com.au/whats-on",
        "origin": "https://qsac.com.au",
        "venue": "QSAC, Nathan",
        "source": "QSAC Official",
        "tags": ["QSAC", "Nathan", "Stadium"],
    },
    {
        "url": "https://sleemansports.com.au/whats-on",
        "origin": "https://sleemansports.com.au",
        "venue": "Sleeman Sports Complex, Chandler",
        "source": "Sleeman Sports Complex Official",
        "tags": ["Sleeman Sports Complex", "Chandler", "Active"],
    },
]

MONTHS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3,
    "apr": 4, "april": 4, "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7,
    "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10, "nov": 11, "november": 11, "dec": 12, "december": 12,
}


def clean_text(raw: str) -> str:
    """Unescape HTML entities and normalize unicode/whitespace cleanly."""
    if not raw:
        return ""
    s = html.unescape(str(raw))
    s = re.sub(r"<[^>]+>", " ", s)
    s = s.replace("\xa0", " ").replace("\u202f", " ").replace("\u200b", "")
    s = s.replace("\u2013", "-").replace("\u2014", "-")
    return re.sub(r"\s+", " ", s).strip()


def resolve_url(url: str, base_url: str) -> str:
    u = clean_text(url)
    if not u:
        return ""
    if u.startswith("//"):
        return "https:" + u
    if u.startswith("http://") or u.startswith("https://"):
        return u
    if base_url:
        return urllib.parse.urljoin(base_url, u)
    return u


def pick_valid_image(raw_img: str, base_url: str, category: str) -> str:
    img = resolve_url(raw_img, base_url)
    low = img.lower()
    if (
        not img
        or not low.startswith("http")
        or low.startswith("data:")
        or low.endswith(".svg")
        or "placeholder" in low
        or "1x1" in low
    ):
        return CATEGORY_DEFAULT_IMAGES.get(category, CATEGORY_DEFAULT_IMAGES["Music & Concerts"])
    return img


def fetch_text(url: str, timeout: int = 16) -> str:
    """Fetch URL with standard-library urllib, gzip support, and one transient retry."""
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-AU,en;q=0.9",
        "Accept-Encoding": "gzip, identity",
    }
    ctx = ssl.create_default_context()
    for attempt in range(2):
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
                raw = resp.read()
                enc = (resp.headers.get("Content-Encoding") or "").lower()
                if "gzip" in enc or raw[:2] == b"\x1f\x8b":
                    try:
                        raw = gzip.decompress(raw)
                    except Exception:
                        pass
                return raw.decode("utf-8", errors="ignore")
        except Exception:
            if attempt == 0:
                continue
    return ""


def _normalize_time_24(time_raw: str) -> tuple[str, str]:
    """Return ('HH:MM', 'H:MM PM') from a free-form time string, defaulting to ('19:00', '')."""
    t = clean_text(time_raw).lower()
    if not t:
        return "19:00", ""
    m = re.search(r"(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", t)
    if not m:
        return "19:00", ""
    hr = int(m.group(1))
    mn = int(m.group(2) or "0")
    ampm = m.group(3)
    if ampm == "pm" and hr < 12:
        hr += 12
    elif ampm == "am" and hr == 12:
        hr = 0
    if hr > 23 or mn > 59:
        return "19:00", ""
    disp_hr = 12 if (hr % 12 == 0) else (hr % 12)
    disp_ampm = "AM" if hr < 12 else "PM"
    return f"{hr:02d}:{mn:02d}", f"{disp_hr}:{mn:02d} {disp_ampm}"


def _format_display_date_time(ymd: str, hhmm: str, has_explicit_time: bool = True) -> str:
    dt = datetime.strptime(ymd, "%Y-%m-%d")
    day_part = dt.strftime("%a, %d %b")
    if has_explicit_time and hhmm:
        h, m = map(int, hhmm.split(":"))
        ampm = "AM" if h < 12 else "PM"
        h12 = 12 if (h % 12 == 0) else (h % 12)
        return f"{day_part} · {h12}:{m:02d} {ampm}"
    return day_part


def parse_iso_datetime(raw: str) -> tuple[str | None, str | None, str]:
    """Parse ISO-8601 date/datetime string -> ('YYYY-MM-DD HH:MM', 'YYYY-MM-DD', display_str)."""
    s = clean_text(raw)
    if not s:
        return None, None, ""
    m_dt = re.match(r"(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})", s)
    if m_dt:
        ymd, hhmm = m_dt.group(1), m_dt.group(2)
        # Treat 00:00 in pure midnight ISO placeholders carefully as evening check vs explicit
        has_time = hhmm != "00:00"
        return f"{ymd} {hhmm}", ymd, _format_display_date_time(ymd, hhmm, has_time)
    m_d = re.match(r"(\d{4}-\d{2}-\d{2})", s)
    if m_d:
        ymd = m_d.group(1)
        return f"{ymd} 18:00", ymd, _format_display_date_time(ymd, "18:00", False)
    return None, None, ""


def parse_aus_date_str(
    raw_date: str,
    today_ymd: str,
    raw_time: str = "",
) -> tuple[str | None, str | None, str]:
    """Parse formats like 'Nov 20, 2026', 'Sat 14 Nov 2026', '6 Jul 2027, 8:30pm', 'Friday 22 January'."""
    s = clean_text(raw_date)
    if not s:
        return None, None, ""

    iso_full, iso_ymd, iso_disp = parse_iso_datetime(s)
    if iso_ymd:
        if raw_time:
            hhmm, _ = _normalize_time_24(raw_time)
            return f"{iso_ymd} {hhmm}", iso_ymd, _format_display_date_time(iso_ymd, hhmm, True)
        return iso_full, iso_ymd, iso_disp

    low = s.lower()
    today_dt = datetime.strptime(today_ymd, "%Y-%m-%d")
    found_dt = None

    # Pattern 1: "Nov 20, 2026" or "November 20 2026"
    m1 = re.search(r"\b([a-z]{3,9})\s+(\d{1,2}),?\s+(20\d{2})\b", low)
    if m1 and m1.group(1) in MONTHS:
        found_dt = datetime(int(m1.group(3)), MONTHS[m1.group(1)], int(m1.group(2)))

    # Pattern 2: "20 Nov 2026" / "Sat 14 Nov 2026"
    if not found_dt:
        m2 = re.search(r"\b(\d{1,2})\s+([a-z]{3,9})\s+(20\d{2})\b", low)
        if m2 and m2.group(2) in MONTHS:
            found_dt = datetime(int(m2.group(3)), MONTHS[m2.group(2)], int(m2.group(1)))

    # Pattern 3: "22 January" / "Friday 22 January" / "Fri 20 Nov" (no year -> infer upcoming year)
    if not found_dt:
        m3 = re.search(r"\b(\d{1,2})\s+([a-z]{3,9})\b", low)
        if m3 and m3.group(2) in MONTHS:
            yr = today_dt.year
            try:
                cand = datetime(yr, MONTHS[m3.group(2)], int(m3.group(1)))
                if cand < (today_dt - timedelta(days=7)):
                    cand = datetime(yr + 1, MONTHS[m3.group(2)], int(m3.group(1)))
                found_dt = cand
            except ValueError:
                found_dt = None

    if not found_dt:
        return None, None, ""

    ymd = found_dt.strftime("%Y-%m-%d")
    time_source = raw_time
    if not time_source:
        mt = re.search(r"\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b", low)
        if mt:
            time_source = mt.group(0)

    if time_source:
        hhmm, _ = _normalize_time_24(time_source)
        return f"{ymd} {hhmm}", ymd, _format_display_date_time(ymd, hhmm, True)
    return f"{ymd} 19:00", ymd, _format_display_date_time(ymd, "19:00", False)


def canonicalize_venue_location(venue_name: str, address_hint: str = "", fallback: str = "Brisbane") -> str:
    """Attach suburb/region clearly so TwoDo area & venue filters match accurately."""
    v = clean_text(venue_name)
    a = clean_text(address_hint)
    combined = f"{v} {a}".lower()
    for pat, label in VENUE_SUBURB_MAP.items():
        if re.search(rf"\b{re.escape(pat)}\b", combined):
            if v and pat not in label.lower():
                return f"{v}, {label}"
            return label
    if v and a and a.lower() not in v.lower():
        if len(a) <= 40:
            return f"{v}, {a}"
    return v or a or fallback


def infer_category(title: str, desc: str = "", raw_cat: str = "", location: str = "") -> str:
    """Map heterogeneous external categories/text into TwoDo's canonical category badges."""
    rc = clean_text(raw_cat).lower()
    # Keep title/desc/category separate from venue name so e.g. 'Princess Theatre' gigs stay Music & Concerts
    core_txt = f"{title} {desc} {rc}".lower().replace("princess theatre", "")
    full_txt = f"{core_txt} {location}".lower()

    if any(k in full_txt for k in ("cricket", "bbl", "wbbl", "afl", "nrl", "super rugby", "a-league", "world cup", "roar", "brisbane bullets", "nbl", "reds vs", "broncos", "dolphins", "state of origin", "racecourse", "raceday", "tennis", "marathon", "triathlon", "parkrun", "badminton", "squash", "diving", "swimming", "aquatic", "gymnastics", "athletics", "sleeman sports")):
        return "Sports & Active"
    if any(k in core_txt for k in ("comedy", "comedian", "stand-up", "standup", "improv", "cabaret", "burlesque", "magic show")):
        return "Comedy & Shows"
    if any(k in core_txt for k in ("musical", "ballet", "opera", "pantomime", "cirque", "theatre", "theater", "cinema", "film screening")):
        if not any(m in rc for m in ("musicevent", "concert", "rock", "pop", "hip-hop", "r&b", "soul", "indie", "jazz", "metal", "folk", "electronic")):
            return "Comedy & Shows"
    if "musicevent" in rc or "concert" in rc or "gig" in rc or "live music" in rc:
        return "Music & Concerts"
    if any(k in full_txt for k in ("candlelight", "symphony", "orchestra", "concert", "live band", "tour 2026", "tour 2027", "dj set", "music festival", "fortitude music hall", "the triffid", "the tivoli", "riverstage", "suncorp stadium", "entertainment centre", "princess theatre", "eatons hill")):
        if not any(k in core_txt for k in ("market", "run club", "yoga", "graduation")):
            return "Music & Concerts"
    if any(k in core_txt for k in ("market", "markets", "night market", "farmers market", "popup", "pop-up", "bazaar", "vintage fair", "suitcase rummage")):
        return "Markets & Pop-Ups"
    if any(k in core_txt for k in ("pottery", "ceramics", "paint and sip", "paint & sip", "workshop", "masterclass", "cooking class", "candle making", "tufting", "life drawing", "floristry", "terrarium", "baking class")):
        return "Workshops & Classes"
    if any(k in core_txt for k in ("exhibition", "gallery", "museum", "qagoma", "goma", "sculpture", "art prize", "heritage walk", "walking tour", "up late")):
        return "Arts & Culture"
    if any(k in core_txt for k in ("wine tasting", "degustation", "bottomless brunch", "long lunch", "beer festival", "gin tasting", "whisky tasting", "food festival", "food & wine", "high tea")):
        return "Food & Drink"
    if any(k in core_txt for k in ("club night", "rave", "rooftop party", "cocktail night", "silent disco", "speakeasy")):
        return "Nightlife & Bars"
    if any(k in core_txt for k in ("hike", "kayak", "paddle", "whale watching", "sunrise walk", "waterfall", "bushwalk", "botanic")):
        return "Outdoor & Adventure"
    if "music" in rc or "band" in core_txt or "singer" in core_txt or "rock" in rc or "electronic" in rc or "pop" in rc or "indie" in rc:
        return "Music & Concerts"
    return "Arts & Culture"


def is_clean_seq_event(title: str, location: str, desc: str = "", url: str = "") -> bool:
    """Reject obvious online webinars, training courses, and interstate listings."""
    t = (title or "").strip()
    if len(t) < 3 or len(t) > 180:
        return False
    tl = t.lower()
    ll = (location or "").lower()
    combined = f"{tl} {ll} {(desc or '').lower()}"
    if any(bad in ll for bad in NON_SEQ_LOCATION_TOKENS):
        return False
    if any(bad in tl for bad in ("webinar", "online event", "virtual session", "zoom link")):
        return False
    if any(bad in combined for bad in JUNK_EVENT_TOKENS):
        return False
    if not (url.startswith("http://") or url.startswith("https://")):
        return False
    return True


def _make_event_id(prefix: str, title: str, ymd: str, url: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:42]
    suffix = hex(abs(hash(f"{title}|{ymd}|{url}")))[-6:]
    return f"live-{prefix}-{slug}-{ymd}-{suffix}"


def _build_event(
    *,
    prefix: str,
    title: str,
    ymd: str,
    start_date: str,
    end_date: str | None = None,
    time_str: str,
    location: str,
    source: str,
    source_url: str,
    image_url: str = "",
    base_url: str = "",
    description: str = "",
    insider_tip: str = "",
    price: str = "See Tickets",
    raw_cat: str = "",
    extra_tags: list[str] | None = None,
    priority: int = 2,
) -> dict:
    clean_title = clean_text(title)
    clean_loc = clean_text(location) or "Brisbane"
    clean_desc = clean_text(description)
    cat = infer_category(clean_title, clean_desc, raw_cat, clean_loc)
    if not clean_desc:
        clean_desc = f"Live upcoming {cat.lower()} event: {clean_title} at {clean_loc}."
    if len(clean_desc) > 260:
        clean_desc = clean_desc[:257].rstrip() + "..."

    tags = [cat]
    for tg in (extra_tags or []):
        ct = clean_text(tg)
        if ct and ct not in tags:
            tags.append(ct)
    loc_low = clean_loc.lower()
    if "gold coast" in loc_low and "Gold Coast" not in tags:
        tags.append("Gold Coast")
    if "sunshine coast" in loc_low and "Sunshine Coast" not in tags:
        tags.append("Sunshine Coast")
    for pat, label in (
        ("suncorp", "Suncorp Stadium"),
        ("the gabba", "The Gabba"),
        ("riverstage", "Riverstage"),
        ("fortitude music hall", "Fortitude Music Hall"),
        ("triffid", "The Triffid"),
        ("tivoli", "The Tivoli"),
        ("princess theatre", "Princess Theatre"),
        ("powerhouse", "Brisbane Powerhouse"),
        ("qpac", "QPAC"),
        ("entertainment centre", "Brisbane Entertainment Centre"),
        ("eatons hill", "Eatons Hill Hotel"),
        ("hota", "HOTA"),
    ):
        if re.search(rf"\b{re.escape(pat)}\b", loc_low) and label not in tags:
            tags.append(label)

    return {
        "id": _make_event_id(prefix, clean_title, ymd, source_url),
        "title": clean_title,
        "description": clean_desc,
        "insider_tip": insider_tip or f"Check {source} for door times, set lists, and ticket availability.",
        "category": cat,
        "location": clean_loc,
        "time_str": time_str,
        "start_date": start_date,
        "end_date": end_date or start_date,
        "ongoing": False,
        "price": clean_text(price) or "See Tickets",
        "source": source,
        "source_url": resolve_url(source_url, base_url),
        "image_url": pick_valid_image(image_url, base_url, cat),
        "tags": tags[:6],
        "_priority": priority,
    }


def extract_json_ld_events(html_text: str) -> list[dict]:
    """Recursively extract schema.org Event objects from JSON-LD <script> blocks."""
    out = []
    scripts = re.findall(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html_text,
        re.S | re.I,
    )

    def walk(node):
        if isinstance(node, list):
            for item in node:
                walk(item)
            return
        if not isinstance(node, dict):
            return
        t = node.get("@type")
        t_list = t if isinstance(t, list) else [t]
        t_low = " ".join(str(x or "").lower() for x in t_list)
        if "event" in t_low and node.get("name"):
            out.append(node)
        if "@graph" in node:
            walk(node["@graph"])
        if "itemListElement" in node:
            walk(node["itemListElement"])
        if "item" in node and isinstance(node["item"], (dict, list)):
            walk(node["item"])

    for block in scripts:
        raw = block.strip()
        if not raw:
            continue
        try:
            walk(json.loads(raw))
        except Exception:
            continue
    return out


def _image_from_jsonld(img_val) -> str:
    if isinstance(img_val, str):
        return img_val
    if isinstance(img_val, list) and img_val:
        return _image_from_jsonld(img_val[0])
    if isinstance(img_val, dict):
        return str(img_val.get("url") or img_val.get("contentUrl") or "")
    return ""


def _price_from_jsonld(offers) -> str:
    if isinstance(offers, list) and offers:
        return _price_from_jsonld(offers[0])
    if not isinstance(offers, dict):
        return "See Tickets"
    low = offers.get("lowPrice") or offers.get("price")
    high = offers.get("highPrice")
    if low is not None and str(low) != "":
        try:
            lf = float(low)
            if lf <= 0:
                return "Free"
            if high and float(high) > lf:
                return f"${int(round(lf))}–${int(round(float(high)))}"
            return f"From ${int(round(lf))}"
        except Exception:
            return str(low)
    return "See Tickets"


def _location_from_jsonld(loc_obj, default_loc: str = "Brisbane") -> str:
    if isinstance(loc_obj, str):
        return clean_text(loc_obj) or default_loc
    if isinstance(loc_obj, dict):
        name = clean_text(str(loc_obj.get("name") or ""))
        addr = loc_obj.get("address")
        suburb = ""
        if isinstance(addr, dict):
            suburb = clean_text(str(addr.get("addressLocality") or addr.get("streetAddress") or ""))
        elif isinstance(addr, str):
            suburb = clean_text(addr)
        return canonicalize_venue_location(name, suburb, default_loc)
    return default_loc


# ==============================================================================
# 1. STADIUMS QUEENSLAND (Suncorp, Gabba, Cbus, People First, QSAC, Sleeman)
# ==============================================================================

def _parse_stadium_page(site: dict, body: str, today_ymd: str) -> list[dict]:
    m = re.search(r'<event-list[^>]*\s:items=(["\'])(.*?)\1', body, re.S)
    if not m:
        return []
    try:
        items = json.loads(html.unescape(m.group(2)))
    except Exception:
        return []

    events = []
    for it in items:
        title = clean_text(it.get("title") or "")
        url = resolve_url(it.get("url") or "", site["origin"])
        if not title or not url:
            continue
        open_t = (it.get("eventOpenTime") or {}).get("time") or ""
        start_t = (it.get("eventStartTime") or {}).get("time") or open_t or "18:00"
        start_date, ymd, disp = parse_aus_date_str(it.get("eventDate") or "", today_ymd, raw_time=start_t)
        if not ymd or ymd < today_ymd:
            continue

        open_text = (it.get("eventOpenTime") or {}).get("text") or "Gates open"
        start_text = (it.get("eventStartTime") or {}).get("text") or "Show Start"
        cat_raw = (it.get("eventCategory") or {}).get("title") or (it.get("eventType") or {}).get("title") or ""
        v_obj = it.get("venue") or {}
        loc_desc = clean_text(v_obj.get("description") or "")
        loc = site["venue"]
        if loc_desc and loc_desc.split(",")[0].lower() not in loc.lower():
            loc = f"{it.get('locationName') or loc}, {loc_desc}"

        tip_parts = []
        if open_t:
            tip_parts.append(f"{open_text}: {open_t}")
        if (it.get("eventStartTime") or {}).get("time"):
            tip_parts.append(f"{start_text}: {(it.get('eventStartTime') or {}).get('time')}")
        tip = " · ".join(tip_parts) if tip_parts else f"Official {site['venue']} listing — check entry gates & public transport before heading in."
        desc = f"{title} live at {loc} on {disp}."
        if tip_parts:
            desc += f" ({' · '.join(tip_parts)})."

        if not is_clean_seq_event(title, loc, desc, url):
            continue

        events.append(_build_event(
            prefix="sqld",
            title=title,
            ymd=ymd,
            start_date=start_date,
            time_str=disp,
            location=loc,
            source=site["source"],
            source_url=url,
            image_url=it.get("imageSrc") or "",
            base_url=site["origin"],
            description=desc,
            insider_tip=tip,
            price="Official Tickets",
            raw_cat=cat_raw,
            extra_tags=site["tags"] + ([cat_raw] if cat_raw else []),
            priority=1,
        ))
    return events


# ==============================================================================
# 2. CRAFT CMS VENUES (The Tivoli & The Princess Theatre)
# ==============================================================================

CRAFT_VENUES = [
    {
        "url": "https://thetivoli.com.au/events",
        "origin": "https://thetivoli.com.au",
        "location": "The Tivoli, Fortitude Valley",
        "source": "The Tivoli Official",
        "tags": ["The Tivoli", "Fortitude Valley", "Live Music"],
    },
    {
        "url": "https://www.theprincesstheatre.com.au/events",
        "origin": "https://www.theprincesstheatre.com.au",
        "location": "The Princess Theatre, Woolloongabba",
        "source": "The Princess Theatre Official",
        "tags": ["Princess Theatre", "Woolloongabba", "Live Music"],
    },
]


def _parse_craft_venue_page(venue: dict, body: str, today_ymd: str) -> list[dict]:
    events = []
    seen_urls = set()
    # Craft CMS sites (Tivoli & Princess Theatre) wrap each card inside .image-container
    blocks = re.split(r'<div[^>]+class=["\'][^"\']*\bimage-container\b[^"\']*["\']', body, flags=re.I)
    for block in blocks[1:]:
        mh_link = re.search(r'<a[^>]+href=(["\'])((?:https?:)?[^"\']*/events/[^"\'?#]+)\1', block, re.I)
        if not mh_link:
            continue
        href = resolve_url(mh_link.group(2), venue["origin"])
        if href in seen_urls:
            continue

        # Princess Theatre wraps title in <a class="event-title-hover">; Tivoli wraps in <a class="image-body">
        cleaned_blk = re.sub(r'<span[^>]+class=["\'][^"\']*image-nationality[^"\']*["\'][^>]*>.*?</span>', '', block, flags=re.S | re.I)
        cleaned_blk = re.sub(r'<div[^>]+class=["\'][^"\']*(?:image-supporting|image-subtitle)[^"\']*["\'][^>]*>.*?</div>', '', cleaned_blk, flags=re.S | re.I)
        mt_hover = re.search(r'<a[^>]+class=["\'][^"\']*event-title-hover[^"\']*["\'][^>]*>(.*?)</a>', cleaned_blk, re.S | re.I)
        mt_div = re.search(r'<div[^>]+class=["\'][^"\']*image-title[^"\']*["\'][^>]*>(.*?)</div>', cleaned_blk, re.S | re.I)
        if mt_hover:
            raw_t = mt_hover.group(1)
        elif mt_div:
            raw_t = mt_div.group(1)
        else:
            # Capture full div containing .image-title spans (e.g. Tivoli split word spans)
            mt_wrap = re.search(r'<div[^>]*>\s*<span[^>]+class=["\'][^"\']*image-title[^"\']*["\'][^>]*>.*?</div>', cleaned_blk, re.S | re.I)
            if mt_wrap:
                raw_t = mt_wrap.group(0)
            else:
                parts = re.findall(r'<span[^>]+class=["\'][^"\']*image-title[^"\']*["\'][^>]*>(.*?)</span>', cleaned_blk, re.S | re.I)
                raw_t = " ".join(parts)

        title = clean_text(raw_t)
        if not title or len(title) < 2:
            continue
        seen_urls.add(href)

        ms = re.search(r'class=["\'][^"\']*image-subtitle[^"\']*["\'][^>]*>(.*?)</div>', block, re.S | re.I)
        date_raw = clean_text(ms.group(1)) if ms else ""
        start_date, ymd, disp = parse_aus_date_str(date_raw, today_ymd)
        if not ymd or ymd < today_ymd:
            continue

        mc = re.search(r'class=["\'][^"\']*image-category[^"\']*["\'][^>]*>(.*?)</div>', block, re.S | re.I)
        raw_cat = clean_text(mc.group(1)) if mc else "MusicEvent"
        mi = re.search(r'<img[^>]+(?:data-src|src)=["\']([^"\']+)["\']', block, re.I)
        img = mi.group(1) if mi else ""
        if not is_clean_seq_event(title, venue["location"], title, href):
            continue

        events.append(_build_event(
            prefix="craft",
            title=title,
            ymd=ymd,
            start_date=start_date,
            time_str=disp,
            location=venue["location"],
            source=venue["source"],
            source_url=href,
            image_url=img,
            base_url=venue["origin"],
            description=f"{title} live at {venue['location']} on {disp}.",
            insider_tip=f"Arrive 45 mins early for drinks before doors open at {venue['location']}.",
            price="Official Tickets",
            raw_cat=raw_cat,
            extra_tags=venue["tags"],
            priority=1,
        ))
    return events


# ==============================================================================
# 3. QPAC, BRISBANE POWERHOUSE, BRISBANE ENTERTAINMENT CENTRE & EATONS HILL
# ==============================================================================

def _parse_qpac_page(body: str, today_ymd: str) -> list[dict]:
    events = []
    origin = "https://www.qpac.com.au"
    for m in re.finditer(r'<article[^>]+class=["\'][^"\']*\bcard\b[^"\']*["\'][^>]*>(.*?)</article>', body, re.S | re.I):
        block = m.group(1)
        ml = re.search(r'<a[^>]+href=["\']([^"\']*/whats-on/[^"\']+)["\']', block, re.I)
        mh = re.search(r'<h3[^>]*>(.*?)</h3>', block, re.S | re.I)
        if not ml or not mh:
            continue
        title = clean_text(mh.group(1))
        url = resolve_url(ml.group(1), origin)
        md = re.search(r'class=["\'][^"\']*card__date-range[^"\']*["\'][^>]*>(.*?)</div>', block, re.S | re.I)
        date_raw = clean_text(md.group(1)) if md else ""
        if not date_raw:
            continue
        mloc = re.search(r'class=["\'][^"\']*card__location[^"\']*["\'][^>]*>(.*?)</div>', block, re.S | re.I)
        room = clean_text(mloc.group(1)) if mloc else ""
        loc = f"QPAC ({room}), South Bank" if room else "QPAC, South Bank"

        # Handle range "12 Nov - 6 Dec 2026" or "12 - 22 Nov 2026" or single "6 Jul 2027, 8:30pm"
        parts = re.split(r"\s+-\s+|\s+\u2013\s+", date_raw)
        end_ymd = None
        end_date = None
        if len(parts) >= 2:
            end_date, end_ymd, _ = parse_aus_date_str(parts[-1], today_ymd)
            start_hint = parts[0]
            if re.fullmatch(r"\d{1,2}", start_hint.strip()) and end_ymd:
                # e.g. "12 - 22 Nov 2026" -> inherit month & year from end_hint
                m_tail = re.search(r"([A-Za-z]{3,9}(?:\s+20\d{2})?)", parts[-1])
                if m_tail:
                    start_hint = f"{start_hint.strip()} {m_tail.group(1)}"
            if end_ymd and not re.search(r"20\d{2}", start_hint):
                start_hint = f"{start_hint} {end_ymd[:4]}"
            start_date, ymd, disp = parse_aus_date_str(start_hint, today_ymd)
        else:
            start_date, ymd, disp = parse_aus_date_str(date_raw, today_ymd)

        if not ymd:
            continue
        effective_last = end_ymd or ymd
        if effective_last < today_ymd:
            continue

        mi = re.search(r'<img[^>]+(?:data-src|src)=["\']([^"\']+)["\']', block, re.I)
        img = mi.group(1) if mi else ""
        if not is_clean_seq_event(title, loc, title, url):
            continue

        events.append(_build_event(
            prefix="qpac",
            title=title,
            ymd=ymd,
            start_date=start_date,
            end_date=end_date,
            time_str=date_raw or disp,
            location=loc,
            source="QPAC Official",
            source_url=url,
            image_url=img,
            base_url=origin,
            description=f"{title} performing at {loc}. Dates: {date_raw or disp}.",
            insider_tip="Pair with pre-show tapas in Fish Lane or drinks on the Lyrebird terrace overlooking South Bank.",
            price="Official Tickets",
            raw_cat="",
            extra_tags=["QPAC", "South Bank"],
            priority=1,
        ))
    return events


def _parse_powerhouse_page(body: str, today_ymd: str) -> list[dict]:
    events = []
    origin = "https://brisbanepowerhouse.org"
    seen_urls = set()
    # Match slider/grid items wrapping Brisbane Powerhouse /events/ links
    for m in re.finditer(r'(<a[^>]+href=["\'](https://brisbanepowerhouse\.org/events/[^"\']+|/events/[^"\']+)["\'][^>]*>.*?</a>)', body, re.S | re.I):
        url = resolve_url(m.group(2), origin)
        if url in seen_urls or "/events/category/" in url:
            continue
        ctx_block = body[max(0, m.start() - 550):min(len(body), m.end() + 550)]

        mh = re.search(r'<h[234][^>]*>(.*?)</h[234]>', ctx_block, re.S | re.I)
        mt_attr = re.search(r'alt=["\']([^"\']{3,})["\']', m.group(1), re.I)
        title = clean_text(mh.group(1) if mh else (mt_attr.group(1) if mt_attr else clean_text(m.group(1))))
        if not title or len(title) < 3 or title.lower() in {"book now", "learn more", "find out more", "read more", "view event"}:
            continue

        # Parse BPH spans like "<span>11-21</span><span> Nov</span>" or "12 Nov"
        m_bph_time = re.search(r'bph-event-item-time[^>]*>(.*?)</div>', ctx_block, re.S | re.I)
        raw_date_blob = clean_text(m_bph_time.group(1) if m_bph_time else ctx_block)
        # Try day-range within same month: "11-21 Nov"
        m_rng = re.search(r'\b(\d{1,2})\s*[-–]\s*(\d{1,2})\s+([A-Za-z]{3,9})(?:\s+(20\d{2}))?\b', raw_date_blob)
        start_date = ymd = disp = end_date = None
        if m_rng:
            yr_part = f" {m_rng.group(4)}" if m_rng.group(4) else ""
            start_date, ymd, disp = parse_aus_date_str(f"{m_rng.group(1)} {m_rng.group(3)}{yr_part}", today_ymd)
            end_date, end_ymd, _ = parse_aus_date_str(f"{m_rng.group(2)} {m_rng.group(3)}{yr_part}", today_ymd)
            if end_ymd and end_ymd < today_ymd:
                continue
        else:
            md = re.search(r'\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*(?:\s+20\d{2})?\b', raw_date_blob, re.I)
            start_date, ymd, disp = parse_aus_date_str(md.group(0) if md else "", today_ymd)
            if ymd and ymd < today_ymd:
                continue

        if not ymd:
            continue

        seen_urls.add(url)
        mi = re.search(r'<img[^>]+(?:data-src|src)=["\']([^"\']+)["\']', ctx_block, re.I)
        img = mi.group(1) if mi else ""
        if not is_clean_seq_event(title, "Brisbane Powerhouse, New Farm", title, url):
            continue

        events.append(_build_event(
            prefix="bph",
            title=title,
            ymd=ymd,
            start_date=start_date,
            end_date=end_date,
            time_str=disp if not end_date else f"{disp.split(' · ')[0]} season",
            location="Brisbane Powerhouse, New Farm",
            source="Brisbane Powerhouse Official",
            source_url=url,
            image_url=img,
            base_url=origin,
            description=f"{title} live at Brisbane Powerhouse, New Farm ({raw_date_blob[:60]}).",
            insider_tip="Grab sunset cocktails at Mary Mae's on the river deck before your show in the Turbine Platform or Theatre.",
            price="Official Tickets",
            raw_cat="",
            extra_tags=["Brisbane Powerhouse", "New Farm"],
            priority=1,
        ))
    return events


def _parse_brisent_page(body: str, today_ymd: str) -> list[dict]:
    events = []
    seen_keys = set()
    origin = "https://www.brisent.com.au"
    # Match SmartSlider / Elementor cards with aria-label="Upcoming Event <Title> on <Date> | <Time>..."
    for m in re.finditer(
        r'aria-label=["\']Upcoming Event\s+(.+?)\s+on\s+([A-Za-z]+\s+\d{1,2}\s+[A-Za-z]+\s+20\d{2})\s*\|\s*([^"\']+)["\'][^>]*>',
        body,
        re.I,
    ):
        title = clean_text(m.group(1))
        date_str = clean_text(m.group(2))
        time_raw = clean_text(m.group(3)).split("|")[0]
        ctx = body[max(0, m.start() - 350):min(len(body), m.end() + 700)]
        mu = re.search(r'(?:data-href|href)=["\'](https?://www\.brisent\.com\.au/[^"\']+|/[^"\']+)["\']', ctx, re.I)
        url = resolve_url(mu.group(1), origin) if mu else f"{origin}/events/"
        mi = re.search(r'<img[^>]+(?:data-src|src)=["\']([^"\']+)["\']', ctx, re.I)
        img = mi.group(1) if mi else ""

        start_date, ymd, disp = parse_aus_date_str(date_str, today_ymd, raw_time=time_raw)
        if not ymd or ymd < today_ymd:
            continue
        k = (title.lower(), ymd)
        if k in seen_keys:
            continue
        seen_keys.add(k)
        loc = "Brisbane Entertainment Centre, Boondall"
        if not is_clean_seq_event(title, loc, title, url):
            continue

        events.append(_build_event(
            prefix="bec",
            title=title,
            ymd=ymd,
            start_date=start_date,
            time_str=disp,
            location=loc,
            source="Brisbane Entertainment Centre Official",
            source_url=url,
            image_url=img,
            base_url=origin,
            description=f"{title} live in arena at Brisbane Entertainment Centre, Boondall on {disp}.",
            insider_tip="Take the Shorncliffe line train straight to Boondall Station — short covered walk directly to the arena.",
            price="Official Tickets",
            raw_cat="MusicEvent",
            extra_tags=["Brisbane Entertainment Centre", "Boondall", "Arena"],
            priority=1,
        ))
    return events


def _parse_eatons_hill_page(body: str, today_ymd: str) -> list[dict]:
    events = []
    origin = "https://www.eatonshillhotel.com.au"
    blocks = re.split(r'<div[^>]+class=["\'][^"\']*event-ticket[^"\']*["\']', body, flags=re.I)
    for blk in blocks[1:]:
        mh = re.search(r'<h3[^>]*>(.*?)</h3>', blk, re.S | re.I)
        md = re.search(r'class=["\'][^"\']*event-date[^"\']*["\'][^>]*>(.*?)</div>', blk, re.S | re.I)
        if not mh or not md:
            continue
        title = clean_text(mh.group(1))
        date_raw = clean_text(md.group(1))
        start_date, ymd, disp = parse_aus_date_str(date_raw, today_ymd)
        if not ymd or ymd < today_ymd:
            continue
        mu = re.search(r'<a[^>]+href=["\']([^"\']+)["\']', blk, re.I)
        url = resolve_url(mu.group(1), origin) if mu else f"{origin}/entertainment/"
        mi = re.search(r'background-image:\s*url\((["\']?)(.*?)\1\)', blk, re.I)
        img = mi.group(2) if mi else ""
        loc = "Eatons Hill Hotel, Eatons Hill"
        if not is_clean_seq_event(title, loc, title, url):
            continue

        events.append(_build_event(
            prefix="ehh",
            title=title,
            ymd=ymd,
            start_date=start_date,
            time_str=disp,
            location=loc,
            source="Eatons Hill Hotel Official",
            source_url=url,
            image_url=img,
            base_url=origin,
            description=f"{title} live at Eatons Hill Hotel on {disp}.",
            insider_tip="Book bistro dinner or hotel accommodation on site for an easy northside concert night.",
            price="Official Tickets",
            raw_cat="MusicEvent",
            extra_tags=["Eatons Hill Hotel", "Eatons Hill"],
            priority=1,
        ))
    return events


# ==============================================================================
# 4. GENERIC JSON-LD SITES (Songkick, Moshtix, Eventbrite, Tourism & Culture)
# ==============================================================================

def _parse_jsonld_page(
    body: str,
    today_ymd: str,
    *,
    prefix: str,
    source: str,
    base_url: str,
    default_loc: str,
    strip_songkick_at: bool = False,
    forced_cat: str = "",
    priority: int = 2,
) -> list[dict]:
    events = []
    for node in extract_json_ld_events(body):
        raw_title = clean_text(str(node.get("name") or ""))
        if not raw_title:
            continue

        loc = _location_from_jsonld(node.get("location"), default_loc)
        title = raw_title
        if strip_songkick_at and " @ " in raw_title:
            artist_part, venue_part = raw_title.split(" @ ", 1)
            title = clean_text(artist_part)
            if venue_part and (loc == default_loc or default_loc.lower() == "brisbane"):
                loc = canonicalize_venue_location(venue_part, default_loc, default_loc)

        url = resolve_url(str(node.get("url") or ""), base_url)
        start_raw = str(node.get("startDate") or "")
        end_raw = str(node.get("endDate") or "")
        start_date, ymd, disp = parse_iso_datetime(start_raw)
        if not ymd:
            start_date, ymd, disp = parse_aus_date_str(start_raw, today_ymd)
        if not ymd:
            continue

        end_date, end_ymd, _ = parse_iso_datetime(end_raw)
        if not end_ymd:
            end_date, end_ymd, _ = parse_aus_date_str(end_raw, today_ymd)
        if (end_ymd or ymd) < today_ymd:
            continue

        desc = clean_text(str(node.get("description") or ""))
        img = _image_from_jsonld(node.get("image"))
        price = _price_from_jsonld(node.get("offers"))
        t_val = node.get("@type")
        raw_cat = forced_cat or (" ".join(t_val) if isinstance(t_val, list) else str(t_val or ""))

        if not is_clean_seq_event(title, loc, desc, url):
            continue

        events.append(_build_event(
            prefix=prefix,
            title=title,
            ymd=ymd,
            start_date=start_date,
            end_date=end_date,
            time_str=disp,
            location=loc,
            source=source,
            source_url=url,
            image_url=img,
            base_url=base_url,
            description=desc,
            price=price,
            raw_cat=raw_cat,
            priority=priority,
        ))
    return events


# ==============================================================================
# 5. EVENTFINDA AUSTRALIA (h-event vevent microformats across SEQ)
# ==============================================================================

def _parse_eventfinda_page(body: str, default_loc: str, today_ymd: str) -> list[dict]:
    events = []
    origin = "https://www.eventfinda.com.au"
    blocks = re.split(r'<div[^>]+class=["\'][^"\']*\bh-event\s+vevent\b[^"\']*["\']', body, flags=re.I)
    for blk in blocks[1:]:
        mu = re.search(r'<a[^>]+class=["\'][^"\']*card-image[^"\']*["\'][^>]+href=["\']([^"\']+)["\']', blk, re.I)
        if not mu:
            mu = re.search(r'<a[^>]+href=["\'](/[^"\']+)["\']', blk, re.I)
        mt = re.search(r'class=["\'][^"\']*p-name\s+summary[^"\']*["\'][^>]*>(.*?)</', blk, re.S | re.I)
        if not mt:
            mt = re.search(r'<h2[^>]*>(.*?)</h2>', blk, re.S | re.I)
        md = re.search(r'title=["\'](20\d{2}-\d{2}-\d{2}T[^"\']+)["\']', blk, re.I)
        if not (mu and mt and md):
            continue

        title = clean_text(mt.group(1))
        url = resolve_url(mu.group(1), origin)
        start_date, ymd, disp = parse_iso_datetime(md.group(1))
        if not ymd or ymd < today_ymd:
            continue

        ml = re.search(r'class=["\'][^"\']*p-location[^"\']*["\'][^>]*>(.*?)<', blk, re.S | re.I)
        raw_loc = clean_text(ml.group(1)) if ml else ""
        loc = canonicalize_venue_location(raw_loc, default_loc, default_loc)
        mc = re.search(r'class=["\'][^"\']*category[^"\']*["\'][^>]*>(.*?)<', blk, re.S | re.I)
        raw_cat = clean_text(mc.group(1)) if mc else ""
        mi = re.search(r'(?:data-src|src)=["\']([^"\']+)["\']', blk, re.I)
        img = mi.group(1) if mi else ""

        if not is_clean_seq_event(title, loc, raw_cat, url):
            continue

        events.append(_build_event(
            prefix="ef",
            title=title,
            ymd=ymd,
            start_date=start_date,
            time_str=disp,
            location=loc,
            source="Eventfinda Queensland",
            source_url=url,
            image_url=img,
            base_url=origin,
            description=f"{title} on {disp} at {loc}.",
            raw_cat=raw_cat,
            priority=2,
        ))
    return events


# ==============================================================================
# MASTER ORCHESTRATOR
# ==============================================================================

def pull_all_seq_live_events(today_ymd: str) -> list[dict]:
    """
    Fetch and parse all live Brisbane & SEQ event sources concurrently.
    Returns normalized candidate event dicts ordered by source authority (_priority).
    """
    jobs: list[tuple[str, str, callable]] = []

    # 1. Stadiums QLD
    for site in STADIUM_SITES:
        jobs.append((
            site["source"],
            site["url"],
            lambda body, s=site: _parse_stadium_page(s, body, today_ymd),
        ))

    # 2. Craft CMS Venues (Tivoli, Princess Theatre)
    for v in CRAFT_VENUES:
        jobs.append((
            v["source"],
            v["url"],
            lambda body, vn=v: _parse_craft_venue_page(vn, body, today_ymd),
        ))

    # 3. Direct Major Venues
    jobs.append(("QPAC Official", "https://www.qpac.com.au/whats-on", lambda b: _parse_qpac_page(b, today_ymd)))
    jobs.append(("Brisbane Powerhouse Official", "https://brisbanepowerhouse.org/?section=whats-on", lambda b: _parse_powerhouse_page(b, today_ymd)))
    jobs.append(("Brisbane Entertainment Centre Official", "https://www.brisent.com.au/events/", lambda b: _parse_brisent_page(b, today_ymd)))
    jobs.append(("Eatons Hill Hotel Official", "https://www.eatonshillhotel.com.au/entertainment/", lambda b: _parse_eatons_hill_page(b, today_ymd)))

    # 4. Editorial JSON-LD
    jobs.append((
        "Concrete Playground Brisbane",
        "https://concreteplayground.com/brisbane/events",
        lambda b: _parse_jsonld_page(
            b, today_ymd, prefix="reg", source="Concrete Playground Brisbane",
            base_url="https://concreteplayground.com", default_loc="Brisbane", priority=1,
        ),
    ))

    # 5. Songkick Brisbane & Gold Coast (Concerts across FMH, Triffid, Riverstage, Tivoli, etc.)
    for page in range(1, 6):
        jobs.append((
            f"Songkick Brisbane p{page}",
            f"https://www.songkick.com/metro-areas/26778-australia-brisbane?page={page}",
            lambda b: _parse_jsonld_page(
                b, today_ymd, prefix="sk", source="Songkick Concerts", base_url="https://www.songkick.com",
                default_loc="Brisbane", strip_songkick_at=True, forced_cat="MusicEvent", priority=2,
            ),
        ))
    jobs.append((
        "Songkick Gold Coast p1",
        "https://www.songkick.com/metro-areas/26780-australia-gold-coast",
        lambda b: _parse_jsonld_page(
            b, today_ymd, prefix="sk", source="Songkick Concerts", base_url="https://www.songkick.com",
            default_loc="Gold Coast, QLD", strip_songkick_at=True, forced_cat="MusicEvent", priority=2,
        ),
    ))

    # 6. Moshtix SEQ
    for q, dl in [
        ("brisbane", "Brisbane"),
        ("fortitude+valley", "Fortitude Valley, Brisbane"),
        ("gold+coast", "Gold Coast, QLD"),
        ("sunshine+coast", "Sunshine Coast, QLD"),
    ]:
        jobs.append((
            f"Moshtix {q}",
            f"https://www.moshtix.com.au/v2/search?query={q}",
            lambda b, loc_d=dl: _parse_jsonld_page(
                b, today_ymd, prefix="mosh", source="Moshtix", base_url="https://www.moshtix.com.au",
                default_loc=loc_d, priority=2,
            ),
        ))

    # 7. Eventbrite Australia SEQ
    for slug, page, dl in [
        ("australia--brisbane-city", 1, "Brisbane"),
        ("australia--brisbane-city", 2, "Brisbane"),
        ("australia--gold-coast", 1, "Gold Coast, QLD"),
        ("australia--sunshine-coast", 1, "Sunshine Coast, QLD"),
        ("australia--ipswich", 1, "Ipswich, QLD"),
        ("australia--logan", 1, "Logan, QLD"),
    ]:
        jobs.append((
            f"Eventbrite {slug} p{page}",
            f"https://www.eventbrite.com.au/d/{slug}/events/?page={page}",
            lambda b, loc_d=dl: _parse_jsonld_page(
                b, today_ymd, prefix="eb", source="Eventbrite Australia", base_url="https://www.eventbrite.com.au",
                default_loc=loc_d, priority=3,
            ),
        ))

    # 8. Eventfinda SEQ
    for path, dl in [
        ("brisbane", "Brisbane"),
        ("brisbane/page/2", "Brisbane"),
        ("gold-coast", "Gold Coast, QLD"),
        ("sunshine-coast", "Sunshine Coast, QLD"),
        ("ipswich", "Ipswich, QLD"),
        ("moreton-bay-region", "Moreton Bay, QLD"),
    ]:
        jobs.append((
            f"Eventfinda {path}",
            f"https://www.eventfinda.com.au/whatson/events/{path}",
            lambda b, loc_d=dl: _parse_eventfinda_page(b, loc_d, today_ymd),
        ))

    results: list[dict] = []
    source_stats: dict[str, int] = {}

    def run_job(job: tuple[str, str, callable]):
        name, url, parser = job
        body = fetch_text(url)
        if not body:
            return name, []
        try:
            return name, parser(body)
        except Exception:
            return name, []

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        for name, evs in pool.map(run_job, jobs):
            source_stats[name] = len(evs)
            results.extend(evs)

    # Sort highest-authority official venue listings first so dedupe prefers direct venue pages
    results.sort(key=lambda e: (e.get("_priority", 2), e.get("start_date") or "9999-12-31"))
    for ev in results:
        ev.pop("_priority", None)

    non_zero = {k: v for k, v in source_stats.items() if v > 0}
    print(f"   Multi-site SEQ pull: {len(results)} raw items across {len(non_zero)}/{len(jobs)} live pages")
    return results


if __name__ == "__main__":
    today = datetime.now().strftime("%Y-%m-%d")
    evs = pull_all_seq_live_events(today)
    print(f"Total pulled: {len(evs)}")
    by_src: dict[str, int] = {}
    for e in evs:
        by_src[e["source"]] = by_src.get(e["source"], 0) + 1
    for src, cnt in sorted(by_src.items(), key=lambda x: -x[1]):
        print(f"  {src}: {cnt}")
    rw = [e for e in evs if "robbie williams" in e["title"].lower()]
    print("Robbie Williams matches:", json.dumps(rw, indent=2))

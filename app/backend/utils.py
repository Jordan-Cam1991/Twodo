"""
Utilities for TwoDo: iCalendar (.ics) generation, text formatters, and helpers.
"""
from datetime import datetime, timedelta

def generate_ics_calendar(planner_items, couple_names="Emma & Partner"):
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//TwoDo//Couple Adventure Planner//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{couple_names} Date Planner",
        "X-WR-TIMEZONE:Australia/Brisbane"
    ]

    slot_hours = {
        "morning": (10, 0, 12, 0),
        "afternoon": (14, 0, 16, 30),
        "evening": (18, 30, 21, 30),
        "night": (20, 0, 23, 0)
    }

    now_stamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")

    for idx, item in enumerate(planner_items):
        date_str = item.get("scheduled_date") or item.get("planner_date")
        if not date_str:
            continue

        try:
            d_parts = [int(p) for p in date_str.split("-")]
            base_date = datetime(d_parts[0], d_parts[1], d_parts[2])
        except Exception:
            continue

        slot = (item.get("time_slot") or item.get("planner_slot") or "evening").lower()
        sh, sm, eh, em = slot_hours.get(slot, (18, 0, 21, 0))

        start_dt = base_date.replace(hour=sh, minute=sm)
        end_dt = base_date.replace(hour=eh, minute=em)

        dt_start_str = start_dt.strftime("%Y%m%dT%H%M%S")
        dt_end_str = end_dt.strftime("%Y%m%dT%H%M%S")

        uid = f"twodo-event-{item.get('id', idx)}-{dt_start_str}@twodo.app"
        title = item.get("title", "Couple Date Night").replace("\n", " ").replace(";", "\\;")
        location = item.get("location_name", "").replace("\n", " ").replace(";", "\\;")
        notes = item.get("notes") or item.get("planner_notes") or item.get("description") or "Planned with TwoDo"
        notes_clean = notes.replace("\n", "\\n").replace(";", "\\;")

        lines.extend([
            "BEGIN:VEVENT",
            f"UID:{uid}",
            f"DTSTAMP:{now_stamp}",
            f"DTSTART:{dt_start_str}",
            f"DTEND:{dt_end_str}",
            f"SUMMARY:❤️ {title}",
            f"LOCATION:{location}",
            f"DESCRIPTION:{notes_clean}",
            "STATUS:CONFIRMED",
            "END:VEVENT"
        ])

    lines.append("END:VCALENDAR")
    return "\r\n".join(lines)

def format_text_summary(planner_items, couple_names="Emma & Partner"):
    if not planner_items:
        return "No dates scheduled yet! Pick a few exciting things in TwoDo."

    lines = [f"✨ Our Upcoming Dates ({couple_names}) ✨", ""]
    for item in planner_items:
        date_display = item.get("scheduled_date") or item.get("planner_date") or "TBD"
        slot = (item.get("time_slot") or item.get("planner_slot") or "Evening").capitalize()
        title = item.get("title", "Date")
        loc = item.get("location_name", "")
        tip = item.get("insider_tip", "")
        
        lines.append(f"📅 {date_display} ({slot})")
        lines.append(f"   ❤️ {title}")
        if loc:
            lines.append(f"   📍 {loc}")
        if tip:
            lines.append(f"   💡 Tip: {tip}")
        lines.append("")

    lines.append("Planned with TwoDo 💫")
    return "\n".join(lines)

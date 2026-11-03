"""
Eventbrite Public Connector
Searches upcoming events from Eventbrite for a given city and category.
"""
import urllib.request
import urllib.parse
import json
import logging

logger = logging.getLogger("twodo.eventbrite")

def fetch_eventbrite_events(city="Brisbane", lat=None, lng=None, api_key=None):
    if not api_key:
        return []

    try:
        url = f"https://www.eventbriteapi.com/v3/events/search/?q=events&location.address={urllib.parse.quote(city)}&token={api_key}"
        req = urllib.request.Request(url, headers={"User-Agent": "TwoDoPlanner/1.0"})
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode("utf-8"))
        
        events = []
        for ev in data.get("events", []):
            name = ev.get("name", {}).get("text", "Event")
            desc = ev.get("description", {}).get("text", "")[:200]
            url = ev.get("url", "")
            logo = ev.get("logo", {})
            img = logo.get("url") if logo else "https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=800&q=80"
            start = ev.get("start", {}).get("local", "")
            is_free = ev.get("is_free", False)

            events.append({
                "id": f"eb-{ev.get('id')}",
                "title": name,
                "description": desc or f"Exciting event happening in {city}.",
                "category": "Markets & Pop-ups" if "market" in name.lower() else "Arts & Culture",
                "source": "Eventbrite",
                "source_url": url,
                "image_url": img,
                "location_name": f"{city} Event Space",
                "city": city,
                "lat": lat,
                "lng": lng,
                "start_date": start,
                "end_date": start,
                "time_str": start.replace("T", " ") if start else "Check listing",
                "price_level": "Free" if is_free else "$$",
                "price_str": "Free" if is_free else "Tickets on Eventbrite",
                "tags": ["Eventbrite", "Community", "Gathering"],
                "insider_tip": "Check registration requirements in advance."
            })
        return events
    except Exception as e:
        logger.debug(f"Eventbrite API call failed: {e}")
        return []

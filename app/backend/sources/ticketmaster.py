"""
Ticketmaster Discovery API Connector
Pulls live events from Ticketmaster for a specified city or coordinates.
"""
import urllib.request
import urllib.parse
import json
import logging
from datetime import datetime

logger = logging.getLogger("twodo.ticketmaster")

def fetch_ticketmaster_events(city="Brisbane", lat=None, lng=None, api_key=None):
    if not api_key:
        return []

    try:
        params = {
            "apikey": api_key,
            "size": 20,
            "sort": "date,asc",
        }
        if lat and lng:
            params["latlong"] = f"{lat},{lng}"
            params["radius"] = "35"
            params["unit"] = "km"
        else:
            params["city"] = city

        query_str = urllib.parse.urlencode(params)
        url = f"https://app.ticketmaster.com/discovery/v2/events.json?{query_str}"
        
        req = urllib.request.Request(url, headers={"User-Agent": "TwoDoCouplePlanner/1.0"})
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode("utf-8"))

        events = []
        raw_events = data.get("_embedded", {}).get("events", [])
        for item in raw_events:
            event_id = f"tm-{item.get('id')}"
            title = item.get("name", "Event")
            url = item.get("url", "")
            
            images = item.get("images", [])
            img_url = "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=800&q=80"
            if images:
                best_img = sorted(images, key=lambda x: x.get("width", 0), reverse=True)
                img_url = best_img[0].get("url", img_url)

            dates_info = item.get("dates", {}).get("start", {})
            start_date = dates_info.get("localDate", "")
            start_time = dates_info.get("localTime", "")
            time_display = f"{start_date} {start_time}".strip()

            venues = item.get("_embedded", {}).get("venues", [])
            venue_name = "Local Venue"
            venue_lat = lat
            venue_lng = lng
            if venues:
                v = venues[0]
                venue_name = f"{v.get('name', '')}, {v.get('city', {}).get('name', city)}"
                if "location" in v:
                    try:
                        venue_lat = float(v["location"].get("latitude", lat))
                        venue_lng = float(v["location"].get("longitude", lng))
                    except (ValueError, TypeError):
                        pass

            classifications = item.get("classifications", [])
            segment = "Music & Concerts"
            if classifications:
                seg_name = classifications[0].get("segment", {}).get("name", "")
                if "Music" in seg_name:
                    segment = "Music & Concerts"
                elif "Arts" in seg_name or "Theatre" in seg_name:
                    segment = "Arts & Culture"
                elif "Sports" in seg_name:
                    segment = "Outdoor & Adventure"
                elif "Comedy" in seg_name:
                    segment = "Comedy & Shows"

            price_ranges = item.get("priceRanges", [])
            price_str = "See ticketing link"
            price_level = "$$"
            if price_ranges:
                p_min = price_ranges[0].get("min", 0)
                p_max = price_ranges[0].get("max", 0)
                curr = price_ranges[0].get("currency", "$")
                price_str = f"{curr}{int(p_min)} - {curr}{int(p_max)}" if p_max > p_min else f"{curr}{int(p_min)}"
                if p_min == 0:
                    price_level = "Free"
                elif p_min < 30:
                    price_level = "$"
                elif p_min < 80:
                    price_level = "$$"
                else:
                    price_level = "$$$"

            events.append({
                "id": event_id,
                "title": title,
                "description": f"Live event at {venue_name}. Book through Ticketmaster for official tickets.",
                "category": segment,
                "source": "Ticketmaster",
                "source_url": url,
                "image_url": img_url,
                "location_name": venue_name,
                "city": city,
                "lat": venue_lat,
                "lng": venue_lng,
                "start_date": time_display,
                "end_date": time_display,
                "time_str": time_display,
                "price_level": price_level,
                "price_str": price_str,
                "tags": ["Live Show", "Ticketing", segment],
                "insider_tip": "Secure tickets early as popular dates often sell out in advance."
            })

        return events
    except Exception as e:
        logger.warning(f"Error fetching from Ticketmaster: {e}")
        return []

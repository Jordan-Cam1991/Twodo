"""
Live Web Events Connector
Queries public event discovery search feeds and city-specific 'What's On' portals.
"""
import urllib.request
import urllib.parse
import json
import logging

logger = logging.getLogger("twodo.web_search")

def fetch_web_events(city="Brisbane", lat=None, lng=None):
    clean_city = city.strip().lower()
    results = []

    search_query = f"{city} events date night weekend festival"
    encoded = urllib.parse.quote(search_query)
    
    try:
        url = f"https://api.duckduckgo.com/?q={encoded}&format=json&no_html=1&skip_disambig=1"
        req = urllib.request.Request(url, headers={"User-Agent": "TwoDoPlanner/1.0"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            
        topics = data.get("RelatedTopics", [])
        for i, t in enumerate(topics[:5]):
            text = t.get("Text", "")
            first_url = t.get("FirstURL", "")
            if text and len(text) > 20:
                parts = text.split(" - ", 1)
                title = parts[0]
                desc = parts[1] if len(parts) > 1 else text
                results.append({
                    "id": f"web-{clean_city}-{i+1}",
                    "title": f"Experience {title}",
                    "description": desc,
                    "category": "Sightseeing & Nature",
                    "source": "Web Search",
                    "source_url": first_url or f"https://www.google.com/search?q={encoded}",
                    "image_url": "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80",
                    "location_name": f"{city} Metro",
                    "city": city,
                    "lat": lat,
                    "lng": lng,
                    "start_date": "Ongoing this month",
                    "end_date": "Ongoing this month",
                    "time_str": "Check venue hours",
                    "price_level": "$",
                    "price_str": "Varies by venue",
                    "tags": ["Featured", "City Highlight", "Web Discovery"],
                    "insider_tip": "Check operating hours and parking options ahead of time."
                })
    except Exception as e:
        logger.debug(f"Web event search skipped: {e}")

    return results

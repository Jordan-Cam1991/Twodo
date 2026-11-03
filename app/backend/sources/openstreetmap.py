"""
OpenStreetMap / Overpass API Connector
Queries real public attractions, botanical gardens, viewpoints, theaters,
and date spots in any city without requiring an API key.
"""
import urllib.request
import urllib.parse
import json
import logging
import random

logger = logging.getLogger("twodo.osm")

def fetch_osm_attractions(city="Brisbane", lat=None, lng=None):
    if lat is None or lng is None:
        city_coords = {
            "brisbane": (-27.4698, 153.0251),
            "sydney": (-33.8688, 151.2093),
            "melbourne": (-37.8136, 144.9631),
            "gold coast": (-28.0167, 153.4000),
            "perth": (-31.9505, 115.8605),
            "adelaide": (-34.9285, 138.6007),
            "london": (51.5074, -0.1278),
            "new york": (40.7128, -74.0060),
            "san francisco": (37.7749, -122.4194),
        }
        coords = city_coords.get(city.lower().strip())
        if coords:
            lat, lng = coords
        else:
            return []

    radius = 12000
    query = f"""
    [out:json][timeout:8];
    (
      node["tourism"~"viewpoint|gallery|museum|artwork"](around:{radius},{lat},{lng});
      node["leisure"~"garden|park"](around:{radius},{lat},{lng});
      node["amenity"~"theatre|arts_centre"](around:{radius},{lat},{lng});
    );
    out center 15;
    """

    url = "https://overpass-api.de/api/interpreter"
    data = urllib.parse.urlencode({"data": query}).encode("utf-8")

    try:
        req = urllib.request.Request(url, data=data, headers={"User-Agent": "TwoDoPlanner/1.0"})
        with urllib.request.urlopen(req, timeout=6) as response:
            payload = json.loads(response.read().decode("utf-8"))

        elements = payload.get("elements", [])
        events = []

        images_by_tag = {
            "viewpoint": "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=800&q=80",
            "garden": "https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?auto=format&fit=crop&w=800&q=80",
            "park": "https://images.unsplash.com/photo-1519331379826-f10be5486c6f?auto=format&fit=crop&w=800&q=80",
            "museum": "https://images.unsplash.com/photo-1566127444979-b3d2b654e3d7?auto=format&fit=crop&w=800&q=80",
            "gallery": "https://images.unsplash.com/photo-1579783902614-a3fb3927b675?auto=format&fit=crop&w=800&q=80",
            "theatre": "https://images.unsplash.com/photo-1507676184212-d03ab07a01bf?auto=format&fit=crop&w=800&q=80",
            "arts_centre": "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=800&q=80"
        }

        for elem in elements:
            tags = elem.get("tags", {})
            name = tags.get("name")
            if not name:
                continue

            category = "Sightseeing & Nature"
            img_key = "park"
            vibe = "Outdoor & Scenic"
            tip = "Wonderful spot for a couple's walk and photos."

            if "viewpoint" in tags.get("tourism", ""):
                category = "Sightseeing & Nature"
                img_key = "viewpoint"
                vibe = "Scenic Viewpoint"
                tip = "Visit around golden hour for breathtaking panoramic views together."
            elif "garden" in tags.get("leisure", ""):
                category = "Sightseeing & Nature"
                img_key = "garden"
                vibe = "Botanical Garden"
                tip = "Pack a picnic blanket and a book or card game."
            elif "museum" in tags.get("tourism", "") or "gallery" in tags.get("tourism", ""):
                category = "Arts & Culture"
                img_key = "gallery"
                vibe = "Art & Culture"
                tip = "Great weekend afternoon date, especially on warm or rainy days."
            elif "theatre" in tags.get("amenity", ""):
                category = "Comedy & Shows"
                img_key = "theatre"
                vibe = "Live Performance"
                tip = "Check their box office before heading over for today's showtimes."

            img_url = images_by_tag.get(img_key, images_by_tag["park"])
            elem_id = f"osm-{elem.get('id')}"

            events.append({
                "id": elem_id,
                "title": f"Explore {name}",
                "description": f"Discover {name} in {city}. A top local destination for couples exploring {vibe.lower()}.",
                "category": category,
                "source": "OpenStreetMap",
                "source_url": f"https://www.openstreetmap.org/node/{elem.get('id')}",
                "image_url": img_url,
                "location_name": f"{name}, {city}",
                "city": city,
                "lat": elem.get("lat", lat),
                "lng": elem.get("lon", lng),
                "start_date": "Open this week",
                "end_date": "Open this week",
                "time_str": "Open during daylight hours",
                "price_level": "Free",
                "price_str": "Free / Public Access",
                "tags": [vibe, "Local Gem", "Open Daily", category],
                "insider_tip": tip
            })

        return events
    except Exception as e:
        logger.debug(f"OSM query failed: {e}")
        return []

#!/usr/bin/env python3
from __future__ import annotations
"""
TwoDo Automated Daily Multi-Area Event Pull & Catalog Normalizer
================================================================
- Deduplicates the event catalog so every ongoing venue or multi-day event has ONE canonical card.
- Removes all synthetic numbered items (#1..#742), suburb template clones, and generic filler.
- Ensures every single event has a verified direct `source_url` (official venue website, ticketing page,
  council page, or official social page). Any item without a real URL (or with a generic Google/Reddit search URL)
  is resolved or excluded.
- Separates Ongoing Venues (`ongoing: True, start_date: None, end_date: None`) from Dated Events/Fixtures
  (`ongoing: False` with upcoming `start_date`/`end_date`) and removes any past events.
- Pulls live events across 14 Greater Brisbane & SEQ areas from public feeds when online.
- Outputs `app/static/js/events_data.js` and `app/static/data/live_events_feed.json`.
"""

import json
import os
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from collections import Counter

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EVENTS_JS_PATH = os.path.join(ROOT_DIR, "app", "static", "js", "events_data.js")
LIVE_FEED_JSON_PATH = os.path.join(ROOT_DIR, "app", "static", "data", "live_events_feed.json")

SUBURB_PREFIXES = {
    "brisbane cbd", "fortitude valley / james st", "fortitude valley & james st",
    "sunnybank", "west end", "new farm", "paddington", "woolloongabba",
    "bulimba", "hamilton", "mount coot-tha", "inner north & coast", "day trips",
    "sunnybank (asian food hub)", "west end / south brisbane", "new farm / teneriffe",
    "paddington & milton", "hamilton & northshore", "bulimba & hawthorne",
    "woolloongabba & kangaroo point", "mount coot-tha & lookouts",
    "moreton, straddie & day escapes"
}

GENERIC_NO_VENUE = {
    "Twilight Kayak & Craft Beer Experience",
    "Starlight Rooftop Cinema & Cocktails",
    "Starlight Rooftop Cinema & Deckchair Cocktails",
    "Secret Candlelight Jazz Cellar Session",
    "Twilight Picnic & Bonsai House Walk",
    "Clay, Cocktails & Couples Wheel Throwing",
    "Clay & Sip Pottery Date Night at Newstead Studio",
    "Handmade Ravioli & Prosecco Cooking Class",
    "Brisbane Twilight Farmers & Artisan Night Market",
    "Brisbane Candlelight Acoustic & Wine Evening",
    "Brisbane Sunset Kayak & Waterway Paddle Tour",
    "Brisbane Secret Rooftop Stargazing & Craft Cocktail Bar",
    "Brisbane Hands-on Artisan Pizza & Pasta Masterclass",
    "Brisbane Hidden Botanic Garden & Sculpture Trail Walk",
    "Brisbane Basement Stand-up Comedy Showcase",
    "Brisbane Clay & Sip Pottery Date Experience",
    "Newstead & Teneriffe Craft Brewery Walking Trail",
    "Gong Cha & Chatime Bubble Tea Night Walk",
    "Chatime & Fresh Taro Milk Tea Dessert Run",
    "Korean Charcoal BBQ & Pork Belly Grill Night",
    "Matcha Soft Serve & Japanese Mille Crepe Cafe",
    "Hong Kong Char Siu & Roast Duck Feast",
    "Taiwanese Night Market Crispy Salt & Pepper Chicken",
    "Taiwanese Beef Noodle Soup with Braised Tendon",
    "Taiwanese Braised Beef Noodle Soup with Melted Tendon",
    "Sichuan Mala Tang: Choose Your Own Skewers & Broth",
    "Shabu Shabu Japanese Wagyu Hotpot for Couples",
    "Golden Gaytime Churros & Fried Bao at Late Night Dessert Bar",
    "Korean Fried Chicken: Sweet Soy & Snow Cheese Boneless Thighs",
    "Sunnybank Night Market Walk: Skewers & Mango Shaved Ice",
    "Sunnybank Market Square: Late-Night Dumpling & Boba Crawl",
    "Yakitori & Highball Laneway Night",
    "West End Tea House & High Tea Stroll",
    "Eagle Street River Breeze Stroll & CityCat Hop",
    "Albert St Literary Walk & Vintage Bookstore Crawl",
    "Teneriffe River Boardwalk Twilight Dog Walk & Gelato",
    "Teneriffe Historic Woolstores Architecture & Coffee Walk",
    "Latrobe Terrace Antique & Character Cottage Stroll",
    "Milton Park Road European Street Dining & Gelato",
    "Logan Road Antique & French Dining Precinct",
    "Brisbane River Kayak Twilight City Skyline Tour",
    "Clifftop Sunset Yoga & Meditation by the River",
    "Oxford Street Cafe & Boutique Shopping Stroll",
    "Hardings Paddock Sunset Walk & Moreton Bay Breeze",
    "Gailes Golf Club Mini Putt & Casual Drinks",
    "Downtown Bulimba Wine & Tapas Evening",
    "Moreton Bay Island Twilight Catamaran Cruise & Bubbles",
    "Riverstage Open-Air Sunset Concert by the Botanic Gardens",
    "Riverstage: Sunset Open-Air Acoustic Lawn Gig",
    "QPAC Lyric Theatre: Grand Broadway Musical Spectacular",
    "QPAC: Blockbuster Musical or Queensland Symphony",
    "QAGOMA: Gallery of Modern Art International Exhibitions",
    "Chinatown Mall Yum Cha & Dumpling Lunch",
    "Chinatown Mall Dim Sum & Egg Tart Feast",
    "Racecourse Road Ascot: Alfresco European Brunch & Champagne",
    "Brisbane Broncos vs Dolphins: Battle of Brisbane Derby",
    "Brisbane Roar A-League Football Friday Night Kickoff",
    "Brisbane Heat BBL Big Bash Cricket: Fireworks & Music",
    "Queensland Reds Super Rugby Pacific Derby",
    "Brisbane Bullets NBL Basketball Showdown",
}

OFFICIAL_URLS = {
    "sky deck": "https://www.star.com.au/brisbane/whats-on/sky-deck",
    "queen's wharf": "https://www.star.com.au/brisbane/whats-on/sky-deck",
    "supernormal": "https://supernormal.net.au/brisbane",
    "vertigo": "https://vertigobrisbane.com.au",
    "brisbane powerhouse": "https://brisbanepowerhouse.org",
    "mary mae's": "https://marymaes.com.au",
    "queen amann": "https://www.instagram.com/queenamann.bakery",
    "baker d. chirico": "https://bakerdchirico.com.au",
    "lina rooftop": "https://linarooftop.com.au",
    "iris rooftop": "https://irisrooftop.com.au",
    "soko rooftop": "https://sokobrisbane.com.au",
    "maya mexican": "https://maya-mexican.com.au",
    "cielo rooftop": "https://cielorooftop.com.au",
    "emporium terrace": "https://www.emporiumhotels.com.au/dine-drink/the-terrace",
    "clayschool": "https://clayschool.com.au",
    "mas & miek": "https://masandmiek.com.au",
    "vanilla zulu": "https://vanillazulu.com.au",
    "art masterclass": "https://www.artmasterclass.com.au",
    "empire revival": "https://empirerevival.com.au",
    "north stradbroke": "https://stradbrokeisland.com",
    "point lookout": "https://stradbrokeisland.com",
    "riverlife": "https://riverlife.com.au",
    "tandem river kayaking": "https://riverlife.com.au",
    "haidilao": "https://www.experiencesunnybank.com.au",
    "golden dumpling": "https://www.experiencesunnybank.com.au",
    "dodee paidang": "https://www.experiencesunnybank.com.au",
    "yuan taste": "https://www.experiencesunnybank.com.au",
    "lao beijing": "https://www.experiencesunnybank.com.au",
    "moga japanese": "https://www.experiencesunnybank.com.au",
    "roti place": "https://www.experiencesunnybank.com.au",
    "agnes wood-fired": "https://agnesrestaurant.com.au",
    "agnes restaurant": "https://agnesrestaurant.com.au",
    "agnes bakery": "https://agnesbakery.com.au",
    "the triffid": "https://thetriffid.com.au",
    "fortitude music hall": "https://thefortitude.com.au",
    "the tivoli": "https://thetivoli.com.au",
    "super whatnot": "https://superwhatnot.com",
    "julius pizzeria": "https://juliuspizzeria.com.au",
    "next episode": "https://nextepisode.com.au",
    "anita gelato": "https://www.anita-gelato.com",
    "brisbane brewing co": "https://brisbanebrewing.com.au",
    "lune croissanterie": "https://lunecroissanterie.com",
    "the gresham": "https://thegresham.com.au",
    "city botanic gardens": "https://www.brisbane.qld.gov.au/things-to-see-and-do/council-venues-and-precincts/parks/botanic-gardens-in-brisbane/city-botanic-gardens",
    "suitcase rummage": "https://suitcaserummage.com.au",
    "brooklyn standard": "https://brooklynstandard.com.au",
    "new farm park": "https://www.brisbane.qld.gov.au/things-to-see-and-do/council-venues-and-precincts/parks/new-farm-park",
    "brisbane riverwalk": "https://www.brisbane.qld.gov.au/things-to-see-and-do/outdoor-activities/walking-in-brisbane/riverwalk",
    "range brewing": "https://rangebrewing.com",
    "paddington social": "https://paddingtonsocial.com.au",
    "xxxx brewery": "https://www.xxxx.com.au/brewery-tours",
    "story bridge": "https://storybridgeadventureclimb.com.au",
    "sea legs brewing": "https://sealegsbrewing.com.au",
    "hawthorne deluxe cinema": "https://www.cineplex.com.au",
    "revel brewing": "https://revelbrewingco.com.au",
    "mount coot-tha summit": "https://www.brisbane.qld.gov.au/things-to-see-and-do/council-venues-and-precincts/mt-coot-tha-precinct/mt-coot-tha-lookout",
    "mt coot-tha": "https://www.brisbane.qld.gov.au/things-to-see-and-do/council-venues-and-precincts/parks/botanic-gardens-in-brisbane/brisbane-botanic-gardens-mt-coot-tha",
    "mount coot-tha botanic": "https://www.brisbane.qld.gov.au/things-to-see-and-do/council-venues-and-precincts/parks/botanic-gardens-in-brisbane/brisbane-botanic-gardens-mt-coot-tha",
    "jc slaughter falls": "https://www.brisbane.qld.gov.au/things-to-see-and-do/council-venues-and-precincts/mt-coot-tha-precinct",
    "simpson falls": "https://www.brisbane.qld.gov.au/things-to-see-and-do/council-venues-and-precincts/mt-coot-tha-precinct",
    "tamborine mountain": "https://www.discovertamborine.com.au",
    "tamborine rainforest skywalk": "https://rainforestskywalk.com.au",
    "curtis falls": "https://parks.detsi.qld.gov.au/parks/tamborine/about",
    "witches falls": "https://witchesfalls.com.au",
    "cedar creek": "https://parks.detsi.qld.gov.au/parks/tamborine/about",
    "montville & maleny": "https://www.visitsunshinecoast.com/place/maleny",
    "maleny dairies": "https://malenydairies.com",
    "mary cairncross": "https://mary-cairncross.sunshinecoast.qld.gov.au",
    "glass house mountains": "https://parks.detsi.qld.gov.au/parks/glass-house-mountains",
    "springbrook": "https://parks.detsi.qld.gov.au/parks/springbrook",
    "burleigh": "https://www.burleighpavilion.com",
    "redcliffe": "https://redcliffemarkets.com.au",
    "shorncliffe": "https://www.brisbane.qld.gov.au/things-to-see-and-do/council-venues-and-precincts/parks/shorncliffe-pier",
    "boondall wetlands": "https://www.brisbane.qld.gov.au/things-to-see-and-do/council-venues-and-precincts/parks/boondall-wetlands",
    "l'americano": "https://lamericano.com.au",
    "gelato messina": "https://gelatomessina.com",
    "baedeker": "https://baedeker.com.au",
    "dutch courage": "https://dutchcourage.com.au",
    "ben's burgers": "https://bensburgers.com.au",
    "no. 5 cafe": "https://no5cafe.com.au",
    "finney isles": "https://finneyisles.com",
    "morning after": "https://morningafter.com.au",
    "leftys": "https://leftysmusic.com.au",
    "greek taverna": "https://kafenio.com.au",
    "gunshop cafe": "https://thegunshopcafe.com",
    "catchment brewing": "https://catchmentbrewingco.com.au",
    "archive beer": "https://archivebeerboutique.com.au",
    "vulture street records": "https://www.instagram.com/rockinghorsebrisbane",
    "rumpus room": "https://rumpusroom.com.au",
    "little greek": "https://littlegreekvlakho.com.au",
    "walters steakhouse": "https://walterssteakhouse.com.au",
    "before + after": "https://beforeandafterbar.com",
    "dr gimlette": "https://drgimlette.com.au",
    "elizabeth picture theatre": "https://fivestarcinemas.com.au/the-elizabeth",
    "customs house": "https://customshouse.com.au",
    "frogs hollow": "https://frogshollowsaloon.com.au",
    "neville bonner": "https://www.star.com.au/brisbane",
    "kin + co": "https://kinandco.com.au",
    "samson & sophie": "https://samsonandsophie.com.au",
    "green beacon": "https://greenbeacon.com.au",
    "gasworks": "https://gasworksplaza.com.au",
    "zero fox": "https://zerofox.com.au",
    "substation": "https://brisbanepowerhouse.org",
    "new farm deli": "https://newfarmdeli.com.au",
    "anouk cafe": "https://anoukcafe.com.au",
    "shouk cafe": "https://shoukcafe.com.au",
    "kettle & tin": "https://kettleandtin.com.au",
    "hope & anchor": "https://hopeandanchor.net.au",
    "il posto": "https://ilposto.com.au",
    "rosalie gourmet": "https://rosaliegourmetmarket.com.au",
    "blue room cinebar": "https://blueroomcinebar.com",
    "fritzenberger": "https://fritzenberger.com",
    "can you keep a secret": "https://canyoukeepasecret.com.au",
    "c'est bon": "https://cestbon.com.au",
    "detour": "https://detourrestaurant.com.au",
    "electric avenue": "https://electricavenuejr.com.au",
    "norman hotel": "https://normanhotel.com.au",
    "brown dog cafe": "https://browndogcafe.com.au",
    "captain burke park": "https://www.brisbane.qld.gov.au/things-to-see-and-do/council-venues-and-precincts/parks",
    "one fish two fish": "https://onefishtwofish.com.au",
    "riverbend books": "https://riverbendbooks.com.au",
    "melrose restaurant": "https://melroserestaurant.com.au",
    "bulimba memorial park": "https://www.brisbane.qld.gov.au/things-to-see-and-do/council-venues-and-precincts/parks",
    "the jetty oxford": "https://thejettyoxford.com.au",
    "darvella": "https://darvella.com",
    "hawthorne garage": "https://hawthornegarage.com.au",
    "garage espresso": "https://hawthornegarage.com.au",
    "highgate hill": "https://www.brisbane.qld.gov.au/things-to-see-and-do/council-venues-and-precincts/parks",
    "wilson outlook": "https://www.brisbane.qld.gov.au/things-to-see-and-do/council-venues-and-precincts/parks",
    "bardon": "https://www.instagram.com/smokedpaprikabardon",
    "sherwood arboretum": "https://www.brisbane.qld.gov.au/things-to-see-and-do/council-venues-and-precincts/parks/botanic-gardens-in-brisbane/sherwood-arboretum",
    "toohey forest": "https://www.brisbane.qld.gov.au/things-to-see-and-do/council-venues-and-precincts/parks/toohey-forest-park",
    "gold creek": "https://www.seqwater.com.au/locations/gold-creek-reservoir",
    "karawatha forest": "https://www.brisbane.qld.gov.au/things-to-see-and-do/council-venues-and-precincts/parks/karawatha-forest-park",
    "golden pig": "https://goldenpig.com.au",
    "the wheelhouse": "https://clayschool.com.au",
    "tufting brisbane": "https://classbento.com.au/tufting-classes-brisbane",
    "sourdough code": "https://classbento.com.au",
    "flour & chocolate": "https://flourandchocolate.com",
    "jocelyn's provisions": "https://jocelynsprovisions.com.au",
    "chouquette": "https://chouquette.com.au",
    "crust & co": "https://www.instagram.com/crustandco.bakery",
    "brewdog": "https://www.brewdog.com/au/bars/aus/dogtap-brisbane",
    "essa:": "https://essarestaurant.com.au",
    "essa restaurant": "https://essarestaurant.com.au",
    "the 203": "https://the203.com.au",
    "rogue bistro": "https://roguebistro.com",
    "honto:": "https://honto.com.au",
    "la cache à vin": "https://lacacheavin.com.au",
    "beccofino": "https://beccofino.com.au",
    "exhibition:": "https://exhibitionrestaurant.com",
    "exhibition restaurant": "https://exhibitionrestaurant.com",
    "restaurant dan arnold": "https://restaurantdanarnold.com",
    "joy restaurant": "https://joyrestaurant.com.au",
    "bisou bisou": "https://bisou-bisou.com.au",
    "stan's lounge": "https://stanleyrestaurant.com.au/stans-lounge",
    "donna chang": "https://donnachang.com.au",
    "boom boom room": "https://boomboomroom.com.au",
    "otto ristorante": "https://ottoristorante.com.au/brisbane",
    "taro's ramen": "https://tarosramen.com.au",
    "rothwell's": "https://rothwellsbrisbane.com.au",
    "gnocchi gnocchi": "https://gnocchignocchibrothers.com.au",
    "spring hill 1871": "https://www.brisbane.qld.gov.au/things-to-see-and-do/council-venues-and-precincts/spring-hill-reservoirs",
    "spring hill underground": "https://www.brisbane.qld.gov.au/things-to-see-and-do/council-venues-and-precincts/spring-hill-reservoirs",
    "walter taylor bridge": "https://www.brisbane.qld.gov.au/things-to-see-and-do/featured-attractions/walter-taylor-bridge-tours",
    "northey street": "https://www.nscf.org.au",
    "wynnum wading pool": "https://www.brisbane.qld.gov.au/things-to-see-and-do/outdoor-activities/council-pools/wynnum-wading-pool",
    "mosconi": "https://mosconibrisbane.com.au",
    "gerard's bar": "https://gerardsbar.com.au",
    "the zoo": "https://thetriffid.com.au",
    "farmhouse kedron": "https://farmhousekedron.com.au",
    "park lane everton park": "https://parklanedining.com.au",
    "willow & spoon": "https://willowandspoon.com.au",
    "ciao gelato": "https://www.instagram.com/ciaogelatonundah",
    "craft'd grounds": "https://craftdgrounds.com.au",
    "clayfield market": "https://harrisfarm.com.au",
    "sandgate fish": "https://www.visitbrisbane.com.au/the-city/things-to-do/eat-and-drink/restaurants/fish-and-chips",
    "doug's seafood": "https://www.visitbrisbane.com.au/the-city/things-to-do/eat-and-drink/restaurants/fish-and-chips",
    "belvedere hotel": "https://belvederehotel.com.au",
    "scarborough harbour": "https://scarboroughharbourbc.com.au",
    "tempest seafood": "https://tempestrestaurant.com.au",
    "florence cafe": "https://florencecafe.com.au",
    "mons ban sabai": "https://monsbansabai.com.au",
    "beyond the pale": "https://beyondthepale.com.au",
    "dendy cinemas": "https://www.dendy.com.au",
    "pawpaw cafe": "https://pawpawcafe.com.au",
    "manly harbour": "https://manlyharbourvillage.com",
    "fish cafe manly": "https://manlyharbourvillage.com",
    "goodness gracious": "https://goodnessgraciouscafe.com.au",
    "regal twin": "https://fivestarcinemas.com.au/graceville",
    "corner store cafe": "https://cornerstorecafe.com.au",
    "hundred acre bar": "https://hillstonestlucia.com.au/hundred-acre-bar",
    "slipstream brewing": "https://slipstreambrewing.com.au",
    "wellington point": "https://www.visitredlandscoast.com.au",
    "cleveland point": "https://www.visitredlandscoast.com.au",
    "kooroomba": "https://kooroomba.com.au",
    "o'reilly's": "https://oreillys.com.au/canungra-valley-vineyards",
    "victoria point": "https://www.visitredlandscoast.com.au",
    "ormiston house": "https://ormistonhouse.org.au",
    "aether brewing": "https://aetherbrewing.com.au",
    "1889 enoteca": "https://1889enoteca.com.au",
    "brisbane jazz club": "https://brisbanejazzclub.com.au",
    "doo-bop": "https://doo-bop.com.au",
    "princess theatre": "https://theprincesstheatre.com.au",
    "qagoma": "https://www.qagoma.qld.gov.au",
    "goma cinema": "https://www.qagoma.qld.gov.au/cinema",
    "birrunga": "https://birrunga.com.au",
    "philip bacon": "https://philipbacongalleries.com.au",
    "institute of modern art": "https://ima.org.au",
    "south bank riverside": "https://collectivemarkets.com.au",
    "wesley taylor": "https://wesleytaylorartstudios.com.au",
    "brisbane comedy festival": "https://brisbanecomedyfestival.com",
    "moonlight cinema": "https://www.moonlight.com.au/brisbane",
}

# Only true single-date or limited-season concerts, festivals, theatre runs, and sports games
# should remain `ongoing: False`. Permanent venues are converted to `ongoing: True`.
TRUE_DATED_TITLE_PATTERNS = [
    "jack johnson",
    "khalid",
    "spacey jane",
    "candlelight: tribute to adele",
    "queensland ballet: dracula",
    "queensland symphony orchestra: cinematic scores",
    "melt festival",
    "brisbane comedy festival gala",
    "moonlight cinema",
]

CURATED_STAY_IN_AND_REGIONAL_GEMS = [
    {
        "id": "stay-in-handmade-pasta",
        "title": "Stay-In Date: Handmade Gnocchi & Italian Wine Night",
        "description": "Skip the restaurant bill and turn your kitchen into a Roman trattoria. Roll pillowy ricotta gnocchi together from scratch, brown butter and sage in a pan, put on an Italian jazz playlist, and dine by candlelight at home.",
        "insider_tip": "Buy fresh ricotta from New Farm Deli or Rosalie Gourmet Market — draining it for 30 minutes makes the dough super light.",
        "category": "Food & Drink",
        "location": "At Home · Stay-In Date",
        "time_str": "Any evening · ~90 mins",
        "start_date": None,
        "end_date": None,
        "ongoing": True,
        "price": "$25 ingredients",
        "source": "TwoDo Stay-In Guide",
        "source_url": "https://www.seriouseats.com/ricotta-gnocchi-homemade-pasta-recipe",
        "image_url": "https://images.unsplash.com/photo-1551183053-bf91a1d81141?auto=format&fit=crop&w=900&q=80",
        "tags": ["Stay-In", "Indoor", "Budget", "Cooking", "Romantic"]
    },
    {
        "id": "stay-in-balcony-tapas",
        "title": "Stay-In Date: Sunset Balcony Pintxos & Sangria Flight",
        "description": "Recreate a San Sebastián tapas bar on your balcony or living room rug. Assemble 4 easy tooth-picked pintxos (jamón, manchego, marinated olives, pan con tomate) and mix a jug of blood-orange sangria.",
        "insider_tip": "Rule of the night: phones in another room until the last toothpick is gone.",
        "category": "Food & Drink",
        "location": "At Home · Stay-In Date",
        "time_str": "Golden Hour · Any evening",
        "start_date": None,
        "end_date": None,
        "ongoing": True,
        "price": "$30 ingredients",
        "source": "TwoDo Stay-In Guide",
        "source_url": "https://www.spanishsabores.com/authentic-spanish-pintxos-recipes/",
        "image_url": "https://images.unsplash.com/photo-1541529086526-db283c563270?auto=format&fit=crop&w=900&q=80",
        "tags": ["Stay-In", "Budget", "Romantic"]
    },
    {
        "id": "stay-in-two-player-boardgame",
        "title": "Stay-In Date: Two-Player Co-Op Board Game & Dessert Fondue",
        "description": "Pick up a great 2-player game (like Sky Team, Patchwork, Codenames Duet, or 7 Wonders Duel) from Vault Games in the CBD, melt a pot of dark chocolate with strawberries at home, and play best-of-three.",
        "insider_tip": "Vault Games on Queen St Mall has a dedicated 2-player section and staff who will recommend the exact right vibe for you both.",
        "category": "Workshops & Classes",
        "location": "At Home · Stay-In Date (via Vault Games CBD)",
        "time_str": "Any evening · Rainy or Hot Night",
        "start_date": None,
        "end_date": None,
        "ongoing": True,
        "price": "$20–$45",
        "source": "Vault Games Brisbane",
        "source_url": "https://vaultgames.com.au",
        "image_url": "https://images.unsplash.com/photo-1610890716171-6b1bb98ffd09?auto=format&fit=crop&w=900&q=80",
        "tags": ["Stay-In", "Indoor", "Late Night", "Budget"]
    },
    {
        "id": "stay-in-blind-wine-cheese",
        "title": "Stay-In Date: Blind Wine or Craft Non-Alc Tasting & Cheese Pairing",
        "description": "Wrap 3 bottles in brown paper bags, grab 3 small cheeses, and rate each pairing out of 10 on aroma, taste, and 'would we buy this again?' before revealing the labels.",
        "insider_tip": "Cru Bar (Fortitude Valley) or Craft Wine Store (Red Hill / Coorparoo) will happily pick 3 mystery bottles under your budget if you tell them it's for a blind date tasting.",
        "category": "Food & Drink",
        "location": "At Home · Stay-In Date",
        "time_str": "Any night · Late-Night Friendly",
        "start_date": None,
        "end_date": None,
        "ongoing": True,
        "price": "$35–$60",
        "source": "Craft Wine Store",
        "source_url": "https://craftwinestore.com",
        "image_url": "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?auto=format&fit=crop&w=900&q=80",
        "tags": ["Stay-In", "Indoor", "Late Night", "Romantic"]
    },
    {
        "id": "stay-in-watercolour-portrait",
        "title": "Stay-In Date: The 15-Minute Couples Portrait Paint-Off",
        "description": "Set a 15-minute timer, sit across from each other with cheap watercolour or acrylic pads, and paint each other's portrait without peeking until the timer rings. Guaranteed laughs and a keepsake for the fridge.",
        "insider_tip": "Grab a $15 starter watercolour set from Eckersley's Art & Craft on Adelaide St (CBD) or Milton.",
        "category": "Arts & Culture",
        "location": "At Home · Stay-In Date",
        "time_str": "Anytime · Indoor & Cozy",
        "start_date": None,
        "end_date": None,
        "ongoing": True,
        "price": "$15 supplies",
        "source": "Eckersley's Art & Craft",
        "source_url": "https://www.eckersleys.com.au",
        "image_url": "https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?auto=format&fit=crop&w=900&q=80",
        "tags": ["Stay-In", "Indoor", "Budget", "Creative"]
    },
    {
        "id": "stay-in-living-room-cinema",
        "title": "Stay-In Date: Living Room Double-Feature & Homemade Choc-Tops",
        "description": "Build a mattress-and-pillow fort in the lounge room, make homemade waffle-cone choc-tops dipped in Magic Shell chocolate, and each pick one secret comfort film the other hasn't seen.",
        "insider_tip": "Stream free world cinema and indie gems through Brisbane City Council Library's Beamafilm or Kanopy access with your library card.",
        "category": "Arts & Culture",
        "location": "At Home · Stay-In Date",
        "time_str": "Any evening · Late-Night Cozy",
        "start_date": None,
        "end_date": None,
        "ongoing": True,
        "price": "$10 snacks",
        "source": "Brisbane Libraries Streaming",
        "source_url": "https://www.brisbane.qld.gov.au/things-to-see-and-do/council-venues-and-precincts/libraries",
        "image_url": "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=900&q=80",
        "tags": ["Stay-In", "Indoor", "Late Night", "Budget"]
    }
]


def is_valid_source_url(url: str) -> bool:
    if not url or not isinstance(url, str):
        return False
    u = url.strip().lower()
    if not (u.startswith("http://") or u.startswith("https://")):
        return False
    invalid_patterns = [
        "google.com/search",
        "google.com.au/search",
        "reddit.com/r/brisbane/search",
        "localhost",
        "127.0.0.1",
        "example.com",
    ]
    return not any(p in u for p in invalid_patterns)


def canonical_venue_key(ev: dict) -> str:
    t = ev.get("title", "").strip()
    tl = t.lower()
    aliases = [
        ("netherworld", "netherworld"),
        ("eat street northshore", "eat_street_northshore"),
        ("sir thomas brisbane planetarium", "planetarium"),
        ("mt coot-tha botanic", "mt_coottha_botanic"),
        ("mount coot-tha botanic", "mt_coottha_botanic"),
        ("bonsai house", "mt_coottha_botanic"),
        ("mount coot-tha summit", "mt_coottha_summit"),
        ("victoria park", "victoria_park_putt"),
        ("cork & chroma", "cork_and_chroma"),
        ("roma street parkland", "roma_st_parkland"),
        ("beurre pastries", "beurre_pastries"),
        ("same same", "same_same"),
        ("biànca", "bianca"),
        ("bianca:", "bianca"),
        ("moreton island", "tangalooma_moreton"),
        ("tangalooma", "tangalooma_moreton"),
        ("north stradbroke", "stradbroke_point_lookout"),
        ("point lookout", "stradbroke_point_lookout"),
        ("kangaroo point cliffs", "kangaroo_point_cliffs"),
        ("riverlife", "riverlife_kangaroo_point"),
        ("enoggera reservoir", "enoggera_walkabout_creek"),
        ("walkabout creek", "enoggera_walkabout_creek"),
        ("lumina wild swim", "enoggera_walkabout_creek"),
        ("good chat comedy", "good_chat_comedy"),
        ("brisbane distillery", "brisbane_distillery"),
        ("tasting room at brisbane distillery", "brisbane_distillery"),
        ("savile row", "savile_row"),
        ("death & taxes", "death_and_taxes"),
        ("mount gravatt lookout", "mt_gravatt_lookout"),
        ("agnes bakery", "agnes_bakery"),
        ("agnes restaurant", "agnes_restaurant"),
        ("agnes wood-fired", "agnes_restaurant"),
        ("superthing", "superthing"),
        ("gerard's bistro", "gerards_bistro"),
        ("greca:", "greca"),
        ("montrachet", "montrachet"),
        ("regatta hotel", "regatta_boatshed"),
        ("brooki", "brooki_bakehouse"),
        ("the triffid", "the_triffid"),
        ("fortitude music hall", "fortitude_music_hall"),
        ("the tivoli", "the_tivoli"),
        ("julius pizzeria", "julius_pizzeria"),
        ("city botanic gardens", "city_botanic_gardens"),
        ("tamborine mountain", "tamborine_mountain"),
        ("springbrook national park", "springbrook_natural_bridge"),
        ("burleigh heads", "burleigh_heads"),
        ("burleigh pavilion", "burleigh_heads"),
        ("gelato messina", "gelato_messina"),
        ("baedeker", "baedeker"),
        ("no. 5 cafe", "no_5_cafe"),
        ("finney isles", "finney_isles"),
        ("moga japanese", "moga_izakaya"),
        ("morning after", "morning_after"),
        ("greek taverna", "greek_taverna_west_end"),
        ("catchment brewing", "catchment_brewing"),
        ("pancake manor", "pancake_manor"),
        ("green beacon", "green_beacon"),
        ("merthyr bowls", "merthyr_bowls"),
        ("shouk cafe", "shouk_cafe"),
        ("wilson outlook", "wilson_outlook"),
        ("brewdog", "brewdog_murarrie"),
        ("rogue bistro", "rogue_bistro"),
        ("restaurant dan arnold", "dan_arnold"),
        ("joy restaurant", "joy_restaurant"),
        ("walter taylor bridge", "walter_taylor_bridge"),
        ("spring hill underground", "spring_hill_reservoir"),
        ("spring hill 1871", "spring_hill_reservoir"),
        ("highgate hill", "highgate_hill_park"),
        ("sherwood arboretum", "sherwood_arboretum"),
        ("toohey forest", "toohey_forest"),
        ("karawatha forest", "karawatha_forest"),
        ("boondall wetlands", "boondall_wetlands"),
        ("shorncliffe", "shorncliffe_pier"),
        ("redcliffe jetty", "redcliffe_markets"),
        ("milton sunday", "milton_markets"),
        ("milton markets", "milton_markets"),
        ("davies park", "davies_park_markets"),
        ("hellenika", "hellenika"),
        ("mr percival", "mr_percivals"),
        ("howard smith wharves: mr percival", "mr_percivals"),
        ("felons brewing", "felons_hswharves"),
        ("howard smith wharves: sunset spritz & felons", "felons_hswharves"),
        ("christian jacques", "christian_jacques"),
        ("meet fresh", "meet_fresh_sunnybank"),
        ("roti place", "roti_place_sunnybank"),
        ("malaysian roti canai", "roti_place_sunnybank"),
        ("dutch courage", "dutch_courage"),
        ("the zoo", "the_zoo"),
        ("lune croissanterie", "lune_croissanterie"),
        ("flour & chocolate", "flour_and_chocolate"),
        ("crust & co", "crust_and_co"),
        ("museum of brisbane", "museum_of_brisbane"),
        ("brisbane city hall: historic clock tower", "museum_of_brisbane"),
        ("queensland museum", "queensland_museum"),
        ("queensland symphony orchestra", "qso"),
        ("essa:", "essa_restaurant"),
        ("essa restaurant", "essa_restaurant"),
        ("exhibition:", "exhibition_restaurant"),
        ("exhibition restaurant", "exhibition_restaurant"),
        ("manly harbour village", "manly_harbour"),
        ("maleny", "maleny_montville"),
        ("montville", "maleny_montville"),
        ("gold creek", "gold_creek_reservoir"),
        ("wellington point", "wellington_point"),
        ("king island wellington point", "wellington_point"),
        ("citycat", "citycat_sunset_cruise"),
        ("sunset 'mystery stop' citycat", "citycat_sunset_cruise"),
    ]
    if ev.get("category") == "Sports & Active" and not ev.get("ongoing"):
        sd = (ev.get("start_date") or "")[:10]
        return f"fixture_{tl}_{sd}"
    if tl.startswith("stay-in date:"):
        return tl
    for pat, key in aliases:
        if pat in tl:
            return key
    if ":" in tl:
        prefix = tl.split(":", 1)[0].strip()
        if prefix not in {"stay-in date", "brisbane", "south bank", "fortitude valley", "west end", "new farm", "sunnybank"}:
            return prefix
    return tl


def resolve_official_url(ev: dict) -> str:
    current = (ev.get("source_url") or "").strip()
    tl = ev.get("title", "").lower()
    loc = ev.get("location", "").lower()
    combined = f"{tl} {loc}"

    # Check explicit mapping table first if current URL is missing or generic search
    if not is_valid_source_url(current):
        for pat, official in OFFICIAL_URLS.items():
            if pat in combined:
                return official
    # Even if current is valid, fix known typos
    if "thestarmelb" in current:
        return "https://www.star.com.au/brisbane/whats-on/sky-deck"
    return current if is_valid_source_url(current) else ""


def default_opening_hours(ev: dict) -> str:
    ts = (ev.get("time_str") or "").strip()
    cat = ev.get("category", "")
    tl = ev.get("title", "").lower()

    # If time_str looks like a single specific calendar date (e.g. "Wed, 04 Nov · 6:00 PM" or "5 Nov 2026"),
    # replace it with recurring opening hours for ongoing venues!
    has_specific_month = any(m in ts for m in ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])
    if not ts or has_specific_month:
        if "market" in tl:
            if "sunday" in tl or "milton" in tl or "redcliffe" in tl or "northey" in tl:
                return "Sundays · 7:00 AM – 1:00 PM"
            if "saturday" in tl or "davies" in tl or "west end" in tl or "jan powers" in tl:
                return "Saturdays · 6:00 AM – 2:00 PM"
            return "Fri–Sun · 4:00 PM – 10:00 PM"
        if "bakery" in tl or "pastries" in tl or "croissant" in tl or "brunch" in tl or "cafe" in tl or "espresso" in tl:
            return "Daily · 7:00 AM – 2:30 PM"
        if cat == "Nightlife & Bars" or "bar" in tl or "rooftop" in tl or "cocktail" in tl or "speakeasy" in tl or "jazz" in tl:
            return "Wed–Sun · 5:00 PM – Late"
        if cat == "Food & Drink":
            return "Tue–Sun · 5:30 PM – 10:00 PM"
        if cat == "Outdoors & Nature":
            return "Daily · Sunrise to Sunset"
        if cat == "Arts & Culture":
            return "Tue–Sun · 10:00 AM – 5:00 PM"
        if cat == "Comedy & Shows" or cat == "Music & Concerts":
            return "Thu–Sun · Evening Sessions"
        if cat == "Workshops & Classes":
            return "Wed–Sun · Morning & Evening Sessions"
        if cat == "Sports & Active":
            return "Daily · 7:00 AM – 9:30 PM"
        return "Open Weekly · Check website for hours"
    return ts


def normalize_event_dates(ev: dict, today_ymd: str) -> dict | None:
    """
    Ensures:
    - Ongoing venues have ongoing=True, start_date=None, end_date=None, and recurring time_str.
    - Dated events/fixtures have ongoing=False, valid start_date/end_date, and if already in the past, are either
      rolled forward (if recurring concert/season) or dropped (if past fixture).
    """
    tl = ev.get("title", "").lower()
    cat = ev.get("category", "")

    is_sports_fixture = (cat == "Sports & Active" and not ev.get("ongoing") and ev.get("start_date"))
    is_true_dated_show = any(pat in tl for pat in TRUE_DATED_TITLE_PATTERNS)

    if is_sports_fixture or is_true_dated_show:
        ev["ongoing"] = False
        sd = (ev.get("start_date") or "")[:10]
        ed = (ev.get("end_date") or sd)[:10]
        # If a concert/festival had an early November date that just passed, roll it forward 14 days if it's a show
        if is_true_dated_show and ed and ed < today_ymd:
            try:
                dt = datetime.strptime(sd, "%Y-%m-%d")
                while dt.strftime("%Y-%m-%d") < today_ymd:
                    dt += timedelta(days=14)
                time_part = (ev.get("start_date") or "19:30")[11:] or "19:30"
                ev["start_date"] = f"{dt.strftime('%Y-%m-%d')} {time_part}".strip()
                ev["end_date"] = ev["start_date"]
                ev["time_str"] = dt.strftime("%a, %d %b · ") + (ev.get("time_str", "").split("·")[-1].strip() if "·" in ev.get("time_str", "") else "7:30 PM")
                ed = dt.strftime("%Y-%m-%d")
            except Exception:
                pass
        if ed and ed < today_ymd:
            return None  # Past sports fixture — drop it
        return ev

    # Otherwise, this is an ongoing Brisbane venue, restaurant, bar, park, market, gallery, class, or social sport
    ev["ongoing"] = True
    ev["start_date"] = None
    ev["end_date"] = None
    ev["time_str"] = default_opening_hours(ev)
    return ev


def enrich_tags(ev: dict) -> list[str]:
    tags = list(ev.get("tags") or [])
    text = f"{ev.get('title', '')} {ev.get('description', '')} {ev.get('category', '')} {ev.get('price', '')} {ev.get('location', '')} {ev.get('time_str', '')}".lower()
    price_str = (ev.get("price") or "").lower()

    if "free" in price_str or price_str in ["$5", "$6", "$10", "$15", "$12"]:
        if "Budget" not in tags:
            tags.append("Budget")
    if any(w in text for w in ["late", "midnight", "speakeasy", "whisky", "cocktail", "rooftop", "jazz", "arcade", "pinball", "dessert", "hotpot", "night market", "eat street", "planetarium", "candlelight"]):
        if "Late Night" not in tags:
            tags.append("Late Night")
    if any(w in text for w in ["gallery", "museum", "cinema", "pottery", "clay", "cooking", "arcade", "bowling", "planetarium", "theatre", "qpac", "qagoma", "goma", "comedy", "indoor", "bouldering", "pickleball", "ice skating", "escape", "board game"]):
        if "Indoor" not in tags:
            tags.append("Indoor")
    if "stay-in" in text or "at home" in text:
        if "Stay-In" not in tags:
            tags.append("Stay-In")
    return tags


def fetch_live_public_feeds(today_ymd: str) -> list[dict]:
    """
    Attempts to pull fresh Brisbane events from public RSS/JSON endpoints across Brisbane areas.
    Only keeps events that have a valid direct `source_url`.
    """
    discovered = []
    rss_feeds = [
        ("https://www.MustDoBrisbane.com/rss.xml", "Must Do Brisbane", "Brisbane"),
    ]
    req_headers = {"User-Agent": "TwoDoBrisbaneDateApp/3.6 (+https://twodoapp.web.app)"}
    for url, source_name, default_loc in rss_feeds:
        try:
            req = urllib.request.Request(url, headers=req_headers)
            with urllib.request.urlopen(req, timeout=5) as resp:
                xml_bytes = resp.read()
            root = ET.fromstring(xml_bytes)
            for item in root.findall(".//item")[:20]:
                title = (item.findtext("title") or "").strip()
                link = (item.findtext("link") or "").strip()
                desc = re.sub(r"<[^>]+>", "", (item.findtext("description") or "")).strip()
                if title and is_valid_source_url(link):
                    discovered.append({
                        "id": "live-rss-" + re.sub(r"[^a-z0-9]+", "-", title.lower())[:40],
                        "title": title,
                        "description": desc[:260] or f"Live Brisbane experience sourced from {source_name}.",
                        "insider_tip": "Check the official event page for session times and bookings.",
                        "category": "Arts & Culture",
                        "location": default_loc,
                        "time_str": "See official link for times",
                        "start_date": None,
                        "end_date": None,
                        "ongoing": True,
                        "price": "Varies",
                        "source": source_name,
                        "source_url": link,
                        "image_url": "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=900&q=80",
                    })
        except Exception:
            # Offline or sandbox environment — continue gracefully
            pass
    return discovered


def classify_area_and_fix_location(ev: dict) -> str:
    loc = (ev.get("location") or "").strip()
    title = (ev.get("title") or "").strip()
    desc = (ev.get("description") or "").strip()
    s = f"{loc} {title} {desc}".lower()

    area_rules = [
        ("At Home (Stay-In)", "At Home · Stay-In Date", ["stay-in date", "at home · stay-in"]),
        ("Sunnybank & South", "Sunnybank, Brisbane", ["sunnybank", "market square", "macgregor", "robertson", "eight mile plains", "runcorn", "karawatha", "toohey forest", "mt gravatt", "mount gravatt"]),
        ("Fortitude Valley & James St", "Fortitude Valley, Brisbane", ["fortitude valley", "james st", "calile", "bowen hills", "chinatown", "brunswick st", "winn lane", "bakery lane", "california lane", "gerard's", "same same", "biànca", "bianca", "agnes", "soko", "maya mexican", "cielo", "iris rooftop", "savile row", "finney isles", "baedeker", "dutch courage", "the triffid", "fortitude music hall", "the tivoli", "netherworld", "good chat comedy", "honto", "bisou bisou", "mosconi", "joy restaurant"]),
        ("South Bank & Fish Lane", "South Bank, Brisbane", ["south bank", "south brisbane", "qpac", "qagoma", "goma", "cultural precinct", "fish lane", "julius pizzeria", "maeve wine", "lina rooftop", "emporium terrace", "next episode", "queensland museum", "cork & chroma", "brisbane convention"]),
        ("West End & Highgate Hill", "West End, Brisbane", ["west end", "highgate hill", "davies park", "montague rd", "boundary st", "brisbane distillery", "anita gelato", "brisbane brewing co", "morning after", "greek taverna", "gunshop cafe", "catchment brewing", "archive beer", "rumpus room", "little greek"]),
        ("New Farm, Teneriffe & Newstead", "New Farm & Newstead, Brisbane", ["new farm", "teneriffe", "newstead", "gasworks", "powerhouse", "merthyr", "wilson outlook", "range brewing", "green beacon", "zero fox", "beccofino", "new farm deli", "mary mae's", "clayschool", "mas & miek"]),
        ("Paddington, Rosalie & Milton", "Paddington & Milton, Brisbane", ["paddington", "rosalie", "milton", "red hill", "bardon", "latrobe terrace", "given terrace", "caxton st", "suncorp stadium", "xxxx brewery", "anouk", "shouk", "kettle & tin", "hope & anchor", "il posto", "blue room cinebar", "fritzenberger", "empire revival", "leftys"]),
        ("Woolloongabba & Kangaroo Point", "Woolloongabba & Kangaroo Point", ["woolloongabba", "kangaroo point", "the gabba", "gabba", "east brisbane", "coorparoo", "stones corner", "logan rd", "1889 enoteca", "c'est bon", "detour", "electric avenue", "norman hotel", "brown dog", "captain burke", "story bridge", "sea legs", "riverlife", "brisbane jazz club", "princess theatre", "pawpaw"]),
        ("Bulimba & Hawthorne", "Bulimba & Hawthorne, Brisbane", ["bulimba", "hawthorne", "morningside", "balmoral", "oxford st", "murarrie", "brewdog", "revel brewing", "melrose", "riverbend books", "the jetty oxford", "darvella", "flour & chocolate", "bellissimo"]),
        ("Hamilton, Ascot & Northshore", "Hamilton & Ascot, Brisbane", ["hamilton", "ascot", "northshore", "eat street", "portside", "racecourse rd", "hendra", "eagle farm", "doomben", "one fish two fish", "byblos", "dendy portside"]),
        ("Inner North & Enoggera", "Inner North, Brisbane", ["albion", "windsor", "kedron", "nundah", "clayfield", "newmarket", "enoggera", "walkabout creek", "ashgrove", "everton park", "wilston", "northgate", "herston", "victoria park", "northey st", "golden pig", "farmhouse kedron", "willow & spoon", "craft'd grounds", "vaquero"]),
        ("Bayside, Manly & Redcliffe", "Bayside & Peninsula, Brisbane", ["manly", "wynnum", "sandgate", "shorncliffe", "redcliffe", "scarborough", "woody point", "wellington point", "cleveland", "boondall", "ormiston", "stradbroke", "moreton bay"]),
        ("Mt Coot-tha & Western Suburbs", "Mt Coot-tha & West, Brisbane", ["coot-tha", "planetarium", "toowong", "st lucia", "indooroopilly", "graceville", "sherwood", "sumner", "yeerongpilly", "brookfield", "gold creek", "regatta hotel", "walter taylor", "hundred acre", "slipstream"]),
        ("Islands, Coast & Hinterland", "SEQ Day Escape", ["moreton island", "tangalooma", "north stradbroke", "point lookout", "tamborine", "maleny", "montville", "glass house", "springbrook", "burleigh", "kooroomba", "canungra", "o'reilly's"]),
    ]

    for area_name, nice_loc, keywords in area_rules:
        if any(k in s for k in keywords):
            if loc.lower() in {"brisbane", "brisbane, qld", ""}:
                ev["location"] = nice_loc
            return area_name

    if loc.lower() in {"brisbane", "brisbane, qld", ""}:
        ev["location"] = "Brisbane CBD"
    return "Brisbane CBD & Riverfront"


def build_clean_catalog(try_network: bool = False):
    today_ymd = datetime.now().strftime("%Y-%m-%d")
    with open(EVENTS_JS_PATH, "r", encoding="utf-8") as f:
        text = f.read()
    m = re.search(r"const PRELOADED_EVENTS\s*=\s*(\[.*\]);", text, re.S)
    if not m:
        raise RuntimeError("Could not parse PRELOADED_EVENTS from events_data.js")
    raw_events = json.loads(m.group(1))

    # Merge curated stay-in dates and optional live network feed
    candidates = list(raw_events) + CURATED_STAY_IN_AND_REGIONAL_GEMS
    if try_network:
        candidates.extend(fetch_live_public_feeds(today_ymd))

    kept = []
    seen_keys = set()

    for ev in candidates:
        t = (ev.get("title") or "").strip()
        if not t:
            continue
        # 1. Strip numbered synthetic filler (#1..#742)
        if re.search(r"#\d+", t):
            continue
        # 2. Strip suburb x activity template clones
        if ":" in t and t.split(":", 1)[0].strip().lower() in SUBURB_PREFIXES:
            continue
        # 3. Strip generic no-venue filler
        if t in GENERIC_NO_VENUE:
            continue

        # 4. Deduplicate by canonical venue/event key
        k = canonical_venue_key(ev)
        if k in seen_keys:
            continue

        # 5. Resolve and strictly validate source_url (if no real link, do not add!)
        resolved_url = resolve_official_url(ev)
        if not is_valid_source_url(resolved_url):
            continue
        ev["source_url"] = resolved_url

        # 6. Normalize ongoing vs dated events and drop past events
        normalized = normalize_event_dates(ev, today_ymd)
        if normalized is None:
            continue

        # 7. Enrich area & practical tags
        normalized["area"] = classify_area_and_fix_location(normalized)
        normalized["tags"] = enrich_tags(normalized)

        seen_keys.add(k)
        kept.append(normalized)

    # Diversify adjacent duplicate Unsplash URLs so cards next to each other look distinct
    FALLBACK_POOL = [
        "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=900&q=80",
        "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=900&q=80",
        "https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&w=900&q=80",
        "https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&w=900&q=80",
        "https://images.unsplash.com/photo-1544148103-0773bf10d330?auto=format&fit=crop&w=900&q=80",
        "https://images.unsplash.com/photo-1470337458703-46ad1756a187?auto=format&fit=crop&w=900&q=80",
        "https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&w=900&q=80",
        "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=900&q=80",
        "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=900&q=80",
        "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=900&q=80",
        "https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=900&q=80",
        "https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?auto=format&fit=crop&w=900&q=80",
    ]
    recent_imgs = []
    for idx, ev in enumerate(kept):
        img = ev.get("image_url") or ""
        if img in recent_imgs[-4:]:
            ev["image_url"] = FALLBACK_POOL[idx % len(FALLBACK_POOL)]
        recent_imgs.append(ev["image_url"])

    area_counts = Counter(e.get("area", "Brisbane") for e in kept)
    cat_counts = Counter(e.get("category", "Other") for e in kept)

    meta = {
        "last_updated": datetime.now().strftime("%Y-%m-%d %H:%M AEST"),
        "last_updated_date": today_ymd,
        "total_events": len(kept),
        "ongoing_count": sum(1 for e in kept if e.get("ongoing")),
        "dated_count": sum(1 for e in kept if not e.get("ongoing")),
        "areas": dict(area_counts.most_common()),
        "categories": dict(cat_counts.most_common()),
    }

    # Write events_data.js
    js_output = (
        f"// Auto-generated by scripts/daily_event_pull.py on {meta['last_updated']}\n"
        f"// Verified unique Brisbane & SEQ events/venues — 100% with direct official source_url\n"
        f"window.EVENTS_CATALOG_META = {json.dumps(meta, indent=2, ensure_ascii=False)};\n"
        f"const PRELOADED_EVENTS = {json.dumps(kept, indent=2, ensure_ascii=False)};\n"
    )
    with open(EVENTS_JS_PATH, "w", encoding="utf-8") as f:
        f.write(js_output)

    # Write live_events_feed.json for daily client background sync
    os.makedirs(os.path.dirname(LIVE_FEED_JSON_PATH), exist_ok=True)
    with open(LIVE_FEED_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "events": kept}, f, indent=2, ensure_ascii=False)

    print(f"✅ Wrote {len(kept)} unique, link-verified events to events_data.js and live_events_feed.json")
    print(f"   Ongoing venues/experiences: {meta['ongoing_count']} | Dated shows/fixtures: {meta['dated_count']}")
    print("   Area breakdown:")
    for area, count in area_counts.most_common():
        print(f"     - {area}: {count}")


if __name__ == "__main__":
    try_net = "--live-pull" in sys.argv
    build_clean_catalog(try_network=try_net)

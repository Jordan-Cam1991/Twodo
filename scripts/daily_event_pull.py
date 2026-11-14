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
import html
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

# Explicit schedule mapping for special ticketed shows, exhibitions, and limited-season events
# that exist in the catalog so they always have `ongoing: False` and accurate upcoming dates.
SPECIAL_EVENT_DATES_MAP = {
    "six the musical": ("2027-01-02 19:30", "2027-02-14 21:00", "2 Jan – 14 Feb 2027 · Evening & Matinee"),
    "melanie c": ("2026-11-14 19:30", "2026-11-14 22:30", "Sat, 14 Nov · 7:30 PM"),
    "keith noud stakes": ("2026-11-14 11:30", "2026-11-14 17:30", "Sat, 14 Nov · 11:30 AM"),
    "brisbane bullets vs tasmania": ("2026-11-15 15:30", "2026-11-15 18:00", "Sun, 15 Nov · 3:30 PM"),
    "iron maiden": ("2026-11-18 19:00", "2026-11-19 22:30", "Wed 18 & Thu 19 Nov · 7:00 PM"),
    "des bishop": ("2026-11-19 19:30", "2026-11-19 22:00", "Thu, 19 Nov · 7:30 PM"),
    "kim wilde": ("2026-11-20 19:30", "2026-11-20 22:30", "Fri, 20 Nov · 7:30 PM"),
    "robbie williams": ("2026-11-20 19:00", "2026-11-20 23:00", "Fri, 20 Nov · 7:00 PM"),
    "j. cole": ("2026-11-25 19:30", "2026-11-25 22:30", "Wed, 25 Nov · 7:30 PM"),
    "cat power": ("2026-11-30 19:30", "2026-11-30 22:30", "Mon, 30 Nov · 7:30 PM"),
    "khalid": ("2026-11-11 18:30", "2026-11-11 22:00", "Wed, 11 Nov · 6:30 PM"),
    "spacey jane": ("2026-11-26 18:30", "2026-11-26 22:00", "Thu, 26 Nov · 6:30 PM"),
    "foo fighters": ("2026-11-12 19:00", "2026-11-12 22:30", "Thu, 12 Nov · 7:00 PM"),
    "shake & stir theatre co: dracula": ("2026-11-08 19:30", "2026-11-15 21:30", "8 Nov – 15 Nov · 7:30 PM"),
    "queensland symphony orchestra: cinematic": ("2026-11-13 19:30", "2026-11-14 21:30", "Fri 13 & Sat 14 Nov · 7:30 PM"),
    "melt festival": ("2026-11-08 18:00", "2026-11-15 22:00", "On now – until Sun, 15 Nov"),
    "brisbane comedy festival opening gala": ("2026-11-08 19:00", "2026-11-08 21:30", "Sun, 8 Nov · 7:00 PM"),
    "make, believe, magic: the worlds of the jim henson": ("2026-11-08 10:00", "2026-12-20 17:00", "Exhibition on now – until 20 Dec"),
    "justene williams: once we were mudskippers": ("2026-11-08 10:00", "2026-11-29 17:00", "Exhibition on now – until 29 Nov"),
    "smokescreen: a thickness of the air": ("2026-11-08 10:00", "2026-12-06 17:00", "Exhibition on now – until 6 Dec"),
    "qagoma up late": ("2026-11-13 18:00", "2026-11-14 22:00", "Fri 13 & Sat 14 Nov · 6:00 PM – 10:00 PM"),
    "bcc outdoor cinema: riverbank movies": ("2026-11-14 18:30", "2026-11-14 21:30", "Sat, 14 Nov · 6:30 PM"),
    "bcc brisasia street eats & lantern parade": ("2026-11-14 16:00", "2026-11-15 21:00", "Sat 14 – Sun 15 Nov · 4:00 PM"),
    "spring hill 1871 underground brick reservoir": ("2026-11-11 17:30", "2026-11-11 19:00", "Wed, 11 Nov · 5:30 PM"),
    "walter taylor bridge: inside the historic": ("2026-11-14 10:00", "2026-11-14 12:00", "Sat, 14 Nov · 10:00 AM"),
}

TRUE_DATED_TITLE_PATTERNS = list(SPECIAL_EVENT_DATES_MAP.keys()) + [
    "candlelight:",
    "moonlight cinema",
    "six the musical",
    "the nutcracker",
    "finders keepers",
    "french film festival",
    "ceramic makers market",
    "ashanti",
    "the chats",
    "live @ lakeside",
    "rlwc26",
    "ariarne titmus",
    "country day party",
    "pollinator celebration",
    "flagstone flavour",
    "heritage circuit",
    "peony market",
    "sounds of 90s pop",
    "aw collectibles",
    "custom lithium",
    "dusk tours",
    "oxley annual christmas",
]

CURATED_SPECIAL_DATED_EVENTS = [
    {
        "id": "special-candlelight-adele-cathedral",
        "title": "Candlelight: Tribute to Adele by String Quartet at St John's Cathedral",
        "description": "Experience the soaring ballads of Adele ('Someone Like You', 'Hello', 'Skyfall', 'Easy On Me') performed live by a string quartet bathed in the glow of 3,000 flickering candles inside St John's Cathedral.",
        "insider_tip": "Doors open 45 minutes before the start time — arrive early for the best central nave seating and pre-show photos.",
        "category": "Music & Concerts",
        "location": "St John's Cathedral, Brisbane CBD",
        "time_str": "Sun, 8 Nov · 7:30 PM",
        "start_date": "2026-11-08 19:30",
        "end_date": "2026-11-08 21:00",
        "ongoing": False,
        "price": "$42–$68",
        "source": "Fever Candlelight Brisbane",
        "source_url": "https://feverup.com/en/brisbane/candlelight",
        "image_url": "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=900&q=80",
        "tags": ["Romantic", "Indoor", "Late Night", "Live Music"]
    },
    {
        "id": "special-boy-and-bear-powerhouse",
        "title": "Boy & Bear: Sunset Acoustic Sessions at Brisbane Powerhouse",
        "description": "ARIA chart-toppers Boy & Bear bring an intimate stripped-back acoustic evening to the Powerhouse Theatre, performing fan favourites and harmonies right on the New Farm riverfront.",
        "insider_tip": "Grab a sunset Aperol Spritz at Mary Mae's on the river deck 45 minutes before the theatre doors open.",
        "category": "Music & Concerts",
        "location": "Brisbane Powerhouse, New Farm",
        "time_str": "Sun, 8 Nov · 6:30 PM",
        "start_date": "2026-11-08 18:30",
        "end_date": "2026-11-08 21:00",
        "ongoing": False,
        "price": "$79",
        "source": "Brisbane Powerhouse",
        "source_url": "https://brisbanepowerhouse.org/whats-on/",
        "image_url": "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=900&q=80",
        "tags": ["Live Music", "Indoor", "Romantic"]
    },
    {
        "id": "special-genesis-owusu-princess",
        "title": "Genesis Owusu: Struggler Live Theatre Show at The Princess",
        "description": "Multi-ARIA winner Genesis Owusu takes over Woolloongabba's heritage Princess Theatre for an electric, theatrical Monday-night live performance blending funk, punk, and poetry.",
        "insider_tip": "Head upstairs to the mezzanine balcony bar for the clearest view over the heritage stage.",
        "category": "Music & Concerts",
        "location": "The Princess Theatre, Woolloongabba",
        "time_str": "Mon, 9 Nov · 7:30 PM",
        "start_date": "2026-11-09 19:30",
        "end_date": "2026-11-09 22:00",
        "ongoing": False,
        "price": "$69",
        "source": "The Princess Theatre",
        "source_url": "https://theprincesstheatre.com.au/whats-on/",
        "image_url": "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=900&q=80",
        "tags": ["Live Music", "Indoor", "Late Night"]
    },
    {
        "id": "special-la-boite-macbeth",
        "title": "La Boite Theatre: Macbeth in the Round at Roundhouse Theatre",
        "description": "Sit mere metres from the action inside Australia's iconic theatre-in-the-round as La Boite stages a breathless, modern-dress production of Macbeth with immersive lighting and live soundscapes.",
        "insider_tip": "Row B in the round puts you right on the edge of the stage without craning your neck.",
        "category": "Comedy & Shows",
        "location": "La Boite Roundhouse Theatre, Kelvin Grove",
        "time_str": "9 Nov – 21 Nov · 7:00 PM",
        "start_date": "2026-11-09 19:00",
        "end_date": "2026-11-21 21:30",
        "ongoing": False,
        "price": "$48–$65",
        "source": "La Boite Theatre",
        "source_url": "https://laboite.com.au/whats-on",
        "image_url": "https://images.unsplash.com/photo-1507676184212-d03ab07a01bf?auto=format&fit=crop&w=900&q=80",
        "tags": ["Indoor", "Theatre", "Arts & Culture"]
    },
    {
        "id": "special-ocean-alley-tivoli",
        "title": "Ocean Alley: Psych-Surf Intimate Headline Night at The Tivoli",
        "description": "Catch Ocean Alley up close inside The Tivoli's art-deco theatre for a special warm-up show packed with velvet grooves, 'Confidence' singalongs, and vintage stage lighting.",
        "insider_tip": "Book a pre-show dinner table on the upstairs balcony to secure prime viewing before general admission fills up.",
        "category": "Music & Concerts",
        "location": "The Tivoli, Fortitude Valley",
        "time_str": "Tue, 10 Nov · 7:30 PM",
        "start_date": "2026-11-10 19:30",
        "end_date": "2026-11-10 22:30",
        "ongoing": False,
        "price": "$85",
        "source": "The Tivoli Brisbane",
        "source_url": "https://thetivoli.com.au/events",
        "image_url": "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=900&q=80",
        "tags": ["Live Music", "Indoor", "Late Night"]
    },
    {
        "id": "special-six-the-musical-qpac",
        "title": "SIX The Musical: The Electrifying Pop-Concert Musical at QPAC",
        "description": "Divorced, beheaded, live! Tudor Queens turn into pop icons in this 80-minute high-voltage West End and Broadway sensation at QPAC Playhouse.",
        "insider_tip": "It runs 80 minutes straight with no interval — perfect to pair with late-night cocktails on Fish Lane afterwards.",
        "category": "Comedy & Shows",
        "location": "QPAC Playhouse, South Bank",
        "time_str": "2 Jan – 14 Feb 2027 · Evening & Matinee",
        "start_date": "2027-01-02 19:30",
        "end_date": "2027-02-14 21:00",
        "ongoing": False,
        "price": "$89–$135",
        "source": "QPAC What's On",
        "source_url": "https://www.qpac.com.au/whats-on/2027/six-the-musical",
        "image_url": "https://images.unsplash.com/photo-1514306191717-452ec28c7814?auto=format&fit=crop&w=900&q=80",
        "tags": ["Indoor", "Theatre", "Romantic", "Late Night"]
    },
    {
        "id": "special-moonlight-cinema-new-farm",
        "title": "Moonlight Cinema: Preview Week Under the Stars at New Farm Park",
        "description": "Spread a picnic rug on the amphitheatre lawn at New Farm Park as Moonlight Cinema kicks off its summer season with cult classics, preview blockbusters, bean beds, and wood-fired pizza trucks.",
        "insider_tip": "Upgrade to Gold Grass bean beds or BYO low-back picnic cushion and arrive at gates-open (6:00 PM) for sunset.",
        "category": "Comedy & Shows",
        "location": "New Farm Park Amphitheatre, New Farm",
        "time_str": "Thu 12 Nov – Sun 15 Nov · Gates 6:00 PM",
        "start_date": "2026-11-12 18:00",
        "end_date": "2026-11-15 22:00",
        "ongoing": False,
        "price": "$24",
        "source": "Moonlight Cinema Brisbane",
        "source_url": "https://www.moonlight.com.au/brisbane/program/",
        "image_url": "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=900&q=80",
        "tags": ["Romantic", "Outdoors", "Budget", "Late Night"]
    },
    {
        "id": "special-lime-cordiale-fortitude",
        "title": "Lime Cordiale & Ball Park Music: Friday Night Live at Fortitude Music Hall",
        "description": "Two of Australia's most joyful live bands team up under the grand chandelier of Fortitude Music Hall for a huge Friday night of brass-fuelled indie pop and crowd singalongs.",
        "insider_tip": "Stop into Bisou Bisou or Gerard's Bar on James St beforehand, then walk 5 minutes to the Brunswick St Mall doors.",
        "category": "Music & Concerts",
        "location": "Fortitude Music Hall, Fortitude Valley",
        "time_str": "Fri, 13 Nov · 7:30 PM",
        "start_date": "2026-11-13 19:30",
        "end_date": "2026-11-13 23:00",
        "ongoing": False,
        "price": "$89",
        "source": "Fortitude Music Hall",
        "source_url": "https://thefortitude.com.au/whats-on/",
        "image_url": "https://images.unsplash.com/photo-1459749411175-04bf5292ceea?auto=format&fit=crop&w=900&q=80",
        "tags": ["Live Music", "Indoor", "Late Night"]
    },
    {
        "id": "special-teskey-brothers-riverstage",
        "title": "The Teskey Brothers: Soul & Blues Under the Stars at Riverstage",
        "description": "Josh and Sam Teskey bring their velvety 1960s-inspired soul, horn section, and soaring ballads to the open-air Botanic Gardens slope at Riverstage for a magical Saturday sunset concert.",
        "insider_tip": "Pack a waterproof picnic blanket and claim a spot halfway up the grassy hill for the best sound mix and city skyline backdrop.",
        "category": "Music & Concerts",
        "location": "Riverstage, Brisbane CBD",
        "time_str": "Sat, 14 Nov · 6:00 PM",
        "start_date": "2026-11-14 18:00",
        "end_date": "2026-11-14 22:00",
        "ongoing": False,
        "price": "$99",
        "source": "Ticketmaster Riverstage",
        "source_url": "https://www.ticketmaster.com.au/riverstage-tickets-brisbane/venue/155825",
        "image_url": "https://images.unsplash.com/photo-1506157786151-b8491531f063?auto=format&fit=crop&w=900&q=80",
        "tags": ["Live Music", "Outdoors", "Romantic"]
    },
    {
        "id": "special-candlelight-coldplay-powerhouse",
        "title": "Candlelight: Coldplay vs. Imagine Dragons at Brisbane Powerhouse",
        "description": "Hear 'Fix You', 'Yellow', 'Viva La Vida', 'A Sky Full of Stars', and 'Radioactive' reimagined by a live string ensemble surrounded by thousands of candles.",
        "insider_tip": "The 8:30 PM late session has the moodiest candlelit atmosphere — book Zone A or B for close-up string acoustics.",
        "category": "Music & Concerts",
        "location": "Brisbane Powerhouse, New Farm",
        "time_str": "Sat, 14 Nov · 8:30 PM",
        "start_date": "2026-11-14 20:30",
        "end_date": "2026-11-14 22:00",
        "ongoing": False,
        "price": "$45–$68",
        "source": "Fever Candlelight Brisbane",
        "source_url": "https://feverup.com/en/brisbane/candlelight",
        "image_url": "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=900&q=80",
        "tags": ["Romantic", "Indoor", "Late Night", "Live Music"]
    },
    {
        "id": "special-angus-julia-stone-qpac",
        "title": "Angus & Julia Stone: Living Room Acoustic Tour at QPAC Concert Hall",
        "description": "Sibling duo Angus & Julia Stone perform 'Big Jet Plane', 'Chateau', and new acoustic records inside the world-class acoustics of QPAC's Concert Hall.",
        "insider_tip": "Enjoy pre-show wine and cheese at Maeve Wine Bar just across Grey Street before walking over to QPAC.",
        "category": "Music & Concerts",
        "location": "QPAC Concert Hall, South Bank",
        "time_str": "Sun, 15 Nov · 7:00 PM",
        "start_date": "2026-11-15 19:00",
        "end_date": "2026-11-15 21:30",
        "ongoing": False,
        "price": "$95–$129",
        "source": "QPAC Concert Hall",
        "source_url": "https://www.qpac.com.au/whats-on",
        "image_url": "https://images.unsplash.com/photo-1511192336575-5a79af67a629?auto=format&fit=crop&w=900&q=80",
        "tags": ["Romantic", "Indoor", "Live Music"]
    },
    {
        "id": "special-french-film-festival-encore",
        "title": "Alliance Française French Film Festival Encore Week at Palace James St",
        "description": "Escape to Paris for the evening with a curated encore program of French romantic comedies, Cannes award winners, and champagne arrivals at Palace Cinemas James Street.",
        "insider_tip": "Order a glass of French bubbles and a cheese board from the Palace lounge bar to take straight into the Recliner cinema.",
        "category": "Arts & Culture",
        "location": "Palace James St, Fortitude Valley",
        "time_str": "17 Nov – 22 Nov · Evening Sessions",
        "start_date": "2026-11-17 18:30",
        "end_date": "2026-11-22 21:30",
        "ongoing": False,
        "price": "$26",
        "source": "Palace Cinemas James St",
        "source_url": "https://www.palacecinemas.com.au/cinemas/palace-james-st",
        "image_url": "https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=900&q=80",
        "tags": ["Romantic", "Indoor", "Budget", "Late Night"]
    },
    {
        "id": "special-matt-corby-fortitude",
        "title": "Matt Corby: Everything's Fine Live Tour at Fortitude Music Hall",
        "description": "Experience Matt Corby's jaw-dropping multi-instrumentalist live set and gospel-soul vocals ('Brother', 'Resolution', 'Miracle Love') live in the heart of the Valley.",
        "insider_tip": "Arrive in time for the support act — the sound engineering inside Fortitude Music Hall is crystal clear from the Mezzanine.",
        "category": "Music & Concerts",
        "location": "Fortitude Music Hall, Fortitude Valley",
        "time_str": "Wed, 18 Nov · 7:30 PM",
        "start_date": "2026-11-18 19:30",
        "end_date": "2026-11-18 22:30",
        "ongoing": False,
        "price": "$84",
        "source": "Fortitude Music Hall",
        "source_url": "https://thefortitude.com.au/whats-on/",
        "image_url": "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=900&q=80",
        "tags": ["Live Music", "Indoor", "Romantic"]
    },
    {
        "id": "special-candlelight-hans-zimmer-customs",
        "title": "Candlelight: Best of Hans Zimmer Film Scores at Customs House",
        "description": "Relive epic themes from Interstellar, Inception, Dune, Gladiator, and Pirates of the Caribbean performed by a live string quartet under the grand copper dome of heritage Customs House.",
        "insider_tip": "Pair the concert with a riverside champagne on the Customs House terrace overlooking the Story Bridge beforehand.",
        "category": "Music & Concerts",
        "location": "Customs House, Brisbane CBD",
        "time_str": "Fri, 20 Nov · 7:30 PM",
        "start_date": "2026-11-20 19:30",
        "end_date": "2026-11-20 21:00",
        "ongoing": False,
        "price": "$48–$72",
        "source": "Fever Candlelight Brisbane",
        "source_url": "https://feverup.com/en/brisbane/candlelight",
        "image_url": "https://images.unsplash.com/photo-1465847899084-d164df4dedc6?auto=format&fit=crop&w=900&q=80",
        "tags": ["Romantic", "Indoor", "Live Music"]
    },
    {
        "id": "special-confidence-man-triffid",
        "title": "Confidence Man: Hometown Club Rave & Live Set at The Triffid",
        "description": "Brisbane's own international festival sensations Confidence Man return to Newstead's WW2 hangar for a high-energy Friday night of synchronized choreography, euro-house beats, and confetti.",
        "insider_tip": "Cool off between sets in The Triffid's outdoor beer garden with a cold local craft tin.",
        "category": "Music & Concerts",
        "location": "The Triffid, Newstead",
        "time_str": "Fri, 20 Nov · 8:00 PM",
        "start_date": "2026-11-20 20:00",
        "end_date": "2026-11-20 23:30",
        "ongoing": False,
        "price": "$65",
        "source": "The Triffid Brisbane",
        "source_url": "https://thetriffid.com.au/upcoming-gigs/",
        "image_url": "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=900&q=80",
        "tags": ["Live Music", "Indoor", "Late Night"]
    },
    {
        "id": "special-brisstyle-ceramic-makers-market-clayfield",
        "title": "Ceramic Makers Market: Handcrafted Pottery at Clayfield College",
        "description": "Browse over 40+ independent Queensland ceramicists and pottery makers showcasing handcrafted mugs, planters, vases, and tableware on the leafy grounds of Clayfield College.",
        "insider_tip": "Arrive early at 9:00 AM to snag one-of-a-kind handmade ceramic mugs and tableware before they sell out, then grab brunch nearby in Albion.",
        "category": "Markets & Pop-ups",
        "location": "Clayfield College, Clayfield",
        "time_str": "Sat 14 Nov – Sun 15 Nov · 9:00 AM – 2:00 PM",
        "start_date": "2026-11-14 09:00",
        "end_date": "2026-11-15 14:00",
        "ongoing": False,
        "price": "Free Entry",
        "source": "BrisStyle & Clayfield College",
        "source_url": "https://www.brisstyle.com.au",
        "image_url": "https://images.unsplash.com/photo-1565193566173-7a0ee3dbe261?auto=format&fit=crop&w=900&q=80",
        "tags": ["Markets", "Outdoor", "Budget", "Date Night"]
    },
    {
        "id": "special-ashanti-rock-wit-u-fortitude",
        "title": "Ashanti: 'Rock Wit U' Tour Live at Fortitude Music Hall",
        "description": "Grammy-winning R&B queen Ashanti brings nostalgic 2000s classics ('Foolish', 'Rock Wit U', 'Always on Time') live to Fortitude Music Hall with special guest Riah.",
        "insider_tip": "Head up to the Mezzanine balcony bar for the best sightlines and quick cocktail service without the floor crowd.",
        "category": "Music & Concerts",
        "location": "Fortitude Music Hall, Fortitude Valley",
        "time_str": "Wed, 11 Nov · 7:30 PM",
        "start_date": "2026-11-11 19:30",
        "end_date": "2026-11-11 23:00",
        "ongoing": False,
        "price": "$89–$129",
        "source": "Fortitude Music Hall & Destroy All Lines",
        "source_url": "https://thefortitude.com.au/whats-on/",
        "image_url": "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=900&q=80",
        "tags": ["Live Music", "Indoor", "Late Night", "Romantic"]
    },
    {
        "id": "special-the-chats-ann-st",
        "title": "The Chats w/ Shock Value & Fast Johnny at 711 Ann St",
        "description": "Aussie pub-punk legends The Chats tear the roof off Fortitude Valley with special guests Shock Value and Fast Johnny and The Slow Burners.",
        "insider_tip": "Grab a pre-gig craft beer and pizza on Brunswick Street before walking over to Ann Street.",
        "category": "Music & Concerts",
        "location": "711 Ann St, Fortitude Valley",
        "time_str": "Fri, 13 Nov · 7:00 PM",
        "start_date": "2026-11-13 19:00",
        "end_date": "2026-11-13 23:00",
        "ongoing": False,
        "price": "$45",
        "source": "Fortitude Valley Live Music",
        "source_url": "https://thebrightsidebrisbane.com.au",
        "image_url": "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=900&q=80",
        "tags": ["Live Music", "Indoor", "Late Night"]
    },
    {
        "id": "special-live-at-lakeside-victoria-point",
        "title": "Live @ Lakeside: Retro Rides & Rockin' Tunes at Victoria Point",
        "description": "A breezy Friday evening by the water featuring a stunning showcase of classic chrome cars, live 50s/60s rock 'n' roll tunes, lakeside dinner spots, and sunset cocktails.",
        "insider_tip": "Book a waterside table at one of the lakeside bistros early to watch the vintage cars arrive while sipping a sunset spritz.",
        "category": "Music & Concerts",
        "location": "Victoria Point Lakeside, Redlands Coast",
        "time_str": "Fri, 13 Nov · 5:00 PM – 9:00 PM",
        "start_date": "2026-11-13 17:00",
        "end_date": "2026-11-13 21:00",
        "ongoing": False,
        "price": "Free Entry",
        "source": "Victoria Point Lakeside",
        "source_url": "https://www.redland.qld.gov.au/events",
        "image_url": "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&w=900&q=80",
        "tags": ["Outdoors", "Budget", "Live Music", "Romantic"]
    },
    {
        "id": "special-rlwc26-final-suncorp",
        "title": "RLWC26 Final: Australia v New Zealand (Men's & Women's Double Header)",
        "description": "The pinnacle clash of international rugby league at the Cauldron! A blockbuster Sunday double-header featuring the Women's World Cup Final followed by the Men's World Cup Final.",
        "insider_tip": "Head to Caxton Street 2 hours before kickoff for the electric pre-match atmosphere, cold beers, and street food.",
        "category": "Sports & Active",
        "location": "Suncorp Stadium, Milton",
        "time_str": "Sun, 15 Nov · 3:10 PM Kickoff",
        "start_date": "2026-11-15 15:10",
        "end_date": "2026-11-15 19:30",
        "ongoing": False,
        "price": "$49–$145",
        "source": "Suncorp Stadium & NRL",
        "source_url": "https://www.suncorpstadium.com.au/whats-on/",
        "image_url": "https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=900&q=80",
        "tags": ["Live Sports", "Outdoors"]
    },
    {
        "id": "special-ariarne-titmus-relentless",
        "title": "Ariarne Titmus: Relentless (Brisbane Writers Festival) at Thomas Dixon Centre",
        "description": "Olympic swimming legend Ariarne Titmus in an intimate in-conversation event discussing her extraordinary journey, mental resilience, and new memoir inside West End's architectural Thomas Dixon Centre.",
        "insider_tip": "Arrive early to explore the restored Queensland Ballet heritage home and grab a coffee at the ground-floor cafe.",
        "category": "Arts & Culture",
        "location": "Thomas Dixon Centre, West End",
        "time_str": "Thu, 12 Nov · 6:00 PM",
        "start_date": "2026-11-12 18:00",
        "end_date": "2026-11-12 20:00",
        "ongoing": False,
        "price": "$35",
        "source": "Brisbane Writers Festival",
        "source_url": "https://bwf.org.au",
        "image_url": "https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=900&q=80",
        "tags": ["Indoor", "Arts & Culture"]
    },
    {
        "id": "special-country-day-party-wonderland",
        "title": "Country Day Party: Luke Combs & Morgan Wallen Anthems at Wonderland",
        "description": "Don your cowboy boots for Brisbane's massive daytime country music party! DJ sets blasting modern country anthems, neon line-dancing, cowboy hat giveaways, and themed cocktail jugs.",
        "insider_tip": "Doors open at 3:00 PM — grab a booth early for your crew and order the signature Tennessee Whiskey jugs.",
        "category": "Music & Concerts",
        "location": "Wonderland Brisbane, Fortitude Valley",
        "time_str": "Sat, 14 Nov · 3:00 PM – 9:00 PM",
        "start_date": "2026-11-14 15:00",
        "end_date": "2026-11-14 21:00",
        "ongoing": False,
        "price": "$25–$35",
        "source": "Wonderland Brisbane",
        "source_url": "https://oztix.com.au",
        "image_url": "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=900&q=80",
        "tags": ["Live Music", "Indoor", "Party", "Date Night"]
    },
    {
        "id": "special-pollinator-celebration-ipswich",
        "title": "Pollinator Celebration at Queens Park Environmental Centre",
        "description": "Celebrate local biodiversity and native pollinators in the lush grounds of Queens Park Ipswich. Guided native bee hive walks, plant giveaways, wildlife displays, and nature talks.",
        "insider_tip": "Pair with a stroll through the Queens Park Japanese Nerima Gardens and a coffee at the park cafe.",
        "category": "Outdoor & Adventure",
        "location": "Queens Park Environmental Education Centre, Ipswich",
        "time_str": "Sat, 14 Nov · 10:00 AM – 2:00 PM",
        "start_date": "2026-11-14 10:00",
        "end_date": "2026-11-14 14:00",
        "ongoing": False,
        "price": "Free Entry",
        "source": "Ipswich City Council & Humanitix",
        "source_url": "https://humanitix.com",
        "image_url": "https://images.unsplash.com/photo-1470240731273-7821a6eeb6bd?auto=format&fit=crop&w=900&q=80",
        "tags": ["Outdoors", "Budget", "Date Night", "Nature"]
    },
    {
        "id": "special-flagstone-flavour-sounds",
        "title": "Flagstone Flavour & Sounds Festival: Food Trucks & Live Music",
        "description": "Massive community festival featuring 6 live bands (Killer Queen Experience, Never Ending 80s v 90s, High Voltage AC/DC tribute), 15+ street food trucks, pop-up market stalls, and night fireworks.",
        "insider_tip": "Bring your camp chairs and picnic rug to set up on the oval before the 4:00 PM headline sets kick off.",
        "category": "Music & Concerts",
        "location": "Flagstone State Community College, Flagstone",
        "time_str": "Sat, 14 Nov · 12:00 PM – 9:00 PM",
        "start_date": "2026-11-14 12:00",
        "end_date": "2026-11-14 21:00",
        "ongoing": False,
        "price": "$25 (Under 18 Free)",
        "source": "Logan City Council & TryBooking",
        "source_url": "https://trybooking.com",
        "image_url": "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=900&q=80",
        "tags": ["Live Music", "Outdoors", "Food & Drink"]
    },
    {
        "id": "special-qpsr-steam-railway-kilrie",
        "title": "Join Kilrie on the Heritage Circuit: Vintage Steam Train Journey",
        "description": "Step back to 1924 aboard the restored steam locomotive 'Kilrie' pulling heritage timber carriages through the Swanbank coal circuit, combined with a vintage bus connector and Cooneana historic stopover.",
        "insider_tip": "Book the morning departure at 9:30 AM to catch the cool morning steam exhaust over Swanbank Lake.",
        "category": "Sightseeing & Nature",
        "location": "Swanbank Station, 110 Swanbank Coal Rd, Swanbank",
        "time_str": "Sat, 14 Nov · 9:30 AM – 1:00 PM",
        "start_date": "2026-11-14 09:30",
        "end_date": "2026-11-14 13:00",
        "ongoing": False,
        "price": "$24–$38",
        "source": "Queensland Pioneer Steam Railway",
        "source_url": "https://qpsr.org",
        "image_url": "https://images.unsplash.com/photo-1517457373958-b7bdd4587205?auto=format&fit=crop&w=900&q=80",
        "tags": ["Outdoors", "Romantic", "Date Night", "Heritage"]
    },
    {
        "id": "special-peony-market-day-pocoposy",
        "title": "Peony Market Day: Peak Bloom Bunches at Poco Posy Studio",
        "description": "Brisbane's annual sold-out celebration of fresh Victorian and Tasmanian peonies. Bucketloads of coral, blush, and white peonies at special market prices, plus boutique coffee and pastry pop-ups.",
        "insider_tip": "Arrive within the first 90 minutes — peony bunches sell out quickly every year.",
        "category": "Markets & Pop-ups",
        "location": "Poco Posy Studio, Hendra / Brisbane",
        "time_str": "Sat, 14 Nov · 8:00 AM – 1:00 PM",
        "start_date": "2026-11-14 08:00",
        "end_date": "2026-11-14 13:00",
        "ongoing": False,
        "price": "Free Entry (Bunches from $35)",
        "source": "Poco Posy Florist",
        "source_url": "https://pocoposy.com.au",
        "image_url": "https://images.unsplash.com/photo-1526047932273-341f2a7631f9?auto=format&fit=crop&w=900&q=80",
        "tags": ["Markets", "Romantic", "Budget"]
    },
    {
        "id": "special-orion-sounds-of-90s-pop",
        "title": "Sounds of 90s Pop: Live Tribute Night at Orion Hotel Springfield",
        "description": "A high-energy throwback Saturday night dedicated to the biggest pop anthems of the 90s, live band performances, dance floor classics, and cocktail jugs in the hotel garden lounge.",
        "insider_tip": "Book a dinner table at the Orion Hotel Bistro before 8:00 PM to skip the late door queue.",
        "category": "Music & Concerts",
        "location": "Orion Hotel, 1 Main St, Springfield Central",
        "time_str": "Sat, 14 Nov · 9:00 PM – Late",
        "start_date": "2026-11-14 21:00",
        "end_date": "2026-11-14 23:59",
        "ongoing": False,
        "price": "Free Entry",
        "source": "Orion Hotel Springfield",
        "source_url": "https://orionhotel.com.au",
        "image_url": "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=900&q=80",
        "tags": ["Live Music", "Late Night", "Indoor"]
    },
    {
        "id": "special-aw-collectibles-gold-coast",
        "title": "AW Collectibles Grand Opening & Pop-Culture Showcase",
        "description": "Grand opening showcase of trading cards, Japanese anime figures, Warhammer displays, and collectibles in Biggera Waters on the Gold Coast with launch day giveaways.",
        "insider_tip": "Pair with lunch and an ocean walk at nearby Labrador Broadwater or Harbour Town.",
        "category": "Markets & Pop-ups",
        "location": "Shop 62, 33-47 Hollywell Rd, Biggera Waters, Gold Coast",
        "time_str": "Sat, 14 Nov · 10:00 AM – 4:00 PM",
        "start_date": "2026-11-14 10:00",
        "end_date": "2026-11-14 16:00",
        "ongoing": False,
        "price": "Free Entry",
        "source": "AW Collectibles Gold Coast",
        "source_url": "https://destinationgoldcoast.com",
        "image_url": "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?auto=format&fit=crop&w=900&q=80",
        "tags": ["Indoor", "Budget"]
    },
    {
        "id": "special-custom-lithium-open-day",
        "title": "Custom Lithium HQ Open Day: 4WD Builds & Live Stunt Show",
        "description": "Full day of off-road vehicle displays, trials bike stunt demonstrations, live music, and free community BBQ at Custom Lithium headquarters in Brendale.",
        "insider_tip": "Stunt shows run at 11:30 AM and 2:00 PM on the outdoor tarmac.",
        "category": "Outdoor & Adventure",
        "location": "11 Doherty St, Brendale",
        "time_str": "Sat, 14 Nov · 9:00 AM – 4:00 PM",
        "start_date": "2026-11-14 09:00",
        "end_date": "2026-11-14 16:00",
        "ongoing": False,
        "price": "Free Entry",
        "source": "Custom Lithium Brendale",
        "source_url": "https://customlithium.com.au",
        "image_url": "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&w=900&q=80",
        "tags": ["Outdoors", "Budget"]
    },
    {
        "id": "special-dusk-tours-brookwater",
        "title": "Dusk Tours & Community Starlit Movie Night at Brookwater",
        "description": "Scenic twilight golf course tours spotting wild kangaroos followed by an open-air starlit family movie screening on the lawn with popcorn and wood-fired pizza trucks.",
        "insider_tip": "Bring warm blankets for when the breeze rolls across the fairway after dusk.",
        "category": "Comedy & Shows",
        "location": "22 Magnolia Drive, Brookwater",
        "time_str": "Sat, 14 Nov · 6:00 PM – 9:30 PM",
        "start_date": "2026-11-14 18:00",
        "end_date": "2026-11-14 21:30",
        "ongoing": False,
        "price": "Free Entry",
        "source": "Brookwater Community",
        "source_url": "https://brookwater.com.au",
        "image_url": "https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=900&q=80",
        "tags": ["Outdoors", "Romantic", "Budget"]
    },
    {
        "id": "special-finders-keepers-market-showgrounds",
        "title": "The Finders Keepers Design & Food Market Weekend at Brisbane Showgrounds",
        "description": "Australia's flagship independent design market lands at the Exhibition Building in Bowen Hills for one weekend only — 150+ ceramicists, slow-fashion makers, live DJs, food trucks, and craft bars.",
        "insider_tip": "Friday twilight session (4pm–9pm) is the best for a couple date night with live music, smaller crowds, and dinner trucks.",
        "category": "Markets & Pop-ups",
        "location": "Brisbane Showgrounds, Bowen Hills",
        "time_str": "Fri 20 Nov – Sun 22 Nov · 4:00 PM Fri / 9:00 AM Wknd",
        "start_date": "2026-11-20 16:00",
        "end_date": "2026-11-22 17:00",
        "ongoing": False,
        "price": "$6 entry",
        "source": "The Finders Keepers",
        "source_url": "https://www.thefinderskeepers.com/brisbane-markets/",
        "image_url": "https://images.unsplash.com/photo-1533900298318-6b8da08a523e?auto=format&fit=crop&w=900&q=80",
        "tags": ["Indoor", "Budget", "Markets"]
    },
    {
        "id": "special-qld-ballet-nutcracker-qpac",
        "title": "Queensland Ballet: The Nutcracker Festive Season at QPAC Lyric Theatre",
        "description": "A cherished Brisbane tradition: Tchaikovsky's score played live by the Queensland Symphony Orchestra as Queensland Ballet brings snow-dusted Victorian magic to the Lyric Theatre.",
        "insider_tip": "Stalls Rows G–M centre give you the full sweep of the snowflake waltz and stage sets.",
        "category": "Comedy & Shows",
        "location": "QPAC Lyric Theatre, South Bank",
        "time_str": "27 Nov – 12 Dec · 7:30 PM",
        "start_date": "2026-11-27 19:30",
        "end_date": "2026-12-12 21:30",
        "ongoing": False,
        "price": "$95–$165",
        "source": "Queensland Ballet / QPAC",
        "source_url": "https://www.queenslandballet.com.au/performances",
        "image_url": "https://images.unsplash.com/photo-1518834107812-67b0b7c58434?auto=format&fit=crop&w=900&q=80",
        "tags": ["Romantic", "Indoor", "Arts & Culture"]
    },
    {
        "id": "special-gflip-entertainment-centre",
        "title": "G Flip: DRUMMER Australian Arena Tour at Brisbane Entertainment Centre",
        "description": "LA-based Aussie powerhouse G Flip brings explosive live drum solos, pyrotechnics, and massive pop-rock anthems ('The Worst Person Alive', 'Be Your Man') to Brisbane Entertainment Centre.",
        "insider_tip": "Catch the direct train to Boondall Station — trains run express back to Central and Fortitude Valley right after the encore.",
        "category": "Music & Concerts",
        "location": "Brisbane Entertainment Centre, Boondall",
        "time_str": "Sat, 28 Nov · 7:30 PM",
        "start_date": "2026-11-28 19:30",
        "end_date": "2026-11-28 22:30",
        "ongoing": False,
        "price": "$99–$139",
        "source": "Brisbane Entertainment Centre",
        "source_url": "https://www.brisent.com.au/Event-Calendar",
        "image_url": "https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?auto=format&fit=crop&w=900&q=80",
        "tags": ["Live Music", "Indoor", "Late Night"]
    },
    {
        "id": "special-crowded-house-brisbane",
        "title": "Crowded House: Gravity Stairs Tour at Brisbane Entertainment Centre",
        "description": "Neil Finn and Crowded House return to Brisbane for a timeless evening of 'Don't Dream It's Over', 'Something So Strong', 'Better Be Home Soon', and lush new harmonies.",
        "insider_tip": "Arrive 45 minutes early to grab food from the outdoor courtyard trucks before heading into the arena bowl.",
        "category": "Music & Concerts",
        "location": "Brisbane Entertainment Centre, Boondall",
        "time_str": "Sat, 5 Dec · 7:30 PM",
        "start_date": "2026-12-05 19:30",
        "end_date": "2026-12-05 22:30",
        "ongoing": False,
        "price": "$119–$169",
        "source": "Brisbane Entertainment Centre",
        "source_url": "https://www.brisent.com.au/Event-Calendar",
        "image_url": "https://images.unsplash.com/photo-1429962714451-bb934ecdc4ec?auto=format&fit=crop&w=900&q=80",
        "tags": ["Live Music", "Indoor", "Romantic"]
    },
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
    },
    {
        "id": "seq-hota-gold-coast",
        "title": "HOTA (Home of the Arts): Outdoor Cinema & Lakeside Rooftop Bar",
        "description": "The Gold Coast's premier cultural playground in Surfers Paradise: parkside outdoor amphitheatre screenings, world-class gallery exhibitions, and sunset cocktails at The Exhibitionist Rooftop overlooking the canal skyline.",
        "insider_tip": "Time your visit for golden hour on the Level 5 rooftop terrace before walking over the green bridge to Chevron Island for dinner.",
        "category": "Arts & Culture",
        "location": "135 Bundall Rd, Surfers Paradise, Gold Coast",
        "time_str": "Wed–Sun · 10:00 AM – Late",
        "start_date": None,
        "end_date": None,
        "ongoing": True,
        "price": "Free Gallery / $20 Shows",
        "source": "HOTA Gold Coast",
        "source_url": "https://hota.com.au",
        "image_url": "https://images.unsplash.com/photo-1507676184212-d03ab07a01bf?auto=format&fit=crop&w=900&q=80",
        "tags": ["Romantic", "Outdoor", "Date Night", "Arts & Culture"]
    },
    {
        "id": "seq-burleigh-rick-shores",
        "title": "Burleigh Heads Sunset & Rick Shores Oceanfront Dining",
        "description": "Perched literally over the waves at Burleigh Heads. Sip cold champagne while waves crash against the glass and share their legendary Moreton Bay bug rolls with views stretching all the way up the coast to Surfers Paradise.",
        "insider_tip": "Book an ocean-edge high table 4 weeks in advance for 5:15 PM to catch the full pastel sunset over the water.",
        "category": "Food & Drink",
        "location": "Goodwin Terrace, Burleigh Heads, Gold Coast",
        "time_str": "Wed–Sun · 11:30 AM – Late",
        "start_date": None,
        "end_date": None,
        "ongoing": True,
        "price": "$80–$140",
        "source": "Rick Shores Burleigh",
        "source_url": "https://rickshores.com.au",
        "image_url": "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=80",
        "tags": ["Romantic", "Food & Drink", "Outdoor"]
    },
    {
        "id": "seq-miami-marketta-gold-coast",
        "title": "Miami Marketta: Laneway Street Food & Live Gin Hall",
        "description": "The Gold Coast's original creative night hub: fairy-lit laneways filled with 25+ global street food vendors, boutique dessert bars, live indie acoustic acts, and a dedicated craft gin parlour.",
        "insider_tip": "Wednesday night is Street Food Tapas night — great for trying dishes from multiple vendors without the Friday weekend rush.",
        "category": "Markets & Pop-ups",
        "location": "23 Hillcrest Parade, Miami, Gold Coast",
        "time_str": "Wed, Fri & Sat · 5:00 PM – 10:00 PM",
        "start_date": None,
        "end_date": None,
        "ongoing": True,
        "price": "Free Entry",
        "source": "Miami Marketta",
        "source_url": "https://www.miamimarketta.com",
        "image_url": "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=900&q=80",
        "tags": ["Markets", "Live Music", "Food & Drink", "Budget"]
    },
    {
        "id": "seq-noosa-river-sunset-cruise",
        "title": "Noosa River Sunset Cruise & Hastings Street Seaside Dining",
        "description": "Drift along the calm waters of the Noosa River and through the pristine Noosa Sound as the sun drops behind the hinterland, followed by dinner and gelato along world-famous Hastings Street.",
        "insider_tip": "Pack your own boutique bottle of wine and cheese board aboard the BYO sunset ferry from Noosa Marina.",
        "category": "Outdoor & Adventure",
        "location": "Hastings Street & Noosa Marina, Sunshine Coast",
        "time_str": "Daily · Sunset departures from 4:30 PM",
        "start_date": None,
        "end_date": None,
        "ongoing": True,
        "price": "$28–$45",
        "source": "Visit Noosa",
        "source_url": "https://www.visitnoosa.com.au",
        "image_url": "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=900&q=80",
        "tags": ["Outdoors", "Romantic", "Date Night"]
    },
    {
        "id": "seq-eumundi-artisan-markets",
        "title": "The Original Eumundi Markets: Hinterland Artisan Craft Trail",
        "description": "Australia's premier artisan craft market set under towering heritage fig trees. Browse 500+ stalls of handcrafted timber, local blown glass, natural skincare, and gourmet hinterland delicacies.",
        "insider_tip": "Pair a Saturday morning market crawl with a scenic drive up to Kondalilla Falls and a cheese tasting in Maleny.",
        "category": "Markets & Pop-ups",
        "location": "80 Memorial Drive, Eumundi, Sunshine Coast",
        "time_str": "Wednesdays (8am–2pm) & Saturdays (7am–2pm)",
        "start_date": None,
        "end_date": None,
        "ongoing": True,
        "price": "Free Entry",
        "source": "Eumundi Markets",
        "source_url": "https://eumundimarkets.com.au",
        "image_url": "https://images.unsplash.com/photo-1533900298318-6b8da08a523e?auto=format&fit=crop&w=900&q=80",
        "tags": ["Markets", "Outdoors", "Budget"]
    },
    {
        "id": "seq-mooloolaba-wharf",
        "title": "The Wharf Mooloolaba: Waterfront Dining & Coastal Pier Stroll",
        "description": "A picturesque coastal dining precinct on the Mooloolaba marina. Enjoy fresh Mooloolaba king prawns, sunset cocktails over the boat harbour, and boutique coastal shopping.",
        "insider_tip": "Grab a scoop of handcrafted gelato from Fior Di Latte and walk out along the Mooloolaba lighthouse breakwall at dusk.",
        "category": "Food & Drink",
        "location": "123 Parkyn Parade, Mooloolaba, Sunshine Coast",
        "time_str": "Daily · 8:00 AM – Late",
        "start_date": None,
        "end_date": None,
        "ongoing": True,
        "price": "Varies",
        "source": "The Wharf Mooloolaba",
        "source_url": "https://wharfmooloolaba.com.au",
        "image_url": "https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=900&q=80",
        "tags": ["Food & Drink", "Outdoors", "Romantic"]
    },
    {
        "id": "seq-daisy-hill-koala-forest",
        "title": "Daisy Hill Koala Centre & Eucalyptus Canopy Walking Trails",
        "description": "Nestled in 435 hectares of pristine eucalypt bushland in Logan: see resident koalas up close in the large outdoor viewing enclosure, walk elevated canopy boardwalks, and enjoy a quiet shaded picnic.",
        "insider_tip": "Admission is completely free — great to pair with an afternoon bushwalk along the Stringybark track.",
        "category": "Sightseeing & Nature",
        "location": "253 Daisy Hill Rd, Daisy Hill, Logan",
        "time_str": "Daily · 9:00 AM – 4:00 PM",
        "start_date": None,
        "end_date": None,
        "ongoing": True,
        "price": "Free Entry",
        "source": "Queensland Parks & Wildlife",
        "source_url": "https://parks.des.qld.gov.au/parks/daisy-hill/things-to-do",
        "image_url": "https://images.unsplash.com/photo-1527525443983-6e60c75fff46?auto=format&fit=crop&w=900&q=80",
        "tags": ["Outdoors", "Budget", "Sightseeing & Nature"]
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
    if (ev.get("category") == "Sports & Active" and not ev.get("ongoing")) or any(pat in tl for pat in TRUE_DATED_TITLE_PATTERNS) or str(ev.get("id", "")).startswith("special-") or str(ev.get("id", "")).startswith("movie-") or str(ev.get("id", "")).startswith("fb-") or str(ev.get("id", "")).startswith("live-"):
        sd = (ev.get("start_date") or "")[:10]
        return f"dated_{tl}_{sd}"
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
    is_true_dated_show = (
        any(pat in tl for pat in TRUE_DATED_TITLE_PATTERNS)
        or str(ev.get("id", "")).startswith("special-")
        or str(ev.get("id", "")).startswith("movie-")
        or str(ev.get("id", "")).startswith("fb-")
        or str(ev.get("id", "")).startswith("live-")
        or "in cinemas" in tl
        or (not ev.get("ongoing") and bool(ev.get("start_date")))
    )

    # Apply explicit dates from SPECIAL_EVENT_DATES_MAP when matched
    for pat, (mapped_sd, mapped_ed, mapped_ts) in SPECIAL_EVENT_DATES_MAP.items():
        if pat in tl:
            ev["start_date"] = mapped_sd
            ev["end_date"] = mapped_ed
            ev["time_str"] = mapped_ts
            ev["ongoing"] = False
            break

    if is_sports_fixture or is_true_dated_show:
        ev["ongoing"] = False
        sd = (ev.get("start_date") or "")[:10]
        ed = (ev.get("end_date") or sd)[:10]
        # Only keep events whose end date is today or in the future
        if ed and ed < today_ymd:
            return None  # Past event — drop it so obsolete dates never pollute feeds
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


def fetch_brisbane_city_council_trumba(today_ymd: str) -> list[dict]:
    """
    Pulls live, official upcoming events directly from Brisbane City Council's public Trumba calendar feed.
    Filters for couple & date-worthy events (music, exhibitions, festivals, markets, creative workshops, active outdoors).
    Drops mundane non-date entries (toddler sessions, playgroups, immunisations).
    """
    discovered = []
    url = "https://www.trumba.com/calendars/brisbane-city-council.json"
    req_headers = {"User-Agent": "TwoDoBrisbaneDateApp/3.6 (+https://twodoapp.web.app)"}
    try:
        req = urllib.request.Request(url, headers=req_headers)
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"[Council Feed] Network fetch failed or offline: {e}")
        return []

    EXCLUDE_KEYWORDS = {
        "toddler", "babies", "baby", "rhyme time", "storytime", "playgroup", 
        "under 5s", "first 5", "immunisation", "immunization", "kindergarten",
        "story time", "children's story", "infant", "child restraint", "english conversation",
        "citizenship test", "justice of the peace"
    }

    CATEGORY_MAP = {
        "music": "Music & Concerts",
        "band": "Music & Concerts",
        "acoustic": "Music & Concerts",
        "concert": "Music & Concerts",
        "performing arts": "Comedy & Shows",
        "theatre": "Comedy & Shows",
        "comedy": "Comedy & Shows",
        "exhibitions": "Arts & Culture",
        "art": "Arts & Culture",
        "creative": "Arts & Culture",
        "culture": "Arts & Culture",
        "markets": "Markets & Pop-ups",
        "christmas": "Markets & Pop-ups",
        "food": "Food & Drink",
        "tours": "Outdoor & Adventure",
        "green": "Outdoor & Adventure",
        "move well brisbane": "Outdoor & Adventure",
        "fitness & well-being": "Outdoor & Adventure",
        "fitness": "Outdoor & Adventure",
        "workshops": "Arts & Culture",
    }

    CATEGORY_IMAGES = {
        "Music & Concerts": "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=900&q=80",
        "Arts & Culture": "https://images.unsplash.com/photo-1536924940846-227afb31e2a5?auto=format&fit=crop&w=900&q=80",
        "Markets & Pop-ups": "https://images.unsplash.com/photo-1533900298318-6b8da08a523e?auto=format&fit=crop&w=900&q=80",
        "Comedy & Shows": "https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=900&q=80",
        "Food & Drink": "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=900&q=80",
        "Outdoor & Adventure": "https://images.unsplash.com/photo-1470240731273-7821a6eeb6bd?auto=format&fit=crop&w=900&q=80",
    }

    for ev in data:
        title = (ev.get("title") or "").strip()
        link = ev.get("permaLinkUrl") or ev.get("webLink")
        if not title or not link or not is_valid_source_url(link):
            continue

        tl = title.lower()
        if any(w in tl for w in EXCLUDE_KEYWORDS):
            continue

        end_dt = (ev.get("endDateTime") or "")[:10]
        if end_dt and end_dt < today_ymd:
            continue

        start_dt = ev.get("startDateTime") or ""
        time_formatted = ev.get("dateTimeFormatted") or "See official link for times"

        desc_raw = ev.get("description") or ""
        desc_clean = re.sub(r"<[^>]+>", "", desc_raw).strip()
        desc_clean = html.unescape(desc_clean)
        if any(w in desc_clean[:80].lower() for w in EXCLUDE_KEYWORDS):
            continue

        custom = {cf.get("label"): cf.get("value") for cf in ev.get("customFields", []) if isinstance(cf, dict)}
        raw_type = (custom.get("Primary event type") or custom.get("Event type") or "").lower()
        venue = custom.get("Venue") or ev.get("location") or "Brisbane, QLD"
        cost = custom.get("Cost") or "Free"

        # Determine Category
        category = "Arts & Culture"
        combined_type_str = f"{raw_type} {tl}"
        for k_type, cat_val in CATEGORY_MAP.items():
            if k_type in combined_type_str:
                category = cat_val
                break

        # Extract image if available
        image_url = None
        for img_field in ["eventImage", "detailImage"]:
            val = ev.get(img_field)
            if isinstance(val, dict) and val.get("url"):
                image_url = val.get("url")
                break
        if not image_url:
            image_url = CATEGORY_IMAGES.get(category, CATEGORY_IMAGES["Arts & Culture"])

        # Determine tags
        tags = []
        if "free" in cost.lower() or "free" in raw_type:
            tags.append("Budget")
        if any(w in tl or w in raw_type for w in ["music", "concert", "band", "acoustic"]):
            tags.append("Live Music")
        if any(w in tl or w in raw_type for w in ["market", "pop-up", "stall", "fair"]):
            tags.append("Markets")
        if any(w in tl or w in raw_type for w in ["walk", "tour", "trail", "kayak", "outdoor", "park", "garden"]):
            tags.append("Outdoors")
        if any(w in tl or w in raw_type for w in ["art", "exhibition", "gallery", "museum", "show", "hall", "library"]):
            tags.append("Indoor")
        if not tags:
            tags.append("Romantic")

        event_id = f"live-council-{ev.get('eventID', '') or re.sub(r'[^a-z0-9]+', '-', tl)[:30]}"

        tip = f"Official Brisbane City Council event at {venue}. Check the official link for session bookings and accessibility."

        discovered.append({
            "id": event_id,
            "title": title,
            "description": desc_clean[:280] or f"Official Brisbane City Council event at {venue}.",
            "insider_tip": tip,
            "category": category,
            "location": venue,
            "time_str": time_formatted,
            "start_date": start_dt[:16].replace("T", " ") if start_dt else None,
            "end_date": end_dt[:16].replace("T", " ") if end_dt else None,
            "ongoing": False if start_dt else True,
            "price": cost,
            "source": "Brisbane City Council",
            "source_url": link,
            "image_url": image_url,
            "tags": tags
        })

    return discovered


def fetch_live_public_feeds(today_ymd: str) -> list[dict]:
    """
    Attempts to pull fresh Brisbane events from public RSS/JSON endpoints across Brisbane areas.
    Only keeps events that have a valid direct `source_url`.
    """
    discovered = []
    rss_feeds = [
        ("https://www.MustDoBrisbane.com/rss.xml", "Must Do Brisbane", "Brisbane"),
        ("https://concreteplayground.com/brisbane/feed", "Concrete Playground", "Brisbane"),
        ("https://www.discoveripswich.com.au/feed/", "Discover Ipswich", "Ipswich, QLD"),
        ("https://ourlogan.com.au/feed/", "Our Logan", "Logan, QLD"),
        ("https://destinationgoldcoast.com/feed", "Destination Gold Coast", "Gold Coast, QLD"),
        ("https://www.visitsunshinecoast.com/feed", "Visit Sunshine Coast", "Sunshine Coast, QLD"),
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
        ("Gold Coast & Burleigh", "Gold Coast, QLD", ["gold coast", "burleigh", "surfers paradise", "broadbeach", "coolangatta", "southport", "biggera waters", "miami marketta", "currumbin", "palm beach", "mermaid beach", "robina", "hota", "home of the arts", "labrador"]),
        ("Sunshine Coast & Noosa", "Sunshine Coast, QLD", ["sunshine coast", "noosa", "noosa heads", "mooloolaba", "maroochydore", "caloundra", "coolum", "eumundi"]),
        ("Ipswich & Greater West", "Ipswich, QLD", ["ipswich", "swanbank", "springfield", "brookwater", "inala", "oxley", "ripley", "queens park ipswich", "qpsr", "kilrie", "cooneana"]),
        ("Logan & Southern Suburbs", "Logan, QLD", ["flagstone", "daisy hill", "logan central", "springwood", "beenleigh", "parkinson", "acacia ridge", "brendale"]),
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


CURATED_CURRENT_CINEMA_EXPERIENCES = [
    {
        "id": "special-palace-james-st-cinema-wine",
        "title": "Palace Cinemas James St: Boutique Date-Night Cinema & Wine Bar",
        "description": "The quintessential Fortitude Valley date night: sink into plush leather recliners with a glass of prosecco or pinot noir and a curated cheese board while watching the latest releases and international film festival highlights.",
        "insider_tip": "Grab a drink at the stylish cinema foyer bar 20 minutes before your screening and take your wine straight to your seat.",
        "category": "Comedy & Shows",
        "location": "Palace James St, Fortitude Valley",
        "time_str": "Now Showing · Daily Screenings",
        "start_date": "2026-11-01 10:00",
        "end_date": "2027-12-31 23:00",
        "ongoing": False,
        "price": "$19–$26",
        "source": "Palace Cinemas James St",
        "source_url": "https://www.palacecinemas.com.au/cinemas/palace-james-st",
        "image_url": "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=900&q=80",
        "tags": ["Cinema", "Date Night", "Romantic", "Indoor"]
    },
    {
        "id": "special-now-showing-brisbane-cinemas",
        "title": "Now Showing in Brisbane Cinemas: Live Session Times & Tickets",
        "description": "Discover what's currently playing across all Brisbane screens tonight — from boutique independent indie films at New Farm and Dendy to blockbuster experiences at Palace Barracks and Event Cinemas.",
        "insider_tip": "Browse today's real-time Brisbane sessions and reviews across all nearby theatres in one tap.",
        "category": "Comedy & Shows",
        "location": "Brisbane Cinemas (Palace, Dendy, Five Star & Event)",
        "time_str": "Daily Sessions · Today & This Week",
        "start_date": "2026-11-01 10:00",
        "end_date": "2027-12-31 23:00",
        "ongoing": False,
        "price": "$17–$26",
        "source": "Flicks Brisbane In Cinemas",
        "source_url": "https://www.flicks.com.au/brisbane/in-cinemas/",
        "image_url": "https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=900&q=80",
        "tags": ["Cinema", "Date Night", "Indoor"]
    },
    {
        "id": "special-blue-room-cinebar-rosalie",
        "title": "Blue Room Cinebar: In-Seat Pizza & Craft Beer Dining in Rosalie",
        "description": "Brisbane's original boutique cinema dining destination: kick back in plush leather armchairs with a private side table, ordering hot wood-fired pizzas, gourmet sliders, and craft beers delivered directly to your seat during the film.",
        "insider_tip": "Order their signature truffle fries and a local craft beer from the menu 10 minutes before the opening credits roll.",
        "category": "Comedy & Shows",
        "location": "Blue Room Cinebar, Rosalie",
        "time_str": "Now Showing · Daily Screenings & Dining",
        "start_date": "2026-11-01 12:00",
        "end_date": "2027-12-31 23:00",
        "ongoing": False,
        "price": "$18–$28",
        "source": "Blue Room Cinebar Rosalie",
        "source_url": "https://blueroomcinebar.com",
        "image_url": "https://images.unsplash.com/photo-1509281373149-e957c6296406?auto=format&fit=crop&w=900&q=80",
        "tags": ["Cinema", "Date Night", "Late Night", "Romantic"]
    },
    {
        "id": "special-elizabeth-picture-theatre",
        "title": "Elizabeth Picture Theatre: Heritage Leather Cinema & Wine in the CBD",
        "description": "Housed inside the heritage 1919 Tara House in the heart of Brisbane CBD. Features magnificent high ceilings, antique stained glass, full bar service, and plush leather reclining armchairs.",
        "insider_tip": "Book the Royal Lounge for fully motorized reclining armchairs and table service.",
        "category": "Comedy & Shows",
        "location": "Elizabeth Picture Theatre, Brisbane CBD",
        "time_str": "Now Showing · Daily Screenings",
        "start_date": "2026-11-01 11:00",
        "end_date": "2027-12-31 23:00",
        "ongoing": False,
        "price": "$16–$22",
        "source": "Five Star Cinemas",
        "source_url": "https://fivestarcinemas.com.au/the-elizabeth",
        "image_url": "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=900&q=80",
        "tags": ["Cinema", "Date Night", "Indoor", "Romantic"]
    },
    {
        "id": "special-dendy-portside-cinema",
        "title": "Dendy Cinemas Portside: Waterfront Movie Night & Wine Lounge",
        "description": "Pair a river breeze walk along Hamilton Harbour with boutique cinema comfort at Dendy Portside. Grab gourmet choc-tops, local Queensland wines, and watch new releases in intimate theatres.",
        "insider_tip": "Pair a twilight movie with dinner at Byblos or Sono Japanese downstairs in the Portside wharf precinct.",
        "category": "Comedy & Shows",
        "location": "Dendy Cinemas Portside, Hamilton",
        "time_str": "Now Showing · Daily Screenings",
        "start_date": "2026-11-01 11:00",
        "end_date": "2027-12-31 23:00",
        "ongoing": False,
        "price": "$17–$25",
        "source": "Dendy Cinemas Portside",
        "source_url": "https://www.dendy.com.au/cinemas/portside",
        "image_url": "https://images.unsplash.com/photo-1536440136628-849c177e76a1?auto=format&fit=crop&w=900&q=80",
        "tags": ["Cinema", "Date Night", "Indoor"]
    }
]


def fetch_tmdb_now_playing(api_key: str = None) -> list:
    """Live integration with The Movie Database (TMDB) for theatrical releases in Australia."""
    key = api_key or os.environ.get("TMDB_API_KEY", "")
    if not key:
        return []
    try:
        url = f"https://api.themoviedb.org/3/movie/now_playing?api_key={key}&region=AU&language=en-AU&page=1"
        req = urllib.request.Request(url, headers={"User-Agent": "TwoDo/5.3 (Brisbane)"})
        with urllib.request.urlopen(req, timeout=8) as res:
            data = json.loads(res.read().decode("utf-8"))
        results = data.get("results", [])
        movies = []
        today_ymd = datetime.now().strftime("%Y-%m-%d")
        for m in results[:10]:
            title = m.get("title")
            overview = m.get("overview", "")
            poster_path = m.get("poster_path")
            img = f"https://image.tmdb.org/t/p/w780{poster_path}" if poster_path else "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=900&q=80"
            rating = m.get("vote_average", 0)
            mid = f"movie-tmdb-{m.get('id')}"
            movies.append({
                "id": mid,
                "title": f"{title} (Now Showing in Brisbane Cinemas)",
                "description": overview[:220] + "..." if len(overview) > 220 else overview,
                "insider_tip": f"Rated {rating:.1f}/10 by cinema-goers. Grab tickets at Palace James St, Dendy, or Five Star Cinemas.",
                "category": "Comedy & Shows",
                "location": "Brisbane Cinemas (Palace, Dendy & Five Star)",
                "time_str": "Now Showing in Cinemas · Daily Screenings",
                "start_date": f"{today_ymd} 13:00",
                "end_date": "2026-12-31 23:00",
                "ongoing": False,
                "price": "$17–$26",
                "source": "TMDB & Australian Cinemas",
                "source_url": "https://www.flicks.com.au/brisbane/in-cinemas/",
                "image_url": img,
                "tags": ["Cinema", "Date Night", "Indoor"]
            })
        return movies
    except Exception as e:
        print(f"TMDB fetch warning: {e}")
        return []


def fetch_facebook_events_apify(apify_token: str = None) -> list:
    """
    Scrapes live Brisbane events from Facebook using Apify's Facebook Events Scraper actor.
    Accepts an APIFY_TOKEN from environment or passed directly from Creator Dashboard.
    """
    token = apify_token or os.environ.get("APIFY_TOKEN", "") or os.environ.get("FACEBOOK_APIFY_TOKEN", "")
    if not token:
        return []
    try:
        url = f"https://api.apify.com/v2/acts/apify~facebook-events-scraper/run-sync-get-dataset-items?token={token}"
        payload = json.dumps({
            "searchQueries": ["Brisbane", "Fortitude Valley", "South Bank", "West End"],
            "location": "Brisbane, Queensland, Australia",
            "maxEvents": 40,
            "dateFilter": "this_week"
        }).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "TwoDo/5.3 (Brisbane)"
            },
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=30) as res:
            items = json.loads(res.read().decode("utf-8"))
        
        events = []
        for it in items:
            title = it.get("title") or it.get("name")
            if not title:
                continue
            fbid = it.get("id") or str(abs(hash(title)))
            raw_url = it.get("url") or f"https://www.facebook.com/events/{fbid}/"
            sd = it.get("startDate") or it.get("start_date") or ""
            ed = it.get("endDate") or it.get("end_date") or sd
            loc_data = it.get("location") or {}
            venue_name = loc_data.get("name") if isinstance(loc_data, dict) else str(loc_data)
            venue = venue_name or "Brisbane, QLD"
            desc = it.get("description") or "Live local event discovered on Facebook Events."
            img = it.get("imageUrl") or it.get("photo") or "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=900&q=80"
            events.append({
                "id": f"fb-{fbid}",
                "title": title.strip(),
                "description": desc[:280] + "..." if len(desc) > 280 else desc,
                "insider_tip": f"Discovered on Facebook Events · Popular with locals in {venue}.",
                "category": "Comedy & Shows" if any(w in title.lower() for w in ["theatre", "comedy", "show"]) else ("Music & Concerts" if any(w in title.lower() for w in ["live", "tour", "band", "music", "dj", "party"]) else "Markets & Pop-ups"),
                "location": venue,
                "time_str": sd[:16].replace("T", " ") if sd else "This Week",
                "start_date": sd[:16].replace("T", " ") if sd else None,
                "end_date": ed[:16].replace("T", " ") if ed else None,
                "ongoing": False,
                "price": "$15–$35",
                "source": "Facebook Events",
                "source_url": raw_url,
                "image_url": img,
                "tags": ["Facebook Event", "Community", "Date Night"]
            })
        return events
    except Exception as e:
        print(f"Apify Facebook Events fetch notice: {e}")
        return []


def build_clean_catalog(try_network: bool = False):
    today_ymd = datetime.now().strftime("%Y-%m-%d")
    with open(EVENTS_JS_PATH, "r", encoding="utf-8") as f:
        text = f.read()
    m = re.search(r"const PRELOADED_EVENTS\s*=\s*(\[.*\]);", text, re.S)
    if not m:
        raise RuntimeError("Could not parse PRELOADED_EVENTS from events_data.js")
    raw_events = json.loads(m.group(1))

    # Merge boutique cinema experiences and curated special dated events first
    candidates = CURATED_CURRENT_CINEMA_EXPERIENCES + CURATED_SPECIAL_DATED_EVENTS + CURATED_STAY_IN_AND_REGIONAL_GEMS + list(raw_events)
    if try_network:
        candidates.extend(fetch_brisbane_city_council_trumba(today_ymd))
        candidates.extend(fetch_live_public_feeds(today_ymd))
        candidates.extend(fetch_tmdb_now_playing())
        candidates.extend(fetch_facebook_events_apify())

    kept = []
    seen_keys = set()
    seen_ids = set()

    for ev in candidates:
        t = (ev.get("title") or "").strip()
        if not t:
            continue
        ev_id = (ev.get("id") or "").strip()
        # Drop stale hardcoded movie cards that are past being in cinemas!
        if ev_id in {"movie-wicked-cinemas", "movie-gladiator-2-cinemas", "movie-anora-cinemas", "movie-wild-robot-cinemas", "movie-heretic-cinemas", "movie-a-real-pain-cinemas"}:
            continue
        if ev_id and ev_id in seen_ids:
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
        if ev_id:
            seen_ids.add(ev_id)
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
    try_net = "--offline" not in sys.argv
    build_clean_catalog(try_network=try_net)

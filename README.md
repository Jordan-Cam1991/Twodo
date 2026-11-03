# ❤️ TwoDo — The Couple's Adventure & Date Planner

> **Discover together. Match what you love. Plan your next unforgettable date.**

TwoDo is a couple-focused web application designed to help you and your partner discover things to do in your area, find activities you both want to do, and easily build a shared date night itinerary.

---

## 🌟 Key Features

### 1. 🌐 Multi-Source Activity & Event Aggregator
TwoDo pulls and aggregates things to do across the internet tailored to any city or region you select:
- **Live Ticketed Events & Shows**: Integrated with Ticketmaster API connectors.
- **Community Events & Markets**: Eventbrite discovery connectors.
- **Local Attractions & Hidden Gems**: OpenStreetMap / Overpass connector pulling real viewpoints, botanical gardens, historic landmarks, and theaters worldwide without requiring API keys.
- **Curated City Date Experiences**: Authentic date night specials, romantic spots, outdoor adventures, food & wine trails, and comedy basements.
- **Dynamic City Explorer**: Automatically synthesizes and localizes activities for any suburb, city, or destination worldwide.

### 2. 💑 Collaborative Couple Mode & "It's a Match!"
- **Dual Partner Profiles**: Configure your names (e.g. *Emma & Partner*) and custom colors.
- **Voting Mechanism**:
  - Vote **❤️ Love it!**, **🤔 Maybe**, or **❌ Pass** on any activity.
  - Switch easily between voting as Partner 1, Partner 2, or **Together Mode**.
- **Mutual Match Celebrations**: When both partners vote ❤️ or 🤔 on the same activity, TwoDo triggers a **"🎉 It's a Match!"** celebration modal with floating confetti and sound.
- **Smart Filters**: Filter by *Mutual Matches*, *Emma's Favorites*, *Partner's Favorites*, or *Unvoted*.

### 3. 🔥 Date Night Swiper (Tinder-Style)
- Relax on the sofa together and swipe through activities:
  - Swipe **Right (❤️)** to Love & add to Bucket List.
  - Swipe **Left (❌)** to Pass.
  - Swipe **Up (🤔)** to save for later.
- If your partner already swiped right, you'll instantly unlock a Date Match!

### 4. 📅 Shared Planner & Weekend Itinerary Builder
- **Scheduled Dates Timeline**: Organize dates by day (*Friday*, *Saturday*, *Sunday*) and time slot (*Morning*, *Afternoon*, *Evening*, *Late Night*).
- **Date Ideas Vault / Bucket List**: Keep saved mutual favorites in a backlog ready to be scheduled for the upcoming weekend.
- **Reservation & Budget Tracker**: Keep track of table booking notes, dress codes, and estimated budget.
- **1-Click Calendar Sync (.ics)**: Export your scheduled dates directly into Apple Calendar, Google Calendar, or Outlook.
- **Copy Date Summary**: One click generates a cute, formatted date schedule ready to paste into iMessage or WhatsApp.

### 5. 🗺️ Interactive Area Map
- View all nearby activities and date spots geographically on a color-coded Leaflet map.
- Click any marker to view photo, price, location, and plan it directly.

### 6. ➕ Custom Activity & Instagram/TikTok Link Adder
- Spotted an awesome rooftop bar on Instagram or a pasta workshop on TikTok? Add it in seconds with a custom link, photo, and insider tip.

---

## 🚀 Quick Start (Mac)

TwoDo is built with **zero external dependencies** — it runs out-of-the-box using the built-in macOS Python 3 runtime and SQLite.

### Method 1: Using the 1-Click Launch Script
In Terminal, simply run:
```bash
./run.sh
```
This automatically starts the server and opens your browser to:
👉 **[http://localhost:5050](http://localhost:5050)**

### Method 2: Direct Python Command
```bash
python3 server.py 5050
```

---

## 🏗️ Architecture & Codebase Structure

```
Stuff to do/
├── run.sh                         # 1-click startup script for macOS
├── server.py                      # Root entrypoint
├── app/
│   ├── backend/
│   │   ├── __init__.py
│   │   ├── server.py              # Pure Python HTTP REST API server
│   │   ├── database.py            # SQLite schema, migrations & queries
│   │   ├── aggregator.py          # Multi-source deduplication & enricher
│   │   ├── utils.py               # RFC 5545 iCalendar (.ics) generator
│   │   └── sources/
│   │       ├── curated_seeds.py   # Curated & dynamic city date engines
│   │       ├── ticketmaster.py    # Ticketmaster Discovery API connector
│   │       ├── eventbrite.py      # Eventbrite connector
│   │       ├── openstreetmap.py   # OpenStreetMap Overpass places connector
│   │       └── web_search.py      # Live search parser
│   ├── static/
│   │   ├── index.html             # Responsive Single Page Application
│   │   ├── css/
│   │   │   └── style.css          # Modern couple theme & layout
│   │   └── js/
│   │       ├── app.js             # Core app controller & navigation
│   │       ├── discover.js        # Search, filters, and cards
│   │       ├── swiper.js          # Tinder-style couple card deck
│   │       ├── planner.js         # Itinerary builder & calendar sync
│   │       ├── collaborative.js   # Match detection & celebrations
│   │       ├── map.js             # Leaflet.js interactive map
│   │       └── api.js             # Backend REST client
│   └── data/
│       └── twodo.db               # SQLite database (persists votes & plans)
└── README.md
```

---

## ⚙️ Configuration & Customization
- **Change Default City**: Click the location pill in the navigation bar to pick from quick presets (*Brisbane*, *Sydney*, *Melbourne*, *Gold Coast*, *New York*, *London*, etc.) or type any city name.
- **Partner Profiles**: Click the ⚙️ settings icon to customize partner names (e.g. *Emma & Luke*) and partner colors.
- **API Keys (Optional)**: In settings, you can add personal API keys for Ticketmaster or Eventbrite for higher rate limits. By default, TwoDo works immediately using public directory feeds and seed generators.

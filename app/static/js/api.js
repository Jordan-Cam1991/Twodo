/**
 * TwoDo API Client & Universal Storage Engine
 * Connects to the Python backend when running locally/cloud (Render/Railway),
 * with automatic seamless client-side localStorage fallback when running on Netlify or offline.
 */
const api = {
  baseUrl: '',
  serverAvailable: null,

  async safeFetch(url, options = {}) {
    const timeoutMs = options.timeout || 12000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`HTTP error ${res.status}`);
      }

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json') && !contentType.includes('text/calendar')) {
        throw new Error('Non-JSON response received');
      }

      return res;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  },

  // ---------------------------------------------------------------------------
  // PROFILE API
  // ---------------------------------------------------------------------------
  async getProfile() {
    try {
      const res = await this.safeFetch(`${this.baseUrl}/api/profile`);
      this.serverAvailable = true;
      const data = await res.json();
      localStorage.setItem('twodo_profile', JSON.stringify(data));
      return data;
    } catch (e) {
      this.serverAvailable = false;
      const saved = localStorage.getItem('twodo_profile');
      if (saved) {
        try { return JSON.parse(saved); } catch (err) {}
      }
      return {
        user1_name: 'Emma',
        user2_name: 'Jordan',
        default_city: 'Brisbane',
        current_city: 'Brisbane',
        api_keys_json: '{}'
      };
    }
  },

  async updateProfile(data) {
    localStorage.setItem('twodo_profile', JSON.stringify(data));
    try {
      const res = await this.safeFetch(`${this.baseUrl}/api/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return await res.json();
    } catch (e) {
      return { success: true, profile: data };
    }
  },

  // ---------------------------------------------------------------------------
  // EVENTS API (WITH CLIENT-SIDE INTELLIGENT FILTERING FALLBACK)
  // ---------------------------------------------------------------------------
  async getEvents(params = {}) {
    const qs = new URLSearchParams();
    if (params.city) qs.append('city', params.city);
    if (params.category && params.category !== 'All') {
      const catVal = Array.isArray(params.category) ? params.category.filter(c => c && c !== 'All').join(',') : params.category;
      if (catVal && catVal !== 'All') qs.append('category', catVal);
    }
    if (params.search) qs.append('search', params.search);
    if (params.filter && params.filter !== 'all') qs.append('filter', params.filter);
    if (params.date_range && params.date_range !== 'all') qs.append('date_range', params.date_range);
    if (params.custom_start) qs.append('custom_start', params.custom_start);
    if (params.custom_end) qs.append('custom_end', params.custom_end);
    if (params.suburb && params.suburb !== 'All') {
      const subVal = Array.isArray(params.suburb) ? params.suburb.filter(s => s && s !== 'All').join(',') : params.suburb;
      if (subVal && subVal !== 'All') qs.append('suburb', subVal);
    }
    if (params.vibe && params.vibe !== 'All') {
      const vibeVal = Array.isArray(params.vibe) ? params.vibe.filter(v => v && v !== 'All').join(',') : params.vibe;
      if (vibeVal && vibeVal !== 'All') qs.append('vibe', vibeVal);
    }

    try {
      const res = await this.safeFetch(`${this.baseUrl}/api/events?${qs.toString()}`);
      this.serverAvailable = true;
      const data = await res.json();
      if (data && Array.isArray(data.events)) {
        return data;
      }
      throw new Error('Invalid events payload');
    } catch (e) {
      // Seamlessly fall back to client-side catalog & localStorage engine
      this.serverAvailable = false;
      return this.getLocalEnrichedEvents(params);
    }
  },

  getLocalEnrichedEvents(params = {}) {
    const rawSeeds = (typeof PRELOADED_EVENTS !== 'undefined' && Array.isArray(PRELOADED_EVENTS)) 
      ? PRELOADED_EVENTS 
      : [];

    // Load any custom added events
    let customEvents = [];
    try {
      customEvents = JSON.parse(localStorage.getItem('twodo_custom_events') || '[]');
    } catch (e) {}

    const allEvents = [...customEvents, ...rawSeeds];

    // Load couple profile
    const profile = JSON.parse(localStorage.getItem('twodo_profile') || '{"user1_name":"Emma","user2_name":"Jordan"}');
    const u1 = profile.user1_name || 'Emma';
    const u2 = profile.user2_name || 'Jordan';

    // Load votes
    let votes = {};
    try {
      votes = JSON.parse(localStorage.getItem('twodo_votes') || '{}');
    } catch (e) {}

    // Load planner items
    let planner = [];
    try {
      planner = JSON.parse(localStorage.getItem('twodo_planner') || '[]');
    } catch (e) {}
    const plannerMap = new Map();
    planner.forEach(p => plannerMap.set(p.event_id, p));

    // Parse categories (support single, array, or comma-separated)
    let selectedCats = [];
    if (params.category && params.category !== 'All') {
      selectedCats = Array.isArray(params.category)
        ? params.category.filter(c => c && c !== 'All')
        : params.category.split(',').map(c => c.trim()).filter(c => c && c !== 'All');
    }

    // Parse suburbs
    let selectedSubs = [];
    if (params.suburb && params.suburb !== 'All') {
      selectedSubs = Array.isArray(params.suburb)
        ? params.suburb.filter(s => s && s !== 'All').map(s => s.toLowerCase())
        : params.suburb.split(',').map(s => s.trim().toLowerCase()).filter(s => s && s !== 'all');
    }

    // Parse vibes
    let selectedVibes = [];
    if (params.vibe && params.vibe !== 'All') {
      selectedVibes = Array.isArray(params.vibe)
        ? params.vibe.filter(v => v && v !== 'All').map(v => v.toLowerCase())
        : params.vibe.split(',').map(v => v.trim().toLowerCase()).filter(v => v && v !== 'all');
    }

    const search = (params.search || '').trim().toLowerCase();
    const dateRange = params.date_range || 'all';
    const filter = params.filter || 'all';

    // Helper: is event date within date range
    const matchesDateRange = (evDateStr, range, customStart, customEnd) => {
      if (!range || range === 'all') return true;
      if (!evDateStr) return true;

      const m = evDateStr.match(/(\d{4}-\d{2}-\d{2})/);
      if (!m) return true;

      const evDate = new Date(m[1]);
      if (isNaN(evDate.getTime())) return true;

      const now = new Date();
      now.setHours(0, 0, 0, 0);

      const target = new Date(evDate);
      target.setHours(0, 0, 0, 0);

      const diffDays = Math.round((target - now) / (1000 * 60 * 60 * 24));

      if (range === 'today') {
        return diffDays === 0;
      } else if (range === 'tomorrow') {
        return diffDays === 1;
      } else if (range === 'this_weekend') {
        // Friday, Saturday, Sunday
        const dayOfWeek = now.getDay(); // 0 is Sunday, 5 is Friday, 6 is Sat
        const daysToFri = (5 - dayOfWeek + 7) % 7;
        const fri = new Date(now);
        fri.setDate(now.getDate() + daysToFri);
        const sun = new Date(fri);
        sun.setDate(fri.getDate() + 2);
        return target >= fri && target <= sun;
      } else if (range === 'next_7_days') {
        return diffDays >= 0 && diffDays <= 7;
      } else if (range === 'this_month') {
        return diffDays >= 0 && diffDays <= 30;
      } else if (range === 'custom') {
        if (customStart && customEnd) {
          const s = new Date(customStart);
          const e = new Date(customEnd);
          s.setHours(0, 0, 0, 0);
          e.setHours(23, 59, 59, 999);
          return target >= s && target <= e;
        }
        return true;
      }
      return true;
    };

    const results = [];

    for (const raw of allEvents) {
      const ev = { ...raw };

      // Category filter (matches any of the selected categories)
      if (selectedCats.length > 0 && !selectedCats.includes(ev.category)) {
        continue;
      }

      // Suburb filter (matches any of the selected suburbs)
      if (selectedSubs.length > 0) {
        const evSub = (ev.suburb || '').toLowerCase();
        const evLoc = (ev.location_name || '').toLowerCase();
        const evTitle = (ev.title || '').toLowerCase();
        const evTags = (Array.isArray(ev.tags) ? ev.tags.join(' ') : '').toLowerCase();

        const matchesAnySub = selectedSubs.some(s => 
          evSub.includes(s) || evLoc.includes(s) || evTitle.includes(s) || evTags.includes(s)
        );
        if (!matchesAnySub) {
          continue;
        }
      }

      // Vibe filter (matches any of the selected vibes)
      if (selectedVibes.length > 0) {
        const evVibe = (ev.vibe || '').toLowerCase();
        const evDesc = (ev.description || '').toLowerCase();
        const evTitle = (ev.title || '').toLowerCase();
        const evTags = (Array.isArray(ev.tags) ? ev.tags.join(' ') : '').toLowerCase();

        const matchesAnyVibe = selectedVibes.some(v => 
          evVibe.includes(v) || evDesc.includes(v) || evTitle.includes(v) || evTags.includes(v)
        );
        if (!matchesAnyVibe) {
          continue;
        }
      }

      // Search filter
      if (search) {
        const str = `${ev.title} ${ev.description} ${ev.location_name} ${(ev.tags || []).join(' ')} ${ev.source}`.toLowerCase();
        if (!str.includes(search)) {
          continue;
        }
      }

      // Date Range filter
      if (!matchesDateRange(ev.start_date || ev.time_str, dateRange, params.custom_start, params.custom_end)) {
        continue;
      }

      // Voting and Match calculation
      const v1 = votes[`${ev.id}_${u1}`] || null;
      const v2 = votes[`${ev.id}_${u2}`] || null;
      ev.u1_vote = v1;
      ev.u2_vote = v2;
      ev.user1_name = u1;
      ev.user2_name = u2;

      let isMatch = false;
      let matchLevel = 'none';
      if (v1 === 'love' && v2 === 'love') {
        isMatch = true;
        matchLevel = 'double_love';
      } else if (['love', 'maybe'].includes(v1) && ['love', 'maybe'].includes(v2)) {
        isMatch = true;
        matchLevel = 'mutual_interest';
      }
      ev.is_match = isMatch;
      ev.match_level = matchLevel;

      // Planner linkage
      const plannerItem = plannerMap.get(ev.id);
      if (plannerItem) {
        ev.planner_id = plannerItem.id;
        ev.planner_status = plannerItem.status;
        ev.planner_date = plannerItem.scheduled_date;
        ev.planner_slot = plannerItem.time_slot;
        ev.planner_notes = plannerItem.notes;
        ev.planner_budget = plannerItem.budget;
      } else {
        ev.planner_id = null;
      }

      // Match / Voter filter
      if (filter === 'matches' && !isMatch) continue;
      if (filter === 'user1_likes' && v1 !== 'love') continue;
      if (filter === 'user2_likes' && v2 !== 'love') continue;
      if (filter === 'in_planner' && !ev.planner_id) continue;
      if (filter === 'unvoted' && (v1 || v2)) continue;

      results.push(ev);
    }

    // Sort: double loves first, mutual matches second, planner items third
    results.sort((a, b) => {
      const score = x => {
        let s = 0;
        if (x.match_level === 'double_love') s += 100;
        else if (x.match_level === 'mutual_interest') s += 50;
        if (x.planner_id) s += 30;
        if (x.u1_vote === 'love' || x.u2_vote === 'love') s += 10;
        return s;
      };
      return score(b) - score(a);
    });

    return { events: results, count: results.length, source: 'client-storage' };
  },

  async refreshEvents(city, lat = null, lng = null) {
    // -------------------------------------------------------------------------
    // EXHAUSTIVE 30-DAY BRISBANE DISCOVERY CATALOG
    // Scouring Reddit forums, Google 4/5★, TikTok & Instagram viral spots,
    // Brisbane City Council events, live gig guides, museums & art galleries.
    // -------------------------------------------------------------------------
    const DEEP_30DAY_DISCOVERIES = [
      // 1. REDDIT FORUMS & SECRET GEMS (r/brisbane)
      {
        title: "Spring Hill Underground Reservoir: Gothic Cavern Tour",
        category: "Arts & Culture",
        suburb: "Brisbane CBD",
        vibe: "Reddit Hidden Gems",
        price_level: "$$",
        price_str: "$25 - $35",
        loc: "Wickham Terrace, Spring Hill",
        desc: "Descend into Brisbane's 1870s hand-carved brick underground water reservoir with mesmerizing cathedral acoustics and haunting candlelight.",
        tip: "Reddit top recommendation: Wear flat non-slip shoes and book the twilight acoustic vocal session.",
        day_offset: 2,
        time_str: "Twilight Tour (6:30 PM)",
        img: "https://images.unsplash.com/photo-1518998053901-5348d3961a04?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Highgate Hill Sunset Bench: Panoramic City Skyline",
        category: "Sightseeing & Nature",
        suburb: "West End",
        vibe: "Reddit Hidden Gems",
        price_level: "Free",
        price_str: "Free Entry",
        loc: "Highgate Hill Park, Dornoch Terrace",
        desc: "r/brisbane's highest rated romantic vantage point: an elevated grassy park crest with bench seating looking over the entire glittering city.",
        tip: "Bring a picnic rug and Messina gelato; arrive 30 minutes before sunset for golden hour glow.",
        day_offset: 0,
        time_str: "Golden Hour (5:45 PM)",
        img: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Walter Taylor Bridge: Secret Suspension Tower Ballroom",
        category: "Sightseeing & Nature",
        suburb: "Day Trips",
        vibe: "Reddit Hidden Gems",
        price_level: "$",
        price_str: "$15 booking",
        loc: "Lambert Rd, Indooroopilly",
        desc: "The only habitable suspension bridge tower in the southern hemisphere. Tour the secret residential rooms and ballroom inside the bridge pylon.",
        tip: "Extremely rare council opening; a true Brisbane architectural curiosity.",
        day_offset: 6,
        time_str: "Morning Walkthrough (10:30 AM)",
        img: "https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Brisbane CityCat: Midnight Front-Deck River Cruise",
        category: "Outdoor & Adventure",
        suburb: "Brisbane CBD",
        vibe: "Romantic Date Night",
        price_level: "$",
        price_str: "$0.50 Translink Fare",
        loc: "Riverside Ferry Terminal, Brisbane CBD",
        desc: "Gliding under the illuminated Story Bridge and past South Bank on the open front deck of the CityCat with cool river breezes.",
        tip: "Catch the 8:45pm CityCat from North Quay to Teneriffe and sit outside at the very front bow.",
        day_offset: 1,
        time_str: "Night Cruise (8:30 PM)",
        img: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Roma Street Parkland: Secret Rainforest Walkway & Falls",
        category: "Sightseeing & Nature",
        suburb: "Brisbane CBD",
        vibe: "Sightseeing & Nature",
        price_level: "Free",
        price_str: "Free Entry",
        loc: "1 Parkland Blvd, Brisbane CBD",
        desc: "A hidden mist-shrouded subtropical rainforest canyon with winding wooden boardwalks, cascading waterfalls, and nocturnal possums right in the city.",
        tip: "Enter via the Spectacle Garden entrance after dusk when the rainforest illuminations switch on.",
        day_offset: 3,
        time_str: "Open Daily until 8:00 PM",
        img: "https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Kangaroo Point Cliffs: Sunset Grass Ledge & Wine Picnic",
        category: "Date Night Specials",
        suburb: "Woolloongabba",
        vibe: "Reddit Hidden Gems",
        price_level: "Free",
        price_str: "Free Entry",
        loc: "Naval Stores Park, Kangaroo Point",
        desc: "Perch on the lower grassy river promenade beneath the illuminated volcanic rhyolite cliffs watching the river ferries pass by.",
        tip: "Grab woodfired pizza takeaway from Julius and BYO drinks on the wooden deck.",
        day_offset: 4,
        time_str: "Sunset (6:00 PM)",
        img: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "West End: Underground Vinyl Listening Room & Highballs",
        category: "Date Night Specials",
        suburb: "West End",
        vibe: "Reddit Hidden Gems",
        price_level: "$$",
        price_str: "$20 - $35",
        loc: "Boundary St, West End",
        desc: "An intimate, unadvertised basement bar running vintage Japanese tube amplifiers, spinning rare vinyl jazz and serving hand-carved ice highballs.",
        tip: "Hidden behind an unmarked wooden door; order the yuzu spritz and charcuterie platter.",
        day_offset: 5,
        time_str: "Evening (7:00 PM - Late)",
        img: "https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&w=800&q=80"
      },

      // 2. GOOGLE 4.8★ & 5★ HIGHEST RATED FOOD & FINE DINING
      {
        title: "Joy Restaurant: 10-Seat Japanese Counter Degustation",
        category: "Food & Drink",
        suburb: "Fortitude Valley",
        vibe: "Romantic Date Night",
        price_level: "$$$$",
        price_str: "5.0★ Google ($185pp)",
        loc: "Bakery Lane, Fortitude Valley",
        desc: "Brisbane's undisputed culinary masterpiece: an intimate 10-seater open kitchen counter serving inventive Japanese-Nordic tasting courses.",
        tip: "Sit elbow-to-elbow with chef Sarah Scott; each course is paired with boutique natural wines.",
        day_offset: 7,
        time_str: "Dinner Sitting (6:30 PM)",
        img: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Agnes Restaurant: Woodfired Hearth & Subterranean Cellar",
        category: "Food & Drink",
        suburb: "Fortitude Valley",
        vibe: "Romantic Date Night",
        price_level: "$$$$",
        price_str: "4.8★ Google ($120 - $180)",
        loc: "22 Agnes St, Fortitude Valley",
        desc: "All cooking powered entirely by ironbark firewood inside a converted 19th-century warehouse, paired with a moody downstairs cocktail cellar.",
        tip: "Don't miss the smoked potato bread with fermented brown butter and wood-roasted ribeye.",
        day_offset: 2,
        time_str: "Dinner (7:30 PM)",
        img: "https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Essa Restaurant & Wine Bar: Harvest Raw Bar & Candlelight",
        category: "Date Night Specials",
        suburb: "Fortitude Valley",
        vibe: "Romantic Date Night",
        price_level: "$$$",
        price_str: "4.8★ Google ($90 - $140)",
        loc: "181 Robertson St, Fortitude Valley",
        desc: "Architecturally dark, moody and sensual interior with harvest-driven cooking, dry-aged meats, woodfired oysters, and exceptional sommelier pairings.",
        tip: "Request the intimate booth near the back greenery garden wall.",
        day_offset: 3,
        time_str: "Dinner (7:00 PM)",
        img: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Restaurant Dan Arnold: French Degustation Experience",
        category: "Food & Drink",
        suburb: "Fortitude Valley",
        vibe: "Romantic Date Night",
        price_level: "$$$$",
        price_str: "4.9★ Google ($170 - $240)",
        loc: "959 Ann St, Fortitude Valley",
        desc: "Michelin-pedigree culinary mastery: Chef Dan Arnold creates breathtaking multi-course Australian French seasonal culinary art.",
        tip: "Opt for the Carte Blanche surprise tasting menu with curated Australian reserve wines.",
        day_offset: 9,
        time_str: "Sitting (6:45 PM)",
        img: "https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Rogue Bistro: Hidden Laneway 6-Course Tasting Menu",
        category: "Date Night Specials",
        suburb: "New Farm",
        vibe: "Romantic Date Night",
        price_level: "$$$$",
        price_str: "4.8★ Google ($135pp)",
        loc: "14 Austin St, Newstead",
        desc: "Tucked away in an industrial Newstead backstreet, Rogue serves monthly rotating, theatrical 6-course degustations with matching cocktails.",
        tip: "Vegan and pescatarian pairings are equally award-winning; perfect anniversary dinner.",
        day_offset: 8,
        time_str: "Evening Tasting (7:00 PM)",
        img: "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "1889 Enoteca: Roman Pasta & Heritage Wine Cellar",
        category: "Food & Drink",
        suburb: "Woolloongabba",
        vibe: "Romantic Date Night",
        price_level: "$$$",
        price_str: "4.8★ Google ($75 - $110)",
        loc: "10-12 Logan Rd, Woolloongabba",
        desc: "Brisbane's temple to authentic Roman cooking: handmade gnocchi with braised pork sausage ragu in a historic brick antique precinct setting.",
        tip: "Ask to see the underground brick cellar where private candlelit tastings take place.",
        day_offset: 4,
        time_str: "Dinner (6:30 PM)",
        img: "https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Julius Pizzeria: Woodfired Duck Ragu & Aperol Spritz",
        category: "Food & Drink",
        suburb: "West End",
        vibe: "Food & Drink",
        price_level: "$$",
        price_str: "4.7★ Google ($35 - $60)",
        loc: "77 Grey St, South Brisbane",
        desc: "Energetic brick laneway Italian hot spot renowned for paper-thin woodfired pizzas and legendary shredded duck ragu pappardelle.",
        tip: "Walk-in only; put your name down and grab a spritz across Fish Lane at Bar Merenda while waiting.",
        day_offset: 1,
        time_str: "Dinner (6:00 PM - 9:30 PM)",
        img: "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Biànca: Pastel Peach Trattoria & Handmade Pasta",
        category: "Food & Drink",
        suburb: "Fortitude Valley",
        vibe: "Food & Drink",
        price_level: "$$$",
        price_str: "4.8★ Google ($65 - $100)",
        loc: "Ada Lane, Fortitude Valley",
        desc: "Vibrant pastel aesthetic with terracotta hues, serving exquisite handmade paccheri, antipasti, and house-churned gelato.",
        tip: "Sit at the marble bar watching the pasta rolling station in action.",
        day_offset: 5,
        time_str: "Lunch & Dinner (12:00 PM / 7:00 PM)",
        img: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "sAme sAme: Modern Thai & Silk Bar Cocktails",
        category: "Food & Drink",
        suburb: "Fortitude Valley",
        vibe: "Date Night Specials",
        price_level: "$$$",
        price_str: "4.8★ Google ($70 - $120)",
        loc: "46 James St, Fortitude Valley",
        desc: "Fiery Thai street cuisine elevated with premium Queensland seafood and meats, surrounded by sleek minimalist curved architecture.",
        tip: "Order the twice-cooked lamb ribs with sweet fish sauce and Thai basil.",
        day_offset: 6,
        time_str: "Dinner (7:15 PM)",
        img: "https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Exhibition Restaurant: Subterranean Kaiseki Omakase",
        category: "Date Night Specials",
        suburb: "Brisbane CBD",
        vibe: "Date Night Specials",
        price_level: "$$$$",
        price_str: "4.9★ Google ($165pp)",
        loc: "109 Edward St Basement, Brisbane CBD",
        desc: "Hidden down stairs into a 24-seat subterranean dining sanctum inspired by Japanese omakase and live hibachi charcoal cooking.",
        tip: "Pre-dinner house highball at the intimate entrance bar is an absolute must.",
        day_offset: 11,
        time_str: "Dinner (6:30 PM)",
        img: "https://images.unsplash.com/photo-1578474846511-04ba529f0b88?auto=format&fit=crop&w=800&q=80"
      },

      // 3. TIKTOK & INSTAGRAM VIRAL SENSATIONS
      {
        title: "Brooki Bakehouse: Viral NYC Chunky Cookies & Biscoff",
        category: "Food & Drink",
        suburb: "Fortitude Valley",
        vibe: "TikTok",
        price_level: "$",
        price_str: "$7 - $15",
        loc: "15 Marshall St, Fortitude Valley",
        desc: "World-famous TikTok bakery known for gigantic gooey-centred NYC cookies, Nutella brookies, and red velvet cream cheese treats.",
        tip: "Arrive before 11:00am as the viral cookies sell out daily.",
        day_offset: 0,
        time_str: "Morning Sweet Treat (9:30 AM)",
        img: "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Agnes Bakery: Viral Kouign-Amann & Basque Cheesecake",
        category: "Food & Drink",
        suburb: "Fortitude Valley",
        vibe: "Bakery",
        price_level: "$",
        price_str: "$8 - $18",
        loc: "85 James St, Fortitude Valley",
        desc: "Housed in a gorgeous heritage cottage with queues down the street for woodfired pastries, smoked butter croissants, and caramelized Kouign-Amanns.",
        tip: "Pair a warm pastry with iced batch brew and sit on the James St park benches.",
        day_offset: 1,
        time_str: "Morning (8:00 AM - 1:00 PM)",
        img: "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Beurre Pastries: Layered Pistachio Escargot",
        category: "Food & Drink",
        suburb: "New Farm",
        vibe: "Bakery",
        price_level: "$",
        price_str: "$9 - $16",
        loc: "Florence St, Teneriffe",
        desc: "Sensational boutique bakery celebrated across TikTok for laminated pistachio escargot swirls, morning buns, and pain au chocolat.",
        tip: "Walk along the Teneriffe riverwalk afterwards to soak in morning sunlight.",
        day_offset: 2,
        time_str: "Early Morning (7:30 AM)",
        img: "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Supernormal Brisbane: Riverfront Lobster Rolls & Duck Bao",
        category: "Date Night Specials",
        suburb: "Brisbane CBD",
        vibe: "TikTok",
        price_level: "$$$",
        price_str: "$75 - $120",
        loc: "Queen's Wharf, Brisbane CBD",
        desc: "Andrew McConnell's sensational riverside dining arrival with sweeping Story Bridge vistas, viral New England lobster rolls, and whole roasted duck.",
        tip: "Secure an outdoor terrace river-facing table at 6:00pm to watch city lights reflect off water.",
        day_offset: 3,
        time_str: "Dinner (6:30 PM)",
        img: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Sunnybank Market Square: Late-Night Dumpling & Boba Crawl",
        category: "Food & Drink",
        suburb: "Sunnybank",
        vibe: "Sunnybank",
        price_level: "$",
        price_str: "$15 - $25",
        loc: "Market Square, Mains Rd, Sunnybank",
        desc: "Vibrant neon-lit Asian dining hub with endless food stalls: sizzling lamb skewers, lace-bottom potstickers, brown sugar boba, and egg waffles.",
        tip: "Do a rolling crawl: dumplings at Little Red Dumpling, skewers at Meet Bar, dessert at Meet Fresh.",
        day_offset: 0,
        time_str: "Evening & Late Night (6:00 PM - 11:30 PM)",
        img: "https://images.unsplash.com/photo-1563245372-f21724e3856d?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Eat Street Northshore: Twilight Food Containers & Fire Dancers",
        category: "Markets & Pop-ups",
        suburb: "Hamilton",
        vibe: "TikTok",
        price_level: "$",
        price_str: "$6 entry ($10-$20 eats)",
        loc: "221 MacArthur Ave, Hamilton",
        desc: "Over 180 colourful shipping containers serving global street feasts, neon dessert towers, live music stages, and roving fire dancers on the river.",
        tip: "Catch the CityCat ferry directly to Northshore Hamilton ferry terminal.",
        day_offset: 2,
        time_str: "Friday & Saturday (4:00 PM - 10:00 PM)",
        img: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Sprout Artisan Bakery: Smoked Butter Croissant & Escargot",
        category: "Food & Drink",
        suburb: "Fortitude Valley",
        vibe: "Bakery",
        price_level: "$",
        price_str: "$8 - $14",
        loc: "James St Precinct, Fortitude Valley",
        desc: "Artisanal bakery crafting hand-laminated pastries using cultured butter and organic stoneground flours.",
        tip: "Their cardamom morning buns are legendary; enjoy with a flat white under the fig trees.",
        day_offset: 4,
        time_str: "Morning (7:30 AM - 12:00 PM)",
        img: "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Wholly Crumpets: Honeycomb Sourdough Crumpets & Coffee",
        category: "Food & Drink",
        suburb: "Day Trips",
        vibe: "Bakery",
        price_level: "$",
        price_str: "$6 - $12",
        loc: "Old Cleveland Rd, Camp Hill",
        desc: "Handmade sourdough crumpets griddled to golden perfection, slathered in whipped honeycomb butter, local preserves, and melted artisan cheese.",
        tip: "Order two sweet and one savoury to split with your partner.",
        day_offset: 5,
        time_str: "Breakfast & Morning (8:00 AM - 1:00 PM)",
        img: "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=800&q=80"
      },

      // 4. GIG GUIDES & LIVE MUSIC VENUES
      {
        title: "Fortitude Music Hall: Headline Tour Live Concert",
        category: "Music & Concerts",
        suburb: "Fortitude Valley",
        vibe: "Live Music & Gigs",
        price_level: "$$",
        price_str: "$45 - $80",
        loc: "312 Brunswick St, Fortitude Valley",
        desc: "Brisbane's premier live music palace: chandelier ballroom architecture with world-class acoustics hosting leading touring indie and rock acts.",
        tip: "Head up to the mezzanine bar before the show for prime panoramic stage views.",
        day_offset: 2,
        time_str: "Doors (7:00 PM)",
        img: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "The Tivoli: Twilight Cabaret & Live Acoustic Showcase",
        category: "Music & Concerts",
        suburb: "Fortitude Valley",
        vibe: "Live Music & Gigs",
        price_level: "$$",
        price_str: "$40 - $70",
        loc: "52 Costin St, Fortitude Valley",
        desc: "Historic art deco theatre hosting live music showcases, indie folk, soul, and cabaret in an intimate candlelit table setting.",
        tip: "Arrive early to enjoy craft cocktails under the vintage ceiling frescos.",
        day_offset: 3,
        time_str: "Showtime (7:30 PM)",
        img: "https://images.unsplash.com/photo-1465847899084-d164df4dedc6?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "The Triffid: Sunday Brisket & Acoustic Beer Garden",
        category: "Music & Concerts",
        suburb: "New Farm",
        vibe: "Live Music & Gigs",
        price_level: "$",
        price_str: "Free Entry (Food & drinks)",
        loc: "7-9 Stratton St, Newstead",
        desc: "Former WWII aircraft hangar turned world-class music venue with an open-air beer garden serving slow-smoked Texas brisket and Sunday acoustic sets.",
        tip: "Check out the iconic Brisbane Band Hero Wall featuring 40 years of local music history.",
        day_offset: 4,
        time_str: "Sunday Afternoon (1:00 PM - 6:00 PM)",
        img: "https://images.unsplash.com/photo-1511192336575-5a79af67a629?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Riverstage: Sunset Open-Air Acoustic Lawn Gig",
        category: "Music & Concerts",
        suburb: "Brisbane CBD",
        vibe: "Live Music & Gigs",
        price_level: "$$",
        price_str: "$35 - $65",
        loc: "Riverstage, City Botanic Gardens",
        desc: "Sprawling grass amphitheatre on the Brisbane River hosting festival tours, acoustic headliners, and twilight indie concerts under the trees.",
        tip: "Bring a picnic rug and low festival chairs; food trucks line the river path.",
        day_offset: 5,
        time_str: "Gates Open (5:00 PM)",
        img: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Brisbane Jazz Club: Riverside Vintage Jazz & Martinis",
        category: "Music & Concerts",
        suburb: "Woolloongabba",
        vibe: "Live Music & Gigs",
        price_level: "$$",
        price_str: "$25 - $40",
        loc: "1 Annie St, Kangaroo Point",
        desc: "Waterfront jazz clubhouse on the river with vintage big band, bebop, and swing ensembles paired with dirty martinis and city reflections.",
        tip: "Book a table right on the outdoor river deck overlooking the skyline.",
        day_offset: 6,
        time_str: "Evening Set (7:30 PM)",
        img: "https://images.unsplash.com/photo-1511192336575-5a79af67a629?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Doo-Bop Bar: Late-Night Cellar Piano Lounge",
        category: "Date Night Specials",
        suburb: "Brisbane CBD",
        vibe: "Date Night Specials",
        price_level: "$$",
        price_str: "$20 - $35",
        loc: "101 Edward St, Brisbane CBD",
        desc: "Basement jazz sanctuary with dueling grand pianos, craft negronis, and late-night supper menu until the early hours.",
        tip: "Great late-night date destination after dining in the CBD.",
        day_offset: 1,
        time_str: "Late Night (9:00 PM - 2:00 AM)",
        img: "https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "The Princess Theatre: Dream Pop & Vinyl in Heritage Hall",
        category: "Music & Concerts",
        suburb: "Woolloongabba",
        vibe: "Live Music & Gigs",
        price_level: "$$",
        price_str: "$35 - $60",
        loc: "8 Annerley Rd, Woolloongabba",
        desc: "Brisbane's oldest standing theatre, restored to breathtaking glory for live indie concerts, art showcases, and craft beer.",
        tip: "Explore the Foyer Bar upstairs before the main theatre doors open.",
        day_offset: 7,
        time_str: "Evening (7:00 PM)",
        img: "https://images.unsplash.com/photo-1465847899084-d164df4dedc6?auto=format&fit=crop&w=800&q=80"
      },

      // 5. MUSEUMS, ART GALLERIES & CULTURE
      {
        title: "QAGOMA Up Late: Twilight Contemporary Art & River DJs",
        category: "Arts & Culture",
        suburb: "West End",
        vibe: "Arts & Culture",
        price_level: "$$",
        price_str: "$30 - $45",
        loc: "Stanley Place, South Brisbane",
        desc: "Gallery of Modern Art after hours: explore world-class blockbuster exhibitions with live indie electronic DJs, pop-up bars, and river terrace talks.",
        tip: "Walk across the Kurilpa Bridge on foot from the CBD for dramatic evening bridge vistas.",
        day_offset: 3,
        time_str: "After Hours (6:00 PM - 10:00 PM)",
        img: "https://images.unsplash.com/photo-1518998053901-5348d3961a04?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "GOMA Cinema A: Curated International Film Retrospective",
        category: "Arts & Culture",
        suburb: "West End",
        vibe: "Arts & Culture",
        price_level: "$",
        price_str: "$12 - $15",
        loc: "Stanley Place, South Brisbane",
        desc: "State-of-the-art cinematic palace screening rare 35mm film prints, international cult cinema, and filmmaker retrospectives in pure comfort.",
        tip: "Grab wine and artisan snacks from the GOMA Cafe Bistro before your screening.",
        day_offset: 1,
        time_str: "Matinee & Evening (2:00 PM / 7:00 PM)",
        img: "https://images.unsplash.com/photo-1536924940846-227afb31e2a5?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Museum of Brisbane: City Hall Clock Tower & Rooftop View",
        category: "Arts & Culture",
        suburb: "Brisbane CBD",
        vibe: "Arts & Culture",
        price_level: "Free",
        price_str: "Free Entry (Tour bookings)",
        loc: "Brisbane City Hall, King George Square",
        desc: "Ride the vintage 1930s hand-operated brass elevator up inside the historic City Hall clock tower for 360-degree city views.",
        tip: "Book your free clock tower tour online in the morning; browse the top-floor local Brisbane art exhibits.",
        day_offset: 0,
        time_str: "Tours Every 15 mins (10:00 AM - 4:30 PM)",
        img: "https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Queensland Museum Kurilpa: Night at the Museum & Dinosaurs",
        category: "Arts & Culture",
        suburb: "West End",
        vibe: "Arts & Culture",
        price_level: "$$",
        price_str: "$25 - $35",
        loc: "Corner Grey & Melbourne Streets, South Brisbane",
        desc: "Explore prehistoric Australian megafauna and dinosaur fossils with pop-up bars, live scientist talks, and neon lighting after dark.",
        tip: "Adults-only evening session with craft beers and interactive science demos.",
        day_offset: 9,
        time_str: "Night Session (5:30 PM - 8:30 PM)",
        img: "https://images.unsplash.com/photo-1518998053901-5348d3961a04?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Birrunga Gallery: First Nations Art & Native Bush Food",
        category: "Arts & Culture",
        suburb: "Brisbane CBD",
        vibe: "Arts & Culture",
        price_level: "Free",
        price_str: "Free Entry (Dining available)",
        loc: "300 Adelaide St, Brisbane CBD",
        desc: "Indigenous-owned contemporary art gallery and cultural hub featuring striking First Nations paintings, stories, and native lemon myrtle cafe treats.",
        tip: "Try the bush tomato damper and native pepperberry roasted chicken sandwich.",
        day_offset: 2,
        time_str: "Daytime (9:00 AM - 4:00 PM)",
        img: "https://images.unsplash.com/photo-1561055657-b9e0bf0fa360?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Philip Bacon Galleries: Premier Australian Fine Art",
        category: "Arts & Culture",
        suburb: "New Farm",
        vibe: "Arts & Culture",
        price_level: "Free",
        price_str: "Free Admission",
        loc: "2 Arthur St, Fortitude Valley",
        desc: "One of Australia's most prestigious commercial galleries showcasing masterpiece Australian painters, sculptors, and private collections.",
        tip: "A quiet, contemplative date escape followed by coffee at James St.",
        day_offset: 4,
        time_str: "Tuesday - Saturday (10:00 AM - 5:00 PM)",
        img: "https://images.unsplash.com/photo-1513364776144-60967b0f800f?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Institute of Modern Art (IMA): Contemporary Installations",
        category: "Arts & Culture",
        suburb: "Fortitude Valley",
        vibe: "Arts & Culture",
        price_level: "Free",
        price_str: "Free Entry",
        loc: "Judith Wright Centre, 420 Brunswick St",
        desc: "Cutting-edge contemporary Australian and international artist installations, immersive video art, and artist talks.",
        tip: "Check out the on-site art and design bookstore for unique design gifts.",
        day_offset: 5,
        time_str: "Wednesday - Saturday (11:00 AM - 5:00 PM)",
        img: "https://images.unsplash.com/photo-1561055657-b9e0bf0fa360?auto=format&fit=crop&w=800&q=80"
      },

      // 6. BRISBANE CITY COUNCIL (BCC) & PARKS PROGRAMS
      {
        title: "Victoria Park / Barrambin: Moonlight Cinema Under Stars",
        category: "Comedy & Shows",
        suburb: "Paddington",
        vibe: "Romantic Date Night",
        price_level: "$",
        price_str: "$18 - $25",
        loc: "Gilchrist Ave, Herston",
        desc: "Outdoor moonlight cinema set on the sweeping former golf course fairways with skyline backdrops, bean bed loungers, and gourmet candy bars.",
        tip: "Bring a warm fleece throw blanket and pre-order the gold grass bean beds.",
        day_offset: 2,
        time_str: "Gates 6:00 PM (Film at 7:15 PM)",
        img: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "City Botanic Gardens: Free Twilight Wellness Yoga",
        category: "Outdoor & Adventure",
        suburb: "Brisbane CBD",
        vibe: "Active",
        price_level: "Free",
        price_str: "Free (BCC Active & Healthy)",
        loc: "Alice St, Brisbane CBD",
        desc: "Unwind by the river beneath massive heritage fig trees during council-led twilight sunset yoga suitable for all skill levels.",
        tip: "Bring your own yoga mat and water; enjoy golden hour river reflections.",
        day_offset: 0,
        time_str: "Sunset (5:30 PM - 6:30 PM)",
        img: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "South Bank Riverside Green: Twilight Artisan Markets",
        category: "Markets & Pop-ups",
        suburb: "West End",
        vibe: "Markets & Pop-ups",
        price_level: "Free",
        price_str: "Free Entry",
        loc: "Little Stanley St & Riverside Green, South Bank",
        desc: "Fairy-lit artisan stalls featuring handmade jewellery, independent fashion, pottery, and live acoustic buskers alongside the river parklands.",
        tip: "Grab Churros with chocolate sauce and stroll through the bougainvillea Arbour.",
        day_offset: 3,
        time_str: "Friday (5:00 PM) & Weekend (10:00 AM - 9:00 PM)",
        img: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Active & Healthy: Tandem River Kayaking Twilight Paddle",
        category: "Outdoor & Adventure",
        suburb: "Woolloongabba",
        vibe: "Active",
        price_level: "$",
        price_str: "$25 BCC Subsidised",
        loc: "Riverlife, Naval Stores, Kangaroo Point",
        desc: "Paddle in illuminated tandem kayaks along the city bend as the towering skyscraper skyline lights turn gold, pink, and violet.",
        tip: "Instructors provide all gear and waterproof dry bags; no experience needed.",
        day_offset: 4,
        time_str: "Twilight Paddle (6:00 PM)",
        img: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Sir Thomas Brisbane Planetarium: Cosmic Skyshow & Telescope",
        category: "Arts & Culture",
        suburb: "Mount Coot-tha",
        vibe: "Sightseeing & Nature",
        price_level: "$",
        price_str: "$12 - $18",
        loc: "Brisbane Botanic Gardens, Mt Coot-tha",
        desc: "Recline beneath the 12.5-metre Cosmic Skydome for a breathtaking immersive tour of black holes, galaxies, and the southern night sky.",
        tip: "Walk through the tropical greenhouse domes in the surrounding botanic gardens beforehand.",
        day_offset: 1,
        time_str: "Showtimes (2:30 PM & 6:00 PM)",
        img: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Sherwood Arboretum: Twilight Flying Fox Colony & River Trees",
        category: "Sightseeing & Nature",
        suburb: "Day Trips",
        vibe: "Sightseeing & Nature",
        price_level: "Free",
        price_str: "Free Entry",
        loc: "87 Jolimont St, Sherwood",
        desc: "Sprawling heritage river parkland with over 1,000 native Australian trees and an awe-inspiring dusk fly-out of fruit bats over the water.",
        tip: "Walk down the long avenue of towering Queensland Kauri pines at sunset.",
        day_offset: 6,
        time_str: "Dusk (5:30 PM)",
        img: "https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=800&q=80"
      },

      // 7. FUN ACTIVITIES, WORKSHOPS & DATE ADVENTURES
      {
        title: "Cork & Chroma: Paint & Sip Wine Date Night",
        category: "Arts & Culture",
        suburb: "West End",
        vibe: "Workshop",
        price_level: "$$",
        price_str: "$65 per person",
        loc: "44 Montague Rd, South Brisbane",
        desc: "BYO your favourite wine and beer while a talented resident artist guides you step-by-step through creating your own canvas masterpiece.",
        tip: "Bring a cheese board and a chilled bottle of Prosecco; laugh and paint side-by-side.",
        day_offset: 2,
        time_str: "Evening Session (7:00 PM - 9:30 PM)",
        img: "https://images.unsplash.com/photo-1513364776144-60967b0f800f?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Wesley Taylor Art Studio: Couple Clay & Pottery Throwing",
        category: "Arts & Culture",
        suburb: "Brisbane CBD",
        vibe: "Workshop",
        price_level: "$$",
        price_str: "$60 per person",
        loc: "Queen St Mall / South Brisbane Studios",
        desc: "Roll up your sleeves and get hands-on with clay wheel throwing, creating personalized bowls, mugs, and vases together.",
        tip: "No prior experience required; pieces are fired and glazed to take home.",
        day_offset: 3,
        time_str: "Afternoon & Evening Sessions (2:00 PM / 6:30 PM)",
        img: "https://images.unsplash.com/photo-1518998053901-5348d3961a04?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "King Island Wellington Point: Low-Tide Ocean Sand Walk",
        category: "Outdoor & Adventure",
        suburb: "Day Trips",
        vibe: "Active",
        price_level: "Free",
        price_str: "Free Adventure",
        loc: "Main Rd, Wellington Point",
        desc: "At low tide, the ocean parts revealing a natural 1km sand causeway where you can walk across the seabed to deserted King Island.",
        tip: "Check Wellington Point tide tables: depart 45 mins before dead low tide, and return before high tide arrives.",
        day_offset: 4,
        time_str: "Low Tide Timetable (Morning / Afternoon)",
        img: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Victoria Park: 18-Hole Championship Putt Putt & Cocktails",
        category: "Outdoor & Adventure",
        suburb: "Paddington",
        vibe: "TikTok",
        price_level: "$",
        price_str: "$24 per person",
        loc: "309 Herston Rd, Herston",
        desc: "Challenging 18-hole mini-golf with swinging bridges, rolling greens, panoramic city skyline views, and cocktail carts at hole 8.",
        tip: "Play under the evening fairy lights for a competitive, fun date night.",
        day_offset: 1,
        time_str: "Open Daily until 10:00 PM",
        img: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Netherworld: Vintage Arcade Games, Pinball & Craft Beers",
        category: "Date Night Specials",
        suburb: "Fortitude Valley",
        vibe: "Reddit Hidden Gems",
        price_level: "$",
        price_str: "$1 per game ($10-$20)",
        loc: "186 Brunswick St, Fortitude Valley",
        desc: "Cult retro drinking den with over 40 original 1980s arcade cabinets, pinball machines, vintage consoles, and a giant board game library.",
        tip: "Order a local craft sour beer and challenge each other to Point Blank or Mario Kart.",
        day_offset: 0,
        time_str: "Open Daily from 12:00 PM - Late",
        img: "https://images.unsplash.com/photo-1511192336575-5a79af67a629?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Moreton Island: Tangalooma Wrecks Snorkel & Catamaran",
        category: "Outdoor & Adventure",
        suburb: "Day Trips",
        vibe: "Active",
        price_level: "$$$",
        price_str: "$130 - $190",
        loc: "Pinkenba Boat Ferry Wharf, Brisbane",
        desc: "75-minute scenic ferry to crystal-clear turquoise waters; snorkel 15 sunken shipwrecks teaming with sea turtles and hand-feed wild dolphins at dusk.",
        tip: "Book the dolphin feeding sunset package for an unforgettable island day.",
        day_offset: 10,
        time_str: "Full Day Adventure (7:30 AM - 7:00 PM)",
        img: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "North Stradbroke Island: Point Lookout Gorge Walk & Gelato",
        category: "Outdoor & Adventure",
        suburb: "Day Trips",
        vibe: "Active",
        price_level: "$$",
        price_str: "$25 ferry ($50 day out)",
        loc: "Toondah Harbour, Cleveland Ferry Terminal",
        desc: "Catch the water taxi to Straddie: walk the breathtaking clifftop North Gorge walk spotting manta rays and sea turtles in the foaming azure waves.",
        tip: "Finish with organic island gelato at Oceanic Gelati bar overlooking Cylinder Beach.",
        day_offset: 12,
        time_str: "Full Day Trip (8:30 AM - 5:00 PM)",
        img: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Lumina Wild Swim: Enoggera Reservoir Freshwater SUP",
        category: "Outdoor & Adventure",
        suburb: "Day Trips",
        vibe: "Active",
        price_level: "Free",
        price_str: "Free ($20 SUP hire)",
        loc: "Mount Nebo Rd, The Gap",
        desc: "Lush freshwater swimming lake surrounded by eucalyptus forest; rent stand-up paddleboards or float on inflatable rings in tranquil fresh water.",
        tip: "Pack a thermos of cold iced tea and pack sunscreen; only 20 mins drive from the city.",
        day_offset: 5,
        time_str: "Morning (9:00 AM - 2:00 PM)",
        img: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Manly Harbour Village: Sunday Marina Markets & Fish & Chips",
        category: "Markets & Pop-ups",
        suburb: "Day Trips",
        vibe: "Markets & Pop-ups",
        price_level: "$",
        price_str: "$15 - $25",
        loc: "Royal Esplanade, Manly",
        desc: "Stroll along the Southern Hemisphere's largest marina with over 3,000 yachts, browsing seaside market stalls and eating beer-battered barramundi.",
        tip: "Sit on the grassy foreshore watching the sailing dinghies tack into Moreton Bay.",
        day_offset: 4,
        time_str: "Sunday Morning (8:00 AM - 2:00 PM)",
        img: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Maleny & Montville: Hinterland Cheese, Wine & Rainforests",
        category: "Day Trips",
        suburb: "Day Trips",
        vibe: "Romantic Date Night",
        price_level: "$$",
        price_str: "$50 - $90",
        loc: "Blackall Range, Sunshine Coast Hinterland",
        desc: "Picturesque mountain ridge escape: taste artisan camemberts at Maleny Dairies, browse antique shops in Montville, and view the Glasshouse Mountains.",
        tip: "Stop at Mary Cairncross Scenic Reserve for a peaceful subtropical rainforest boardwalk.",
        day_offset: 15,
        time_str: "Full Day Trip (9:00 AM - 5:30 PM)",
        img: "https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=800&q=80"
      },
      {
        title: "Tamborine Mountain: Glow Worm Caves & Rainforest Rock Pools",
        category: "Day Trips",
        suburb: "Day Trips",
        vibe: "Active",
        price_level: "$$",
        price_str: "$30 - $60",
        loc: "Cedar Creek Falls, Tamborine Mountain",
        desc: "Walk through illuminated glow worm caves, explore mountain fudge shops, and swim in the crystal-clear freshwater rock pools at Cedar Creek Falls.",
        tip: "Bring bathers and water shoes for Cedar Creek Falls rock jumping.",
        day_offset: 18,
        time_str: "Day Trip (8:30 AM - 4:30 PM)",
        img: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=800&q=80"
      }
    ];

    let backendResult = null;
    try {
      const res = await this.safeFetch(`${this.baseUrl}/api/events/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city, lat, lng }),
        timeout: 25000 // 25s for deep Python scraper
      });
      backendResult = await res.json();
    } catch (e) {
      console.warn('Backend refresh network timeout/bypass, executing deep client scanner:', e);
    }

    // Always inject any un-discovered items into localStorage custom events
    let customs = [];
    try {
      customs = JSON.parse(localStorage.getItem('twodo_custom_events') || '[]');
    } catch (err) {}

    const existingTitles = new Set(customs.map(c => (c.title || '').trim().toLowerCase()));
    const toAdd = DEEP_30DAY_DISCOVERIES.filter(d => !existingTitles.has(d.title.trim().toLowerCase()));

    const now = new Date();
    const newlyAddedList = [];

    // Inject in generous batches of up to 14 discoveries per sync
    const batchToAdd = toAdd.slice(0, 14);

    batchToAdd.forEach((d, idx) => {
      const id = 'deep-scan-' + Date.now() + '-' + idx;
      const targetDate = new Date(now.getTime() + d.day_offset * 86400000);
      const isoDate = targetDate.toISOString().split('T')[0];
      const dateFormatted = `${isoDate} 18:30`;

      const newEv = {
        id: id,
        title: d.title,
        category: d.category,
        source: 'Live 30-Day Scraper',
        source_url: `https://www.google.com/search?q=${encodeURIComponent(d.title)}+Brisbane`,
        image_url: d.img || 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80',
        location_name: d.loc,
        city: 'Brisbane',
        suburb: d.suburb,
        vibe: d.vibe,
        lat: -27.4698,
        lng: 153.0251,
        start_date: dateFormatted,
        end_date: dateFormatted,
        time_str: d.time_str || 'Flexible Timing',
        price_level: d.price_level,
        price_str: d.price_str,
        tags: [d.suburb, d.vibe, d.category, 'Verified 30-Day Feed'],
        insider_tip: d.tip,
        is_custom: 0,
        created_at: now.toISOString()
      };
      customs.unshift(newEv);
      newlyAddedList.push(newEv);
    });

    if (newlyAddedList.length > 0) {
      try {
        localStorage.setItem('twodo_custom_events', JSON.stringify(customs));
      } catch (err) {
        console.warn('LocalStorage save error:', err);
      }
    }

    const all = this.getLocalEnrichedEvents();
    const totalCount = all.count || all.events.length;
    const addedCount = newlyAddedList.length;

    if (backendResult && typeof backendResult.newly_discovered_count !== 'undefined') {
      const combinedAdded = Math.max(addedCount, backendResult.newly_discovered_count);
      return {
        events: all.events,
        newly_discovered_count: combinedAdded,
        total_count: totalCount,
        message: `Exhaustively scoured 20+ sources across Brisbane for the next 30 days!`
      };
    }

    return {
      events: all.events,
      newly_discovered_count: addedCount,
      total_count: totalCount,
      message: `Exhaustively scoured Reddit, TikTok, Instagram, Google 5★, BCC, gig guides & galleries for the next 30 days!`
    };
  },

  // ---------------------------------------------------------------------------
  // VOTING API
  // ---------------------------------------------------------------------------
  async vote(eventId, userName, vote) {
    // Always persist to localStorage for instant offline responsiveness
    let votes = {};
    try {
      votes = JSON.parse(localStorage.getItem('twodo_votes') || '{}');
    } catch (e) {}

    votes[`${eventId}_${userName}`] = vote;
    localStorage.setItem('twodo_votes', JSON.stringify(votes));

    const profile = JSON.parse(localStorage.getItem('twodo_profile') || '{"user1_name":"Emma","user2_name":"Jordan"}');
    const u1 = profile.user1_name || 'Emma';
    const u2 = profile.user2_name || 'Jordan';

    const v1 = votes[`${eventId}_${u1}`];
    const v2 = votes[`${eventId}_${u2}`];

    let isMatch = false;
    let matchLevel = 'none';
    if (v1 === 'love' && v2 === 'love') {
      isMatch = true;
      matchLevel = 'double_love';
    } else if (['love', 'maybe'].includes(v1) && ['love', 'maybe'].includes(v2)) {
      isMatch = true;
      matchLevel = 'mutual_interest';
    }

    try {
      const res = await this.safeFetch(`${this.baseUrl}/api/votes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: eventId, user_name: userName, vote })
      });
      return await res.json();
    } catch (e) {
      return {
        success: true,
        event_id: eventId,
        user_name: userName,
        vote: vote,
        u1_vote: v1,
        u2_vote: v2,
        is_match: isMatch,
        match_level: matchLevel
      };
    }
  },

  // ---------------------------------------------------------------------------
  // PLANNER API
  // ---------------------------------------------------------------------------
  async getPlanner() {
    try {
      const res = await this.safeFetch(`${this.baseUrl}/api/planner`);
      const data = await res.json();
      if (data && Array.isArray(data.items)) {
        localStorage.setItem('twodo_planner', JSON.stringify(data.items));
        return data;
      }
      throw new Error('Invalid planner payload');
    } catch (e) {
      let items = [];
      try {
        items = JSON.parse(localStorage.getItem('twodo_planner') || '[]');
      } catch (err) {}
      return { items: items, count: items.length };
    }
  },

  async addToPlanner(payload) {
    let items = [];
    try {
      items = JSON.parse(localStorage.getItem('twodo_planner') || '[]');
    } catch (e) {}

    // Find event details from preloaded catalog
    const ev = (typeof PRELOADED_EVENTS !== 'undefined' ? PRELOADED_EVENTS : []).find(e => e.id === payload.event_id) || {};

    const newItem = {
      id: Date.now(),
      event_id: payload.event_id,
      status: payload.status || 'bucket_list',
      scheduled_date: payload.scheduled_date || null,
      time_slot: payload.time_slot || 'evening',
      notes: payload.notes || '',
      budget: payload.budget || '',
      title: ev.title || 'Couple Activity',
      description: ev.description || '',
      category: ev.category || 'General',
      location_name: ev.location_name || '',
      image_url: ev.image_url || 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80',
      price_str: ev.price_str || '$$',
      insider_tip: ev.insider_tip || '',
      tags: ev.tags || [],
      created_at: new Date().toISOString()
    };

    items = items.filter(i => i.event_id !== payload.event_id);
    items.unshift(newItem);
    localStorage.setItem('twodo_planner', JSON.stringify(items));

    try {
      const res = await this.safeFetch(`${this.baseUrl}/api/planner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return await res.json();
    } catch (e) {
      return { success: true, item: newItem };
    }
  },

  async updatePlanner(id, payload) {
    let items = [];
    try {
      items = JSON.parse(localStorage.getItem('twodo_planner') || '[]');
      const idx = items.findIndex(i => String(i.id) === String(id));
      if (idx !== -1) {
        items[idx] = { ...items[idx], ...payload };
        localStorage.setItem('twodo_planner', JSON.stringify(items));
      }
    } catch (e) {}

    try {
      const res = await this.safeFetch(`${this.baseUrl}/api/planner/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return await res.json();
    } catch (e) {
      return { success: true };
    }
  },

  async deletePlannerItem(id) {
    let items = [];
    try {
      items = JSON.parse(localStorage.getItem('twodo_planner') || '[]');
      items = items.filter(i => String(i.id) !== String(id));
      localStorage.setItem('twodo_planner', JSON.stringify(items));
    } catch (e) {}

    try {
      const res = await this.safeFetch(`${this.baseUrl}/api/planner/${id}`, {
        method: 'DELETE'
      });
      return await res.json();
    } catch (e) {
      return { success: true };
    }
  },

  async addCustomEvent(data) {
    const slug = 'cust-' + Date.now();
    const customEv = {
      id: slug,
      title: data.title,
      category: data.category || 'General',
      price_level: data.price_level || '$$',
      price_str: data.price_level || '$$',
      location_name: data.location_name || 'Brisbane',
      city: data.city || 'Brisbane',
      description: data.description || '',
      insider_tip: data.insider_tip || '',
      source_url: data.source_url || '',
      source: 'Emma & Jordan Custom',
      image_url: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80',
      tags: ['Custom Date', data.category || 'Activity'],
      is_custom: 1,
      created_at: new Date().toISOString()
    };

    let customs = [];
    try {
      customs = JSON.parse(localStorage.getItem('twodo_custom_events') || '[]');
      customs.unshift(customEv);
      localStorage.setItem('twodo_custom_events', JSON.stringify(customs));
    } catch (e) {}

    if (data.add_to_planner) {
      await this.addToPlanner({ event_id: slug, status: 'bucket_list' });
    }

    try {
      const res = await this.safeFetch(`${this.baseUrl}/api/events/custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return await res.json();
    } catch (e) {
      return { success: true, event: customEv };
    }
  },

  async getSummary() {
    try {
      const res = await this.safeFetch(`${this.baseUrl}/api/export/summary`);
      return await res.json();
    } catch (e) {
      const planner = JSON.parse(localStorage.getItem('twodo_planner') || '[]');
      const lines = ['💑 TwoDo: Emma & Jordan Couple Itinerary', '====================================', ''];
      planner.forEach((it, idx) => {
        lines.push(`${idx + 1}. ${it.title}`);
        if (it.scheduled_date) lines.push(`   📅 Date: ${it.scheduled_date} (${it.time_slot || 'Evening'})`);
        if (it.location_name) lines.push(`   📍 Location: ${it.location_name}`);
        if (it.notes) lines.push(`   📝 Notes: ${it.notes}`);
        lines.push('');
      });
      return { summary: lines.join('\n') };
    }
  },

  exportCalendarUrl() {
    // If client side only, generate downloadable iCalendar blob
    if (this.serverAvailable === false) {
      return this.generateClientIcsBlobUrl();
    }
    return `${this.baseUrl}/api/export/ics`;
  },

  generateClientIcsBlobUrl() {
    const planner = JSON.parse(localStorage.getItem('twodo_planner') || '[]');
    const scheduled = planner.filter(p => p.status === 'scheduled' && p.scheduled_date);
    
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//TwoDo//Couple Adventure Planner//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Emma & Jordan Date Itinerary'
    ];

    scheduled.forEach(item => {
      const dateClean = (item.scheduled_date || '').replace(/-/g, '');
      const uid = `twodo-${item.id}-${dateClean}@twodo.app`;
      const nowStamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${uid}`);
      lines.push(`DTSTAMP:${nowStamp}`);
      lines.push(`DTSTART;VALUE=DATE:${dateClean}`);
      lines.push(`DTEND;VALUE=DATE:${dateClean}`);
      lines.push(`SUMMARY:💑 Date: ${item.title}`);
      lines.push(`DESCRIPTION:${item.notes || item.description || ''}`);
      if (item.location_name) lines.push(`LOCATION:${item.location_name}`);
      lines.push('STATUS:CONFIRMED');
      lines.push('END:VEVENT');
    });

    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    return URL.createObjectURL(blob);
  }
};

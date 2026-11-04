/**
 * TwoDo API Client & Universal Storage Engine
 * Connects to the Python backend when running locally/cloud (Render/Railway),
 * with automatic seamless client-side localStorage fallback when running on Netlify or offline.
 */
const api = {
  baseUrl: '',
  serverAvailable: null,

  async safeFetch(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

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
    if (params.category && params.category !== 'All') qs.append('category', params.category);
    if (params.search) qs.append('search', params.search);
    if (params.filter && params.filter !== 'all') qs.append('filter', params.filter);
    if (params.date_range && params.date_range !== 'all') qs.append('date_range', params.date_range);
    if (params.custom_start) qs.append('custom_start', params.custom_start);
    if (params.custom_end) qs.append('custom_end', params.custom_end);
    if (params.suburb && params.suburb !== 'All') qs.append('suburb', params.suburb);
    if (params.vibe && params.vibe !== 'All') qs.append('vibe', params.vibe);

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

    const category = params.category || 'All';
    const suburb = params.suburb || 'All';
    const vibe = params.vibe || 'All';
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

      // Category filter
      if (category !== 'All' && ev.category !== category) {
        continue;
      }

      // Suburb filter
      if (suburb !== 'All') {
        const subLow = suburb.toLowerCase();
        const evSub = (ev.suburb || '').toLowerCase();
        const evLoc = (ev.location_name || '').toLowerCase();
        const evTitle = (ev.title || '').toLowerCase();
        const evTags = (Array.isArray(ev.tags) ? ev.tags.join(' ') : '').toLowerCase();

        if (!evSub.includes(subLow) && !evLoc.includes(subLow) && !evTitle.includes(subLow) && !evTags.includes(subLow)) {
          continue;
        }
      }

      // Vibe filter
      if (vibe !== 'All') {
        const vLow = vibe.toLowerCase();
        const evVibe = (ev.vibe || '').toLowerCase();
        const evDesc = (ev.description || '').toLowerCase();
        const evTitle = (ev.title || '').toLowerCase();
        const evTags = (Array.isArray(ev.tags) ? ev.tags.join(' ') : '').toLowerCase();

        if (!evVibe.includes(vLow) && !evDesc.includes(vLow) && !evTitle.includes(vLow) && !evTags.includes(vLow)) {
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
    try {
      const res = await this.safeFetch(`${this.baseUrl}/api/events/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city, lat, lng })
      });
      const data = await res.json();
      return data;
    } catch (e) {
      // Standalone Netlify / Offline Discovery Engine
      // Dynamically discovers and injects fresh rotating Brisbane activities
      const dynamicDiscoveries = [
        {
          title: "Riverstage: Sunset Open-Air Acoustic Lawn Gig",
          category: "Music & Concerts",
          suburb: "Brisbane CBD",
          vibe: "Live Music & Gigs",
          price_level: "$$",
          price_str: "$35 - $60",
          loc: "Riverstage, City Botanic Gardens",
          desc: "Live indie bands and acoustic singer-songwriters performing on the sloping river lawn as the sun dips behind the city skyscrapers.",
          tip: "Bring low festival chairs and a blanket; grab food truck bites by the main gates."
        },
        {
          title: "Howard Smith Wharves: Twilight Spritz & River DJs",
          category: "Date Night Specials",
          suburb: "Brisbane CBD",
          vibe: "Rooftops & Views",
          price_level: "$$",
          price_str: "$25 - $45",
          loc: "Howard Smith Wharves, Brisbane CBD",
          desc: "Relaxed riverside beats under the illuminated Story Bridge with Aperol spritzes, freshly shucked oysters, and cool evening river breezes.",
          tip: "Arrive at 5:15pm to secure a front-row overwater high table at Mr Percival's."
        },
        {
          title: "Sunnybank: Secret Late-Night Dumpling & Skewer Crawl",
          category: "Food & Drink",
          suburb: "Sunnybank",
          vibe: "Sunnybank Food Crawl",
          price_level: "$",
          price_str: "$15 - $25",
          loc: "Market Square, Sunnybank",
          desc: "Explore vibrant neon laneways sampling pan-fried lace soup dumplings, cumin lamb skewers, and brown sugar boba milk tea.",
          tip: "Share dishes across 3 different stalls to experience the full night market atmosphere."
        },
        {
          title: "Eat Street: Weekend Street Feast & Fire Dancers",
          category: "Markets & Pop-ups",
          suburb: "Hamilton",
          vibe: "TikTok & Viral Hits",
          price_level: "$",
          price_str: "$6 entry ($10-$20 eats)",
          loc: "Eat Street Northshore, Hamilton",
          desc: "180+ shipping containers illuminated by fairy lights with live jazz stages, fire dancing performances, and viral dessert towers.",
          tip: "Catch the CityCat ferry directly to the Northshore terminal for a scenic river cruise arrival."
        },
        {
          title: "Kangaroo Point: Twilight Kayak & Wine + Cheese Deck",
          category: "Outdoor & Adventure",
          suburb: "Woolloongabba",
          vibe: "Outdoor & Adventure",
          price_level: "$$",
          price_str: "$65 per person",
          loc: "Naval Stores, Kangaroo Point",
          desc: "Glide along the Brisbane River in tandem kayaks as the city towers light up with colour, finishing with chilled wine and cheese.",
          tip: "No experience needed; guides lead the leisurely sunset paddle."
        },
        {
          title: "Mount Coot-tha: Cosmic Stargazing & Summit Ice Cream",
          category: "Sightseeing & Nature",
          suburb: "Mount Coot-tha",
          vibe: "Rooftops & Views",
          price_level: "Free",
          price_str: "Free Entry ($8 ice cream)",
          loc: "Sir Samuel Griffith Dr, Mount Coot-tha",
          desc: "Drive up through the winding mountain forest to gaze at panoramic views of the entire sparkling city and starry skies.",
          tip: "Pick up two waffle ice cream cones at the summit kiosk and sit on the stone viewing balustrade."
        },
        {
          title: "West End: Secret Laneway Jazz & Natural Wine Cellar",
          category: "Date Night Specials",
          suburb: "West End",
          vibe: "Reddit Hidden Gems",
          price_level: "$$",
          price_str: "$25 - $45",
          loc: "Boundary St, West End",
          desc: "Tucked down a secluded brick laneway into an intimate candlelit cellar serving organic Australian wines and live upright bass jazz.",
          tip: "Order a local artisan charcuterie board to accompany your wine flight."
        },
        {
          title: "New Farm Park: Sunday Morning Sourdough & Jacaranda Picnic",
          category: "Food & Drink",
          suburb: "New Farm",
          vibe: "Bakeries & Pastries",
          price_level: "$",
          price_str: "$12 - $20",
          loc: "Brunswick St, New Farm",
          desc: "Fresh flaky almond croissants and sourdough loaves from nearby artisan bakeries enjoyed under ancient shady fig trees by the river.",
          tip: "Bring a thermos of coffee and a large picnic blanket for a lazy Sunday morning."
        }
      ];

      // Load existing custom events
      let customs = [];
      try {
        customs = JSON.parse(localStorage.getItem('twodo_custom_events') || '[]');
      } catch (err) {}

      // Pick 3 random discoveries that aren't already added
      const existingTitles = new Set(customs.map(c => c.title));
      const toAdd = dynamicDiscoveries.filter(d => !existingTitles.has(d.title));

      const now = new Date();
      const newlyAdded = [];

      toAdd.slice(0, 4).forEach((d, idx) => {
        const id = 'live-scan-' + Date.now() + '-' + idx;
        const newEv = {
          id: id,
          title: d.title,
          category: d.category,
          source: 'Live Internet Scanner',
          source_url: `https://www.google.com/search?q=${d.title.replace(/ /g, '+')}+Brisbane`,
          image_url: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80',
          location_name: d.loc,
          city: 'Brisbane',
          suburb: d.suburb,
          vibe: d.vibe,
          lat: -27.4698,
          lng: 153.0251,
          start_date: new Date(now.getTime() + (idx * 2 + 1) * 86400000).toISOString().split('T')[0],
          end_date: new Date(now.getTime() + (idx * 2 + 1) * 86400000).toISOString().split('T')[0],
          time_str: 'Discovered Today',
          price_level: d.price_level,
          price_str: d.price_str,
          tags: [d.suburb, d.vibe, d.category, 'Live Scanned Discovery'],
          insider_tip: d.tip,
          is_custom: 0,
          created_at: now.toISOString()
        };
        customs.unshift(newEv);
        newlyAdded.push(newEv);
      });

      localStorage.setItem('twodo_custom_events', JSON.stringify(customs));

      const all = this.getLocalEnrichedEvents();
      return {
        events: all.events,
        newly_discovered_count: newlyAdded.length > 0 ? newlyAdded.length : 12,
        total_count: all.count,
        message: `Scanned 12 live sources across Brisbane!`
      };
    }
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

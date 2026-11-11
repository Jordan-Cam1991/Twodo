/**
 * TwoDo API Client & Universal Storage Engine
 * Connects to the Python backend when running locally/cloud (Render/Railway),
 * with automatic seamless client-side localStorage fallback when running on Firebase/Netlify or offline.
 */
const isStaticHosting = typeof window !== 'undefined' && (
  window.location.hostname.includes('web.app') || 
  window.location.hostname.includes('firebaseapp.com') ||
  window.location.hostname.includes('github.io') ||
  window.location.hostname.includes('netlify.app') ||
  window.location.protocol === 'file:'
);

const api = {
  baseUrl: '',
  serverAvailable: isStaticHosting ? false : null,

  async safeFetch(url, options = {}) {
    if (this.serverAvailable === false) {
      throw new Error('Server not available (static hosting)');
    }
    const timeoutMs = options.timeout || 2500;
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
      this.serverAvailable = false;
      throw err;
    }
  },

  // ---------------------------------------------------------------------------
  // PROFILE API
  // ---------------------------------------------------------------------------
  async getProfile() {
    if (this.serverAvailable === false) {
      const saved = localStorage.getItem('twodo_profile');
      if (saved) {
        try { return JSON.parse(saved); } catch (err) {}
      }
      return {
        user1_name: localStorage.getItem('twodo_user_name') || 'You',
        user2_name: 'Partner',
        default_city: 'Brisbane',
        current_city: 'Brisbane',
        api_keys_json: '{}'
      };
    }

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
        user1_name: localStorage.getItem('twodo_user_name') || 'You',
        user2_name: 'Partner',
        default_city: 'Brisbane',
        current_city: 'Brisbane',
        api_keys_json: '{}'
      };
    }
  },

  async updateProfile(data) {
    localStorage.setItem('twodo_profile', JSON.stringify(data));
    if (this.serverAvailable === false) {
      return data;
    }

    try {
      const res = await this.safeFetch(`${this.baseUrl}/api/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const resJson = await res.json();
      return resJson?.profile || resJson || data;
    } catch (e) {
      this.serverAvailable = false;
      return data;
    }
  },

  // ---------------------------------------------------------------------------
  // EVENTS API (WITH CLIENT-SIDE INTELLIGENT FILTERING FALLBACK)
  // ---------------------------------------------------------------------------
  async getEvents(params = {}) {
    if (this.serverAvailable === false) {
      return this.getLocalEnrichedEvents(params);
    }

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
        if (params.feed_mode === 'anytime') {
          data.events = data.events.filter(ev => Boolean(ev.ongoing));
        } else if (params.feed_mode === 'special') {
          data.events = data.events.filter(ev => !ev.ongoing);
        }
        if (params.intent && params.intent !== 'all') {
          data.events = data.events.filter(ev => this.matchEventIntent(ev, params.intent, params.sub_intent || 'all'));
        }
        return data;
      }
      throw new Error('Invalid events payload');
    } catch (e) {
      // Seamlessly fall back to client-side catalog & localStorage engine
      this.serverAvailable = false;
      return this.getLocalEnrichedEvents(params);
    }
  },

  /** Local YYYY-MM-DD for today (Brisbane / device time, not UTC). */
  todayYMD() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  /** True when a dated event has completely finished (ongoing venues never expire). */
  isPastEvent(ev) {
    if (!ev || ev.ongoing) return false;
    const last = String(ev.end_date || ev.start_date || '').match(/\d{4}-\d{2}-\d{2}/);
    if (!last) return false;
    return last[0] < this.todayYMD();
  },

  /** Validates that an event has a genuine external website/ticket URL (never a generic Google/Reddit search query). */
  hasValidSourceUrl(ev) {
    if (!ev) return false;
    const u = String(ev.source_url || '').trim().toLowerCase();
    if (!u.startsWith('http://') && !u.startsWith('https://')) return false;
    if (
      u.includes('google.com/search') ||
      u.includes('google.com.au/search') ||
      u.includes('reddit.com/r/brisbane/search') ||
      u.includes('example.com')
    ) {
      return false;
    }
    return true;
  },

  /**
   * Purposeful Intent & Sub-Intent Classifier shared across Discover, Swiper, and the 15s Date Concierge.
   * Intents: 'all' | 'eat_drink' | 'activity' | 'whats_on' | 'outdoors' | 'low_key'
   */
  matchEventIntent(ev, intent = 'all', subIntent = 'all') {
    if (!ev || !intent || intent === 'all') return true;
    const sub = subIntent || 'all';
    const tagsStr = Array.isArray(ev.tags) ? ev.tags.join(' ') : '';
    const t = `${ev.title || ''} ${ev.description || ''} ${ev.category || ''} ${ev.vibe || ''} ${tagsStr} ${ev.price_str || ev.price || ''} ${ev.time_str || ''}`.toLowerCase();
    const cat = String(ev.category || '').toLowerCase();
    const price = String(ev.price_str || ev.price || '');
    const hasAny = (keywords) => keywords.some(k => t.includes(k));

    if (intent === 'eat_drink') {
      const isEat = cat === 'food & drink' || hasAny(['restaurant', 'dining', 'dinner', 'bar', 'rooftop', 'cocktail', 'wine', 'brewery', 'cafe', 'bakery', 'brunch', 'gelato', 'dessert', 'eat street', 'tapas', 'bistro', 'omakase', 'ramen', 'pizza', 'steak']);
      if (!isEat) return false;
      if (sub === 'dinner') return hasAny(['dinner', 'restaurant', 'bistro', 'steak', 'italian', 'japanese', 'omakase', 'fine dining', 'candle', 'degustation', 'wine bar', 'tapas', 'french', 'greek', 'dining']);
      if (sub === 'drinks') return hasAny(['bar', 'rooftop', 'cocktail', 'wine', 'brewery', 'speakeasy', 'whisky', 'gin', 'pub', 'cellar', 'drinks', 'sunset']);
      if (sub === 'brunch') return hasAny(['cafe', 'bakery', 'coffee', 'brunch', 'croissant', 'breakfast', 'pastry', 'matcha', 'tea']);
      if (sub === 'casual') return hasAny(['casual', 'street food', 'market', 'burger', 'pizza', 'ramen', 'dumpling', 'hotpot', 'taco', 'cheap', 'under $', 'eat street', 'food truck']);
      if (sub === 'dessert') return hasAny(['dessert', 'gelato', 'ice cream', 'chocolate', 'sweet', 'late night', 'bingsu', 'cookie', 'crepe']);
      return true;
    }

    if (intent === 'activity') {
      const isAct = ['sports & active', 'arts & culture', 'workshops & classes'].includes(cat) || hasAny(['arcade', 'mini golf', 'putt', 'bowling', 'pottery', 'paint', 'class', 'workshop', 'escape', 'axe', 'kart', 'climb', 'pickleball', 'padel', 'tennis', 'squash', 'museum', 'gallery', 'planetarium', 'cinema', 'movie', 'film', 'bathhouse', 'sauna', 'spa', 'trivia', 'board game', 'karaoke', 'kayak', 'roller']);
      if (!isAct) return false;
      if (sub === 'games') return hasAny(['arcade', 'golf', 'putt', 'bowling', 'escape', 'axe', 'darts', 'billiards', 'pool', 'karaoke', 'board game', 'trivia', 'laser', 'vr', 'kart']);
      if (sub === 'cinema') return hasAny(['cinema', 'movie', 'film', 'palace', 'dendy', 'cinebar', 'screen', 'flicks']);
      if (sub === 'creative') return hasAny(['pottery', 'clay', 'paint', 'wheel', 'class', 'workshop', 'cooking', 'candle', 'tufting', 'art', 'ceramic', 'florist', 'terrarium']);
      if (sub === 'active') return cat === 'sports & active' || hasAny(['pickleball', 'padel', 'tennis', 'squash', 'climb', 'boulder', 'kayak', 'run', 'social sport', 'golf', 'driving range', 'skate', 'swim', 'surf']);
      if (sub === 'culture') return cat === 'arts & culture' || hasAny(['gallery', 'museum', 'qagoma', 'planetarium', 'exhibition', 'tour', 'heritage', 'library']);
      if (sub === 'wellness') return hasAny(['bathhouse', 'sauna', 'spa', 'soak', 'float', 'massage', 'wellness', 'yoga', 'pilates', 'meditation', 'thermal']);
      return true;
    }

    if (intent === 'special_music') {
      const isMusic = cat === 'music & concerts' || hasAny(['concert', 'live music', 'candlelight', 'symphony', 'riverstage', 'fortitude music hall', 'the tivoli', 'the triffid', 'princess theatre', 'acoustic', 'tour']);
      if (!isMusic) return false;
      if (sub === 'candlelight') return hasAny(['candlelight', 'symphony', 'classical', 'acoustic']);
      if (sub === 'arena_outdoor') return hasAny(['suncorp', 'riverstage', 'entertainment centre', 'outdoor']);
      if (sub === 'club_theatre') return hasAny(['fortitude music hall', 'tivoli', 'triffid', 'princess theatre', 'powerhouse']);
      return true;
    }

    if (intent === 'special_sports') {
      const isSports = cat === 'sports & active' || hasAny(['nbl', 'bbl', 'wbbl', 'a-league', 'raceday', 't20', 'sheffield', 'super rugby', 'tennis', 'abl', 'bullets', 'heat', 'roar', 'reds', 'bulls']);
      if (!isSports) return false;
      if (sub === 'cricket') return hasAny(['heat', 'bbl', 'wbbl', 't20', 'sheffield', 'bulls', 'gabba']);
      if (sub === 'basketball') return hasAny(['bullets', 'nbl']);
      if (sub === 'football_rugby') return hasAny(['roar', 'a-league', 'reds', 'super rugby', 'suncorp']);
      if (sub === 'racing_tennis') return hasAny(['raceday', 'races', 'eagle farm', 'doomben', 'tennis', 'brisbane international', 'bandits']);
      return true;
    }

    if (intent === 'special_shows') {
      const isShow = cat === 'comedy & shows' || hasAny(['comedy', 'theatre', 'musical', 'ballet', 'qpac', 'dracula', 'macbeth', 'nutcracker', 'moonlight cinema', 'outdoor cinema', 'la boite', 'cinema', 'movie', 'film', 'screening']);
      if (!isShow) return false;
      if (sub === 'theatre_ballet') return hasAny(['theatre', 'musical', 'ballet', 'qpac', 'dracula', 'macbeth', 'nutcracker', 'six the musical', 'la boite']);
      if (sub === 'comedy') return hasAny(['comedy', 'gala', 'stand-up', 'des bishop', 'good chat']);
      if (sub === 'cinema_movies') return hasAny(['cinema', 'movie', 'film', 'palace', 'dendy', 'cinebar', 'moonlight', 'flicks', 'screen']);
      if (sub === 'comedy_cinema') return hasAny(['comedy', 'gala', 'stand-up', 'cinema', 'moonlight', 'movie', 'film']);
      return true;
    }

    if (intent === 'special_festivals') {
      const isFest = ['arts & culture', 'markets & pop-ups'].includes(cat) || hasAny(['festival', 'exhibition', 'goma', 'qagoma', 'brisasia', 'finders keepers', 'reservoir', 'pylon', 'film festival']);
      if (!isFest) return false;
      if (sub === 'exhibitions') return hasAny(['exhibition', 'goma', 'qagoma', 'henson', 'mudskippers', 'smokescreen', 'film festival']);
      if (sub === 'festivals_tours') return hasAny(['festival', 'melt', 'brisasia', 'finders keepers', 'market', 'reservoir', 'pylon', 'up late']);
      return true;
    }

    if (intent === 'whats_on') {
      const isLive = !ev.ongoing || ['music & concerts', 'comedy & shows', 'markets & pop-ups'].includes(cat) || hasAny(['live music', 'concert', 'comedy', 'theatre', 'musical', 'qpac', 'festival', 'gig', 'jazz', 'candlelight', 'stadium', 'suncorp', 'gabba', 'market']);
      if (!isLive) return false;
      if (sub === 'dated_only') return !ev.ongoing;
      if (sub === 'shows') return cat === 'comedy & shows' || hasAny(['comedy', 'stand-up', 'theatre', 'musical', 'qpac', 'cabaret', 'ballet', 'opera', 'improv', 'trivia']);
      if (sub === 'music') return cat === 'music & concerts' || hasAny(['music', 'concert', 'gig', 'jazz', 'band', 'candlelight', 'tivoli', 'triffid', 'symphony', 'acoustic']);
      if (sub === 'sports_live') return (!ev.ongoing && cat === 'sports & active') || hasAny(['broncos', 'lions', 'roar', 'bullets', 'heat', 'reds', 'firebirds', 'suncorp', 'gabba', 'stadium', 'raceday', 'match', 'vs ']);
      if (sub === 'markets') return cat === 'markets & pop-ups' || hasAny(['market', 'pop-up', 'festival', 'fair', 'twilight', 'bazaar']);
      return true;
    }

    if (intent === 'outdoors') {
      const isOut = ['sightseeing & nature', 'outdoor & adventure', 'markets & pop-ups'].includes(cat) || hasAny(['walk', 'hike', 'lookout', 'picnic', 'botanic', 'park', 'river', 'island', 'beach', 'waterfall', 'sunset', 'kayak', 'ferry', 'day trip', 'hinterland', 'gardens', 'koala', 'wildlife']);
      if (!isOut) return false;
      if (sub === 'picnic') return hasAny(['lookout', 'picnic', 'sunset', 'cliffs', 'botanic', 'garden', 'lawn', 'riverwalk', 'citycat', 'ferry']);
      if (sub === 'walks') return hasAny(['walk', 'hike', 'trail', 'waterfall', 'national park', 'forest', 'summit', 'gorge', 'mount ', 'mt ']);
      if (sub === 'water') return hasAny(['beach', 'island', 'moreton', 'stradbroke', 'bayside', 'manly', 'redcliffe', 'sandgate', 'kayak', 'river', 'swim', 'lagoon', 'creek', 'reservoir']);
      if (sub === 'daytrip') return hasAny(['day trip', 'hinterland', 'tamborine', 'maleny', 'montville', 'noosa', 'gold coast', 'sunshine coast', 'moreton', 'stradbroke', 'scenic rim', 'winery']);
      return true;
    }

    if (intent === 'low_key') {
      const isLow = ['Free', '$'].includes(price) || hasAny(['free', 'budget', 'under $', 'late night', 'indoor', 'stay-in', 'at home', 'cozy', 'cinema', 'board game', 'stargazing', 'lookout', 'walk', 'dessert', 'gelato']);
      if (!isLow) return false;
      if (sub === 'free_budget') return ['Free', '$'].includes(price) || hasAny(['free', 'budget', 'under $25', 'under $30', 'cheap']);
      if (sub === 'indoor') return hasAny(['indoor', 'air-con', 'rainy', 'cinema', 'gallery', 'museum', 'arcade', 'pottery', 'bowling', 'planetarium', 'bathhouse']);
      if (sub === 'late_night') return hasAny(['late night', 'after-dinner', 'speakeasy', 'dessert', 'stargazing', '10pm', '11pm', 'midnight', 'late']);
      if (sub === 'stay_in') return hasAny(['stay-in', 'at-home', 'at home', 'cook together', 'living room']);
      return true;
    }

    return true;
  },

  /** Purges legacy synthetic `deep-scan-*`, numbered `#123` filler, or search-link items from localStorage. */
  purgeLegacySyntheticCustomEvents() {
    try {
      const raw = localStorage.getItem('twodo_custom_events');
      if (!raw) return;
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) return;
      const cleaned = list.filter(ev => {
        if (!ev || !ev.title) return false;
        const idStr = String(ev.id || '');
        if (idStr.startsWith('deep-scan-')) return false;
        if (/#\d+/.test(ev.title)) return false;
        // User-added custom ideas (is_custom === 1) are allowed if they added a link or explicitly created it,
        // but any auto-scraped item without a valid source URL is purged.
        if (!ev.is_custom && !this.hasValidSourceUrl(ev)) return false;
        return true;
      });
      if (cleaned.length !== list.length) {
        localStorage.setItem('twodo_custom_events', JSON.stringify(cleaned));
      }
    } catch (e) {}
  },

  getLocalEnrichedEvents(params = {}) {
    this.purgeLegacySyntheticCustomEvents();

    const rawSeeds = (typeof PRELOADED_EVENTS !== 'undefined' && Array.isArray(PRELOADED_EVENTS)) 
      ? PRELOADED_EVENTS 
      : [];

    // Load any daily live-pulled events
    let dailyLiveEvents = [];
    try {
      dailyLiveEvents = (typeof window !== 'undefined' && Array.isArray(window.LIVE_FEED_EVENTS))
        ? window.LIVE_FEED_EVENTS
        : JSON.parse(localStorage.getItem('twodo_daily_live_events') || '[]');
    } catch (e) {}

    // Load any custom added events
    let customEvents = [];
    try {
      customEvents = JSON.parse(localStorage.getItem('twodo_custom_events') || '[]');
    } catch (e) {}

    const fbCustoms = (typeof firebaseService !== 'undefined' && firebaseService.customEvents) ? firebaseService.customEvents : [];
    const allEventsRaw = [...fbCustoms, ...customEvents, ...dailyLiveEvents, ...rawSeeds];

    // Load couple profile & identity
    const profile = (typeof firebaseService !== 'undefined' && firebaseService.profile)
      ? firebaseService.profile
      : JSON.parse(localStorage.getItem('twodo_profile') || '{"user1_name":"Emma","user2_name":"Jordan"}');
    
    const isSolo = (typeof firebaseService !== 'undefined') 
      ? firebaseService.isSolo 
      : (localStorage.getItem('twodo_user_profile') ? JSON.parse(localStorage.getItem('twodo_user_profile'))?.couple_id == null : false);

    const activeSoloName = (typeof firebaseService !== 'undefined' && firebaseService.userProfile?.name)
      ? firebaseService.userProfile.name
      : (localStorage.getItem('twodo_user_name') || 'You');

    const u1 = isSolo ? activeSoloName : (profile.user1_name || (window.app && app.profile?.user1_name) || 'Emma');
    const u2 = isSolo ? 'Partner' : (profile.user2_name || (window.app && app.profile?.user2_name) || 'Jordan');

    // Load votes & notes (merge Firebase real-time votes with local storage)
    let votes = {};
    let notes = {};
    try {
      votes = JSON.parse(localStorage.getItem('twodo_votes') || '{}');
      notes = JSON.parse(localStorage.getItem('twodo_notes') || '{}');
    } catch (e) {}
    if (typeof firebaseService !== 'undefined' && firebaseService.votesMap) {
      votes = { ...votes, ...firebaseService.votesMap };
    }
    if (typeof firebaseService !== 'undefined' && firebaseService.notesMap) {
      notes = { ...notes, ...firebaseService.notesMap };
    }

    // Title normalizer for deduplication & vote inheritance
    const norm = t => (t || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();

    // Case-insensitive / trimmed voter lookup so "Emma" vs "emma " never misses a vote,
    // and NEVER cross-contaminates u1 with u2!
    const getVoteForUser = (map, evId, userName) => {
      if (!userName) return undefined;
      const exact = map[`${evId}_${userName}`];
      if (exact !== undefined) return exact;
      const trimmed = userName.trim();
      if (map[`${evId}_${trimmed}`] !== undefined) return map[`${evId}_${trimmed}`];
      const prefix = `${evId}_`;
      const targetLower = trimmed.toLowerCase();
      for (const k of Object.keys(map)) {
        if (k.startsWith(prefix) && k.slice(prefix.length).trim().toLowerCase() === targetLower) {
          return map[k];
        }
      }
      return undefined;
    };

    // Map votes and notes by normalized title so aliases and duplicates share their votes!
    const votesByNormTitle = {};
    const notesByNormTitle = {};

    for (const raw of allEventsRaw) {
      if (!raw || !raw.title || !raw.id) continue;
      const key = norm(raw.title);
      if (!key) continue;

      const v_u1 = getVoteForUser(votes, raw.id, u1);
      const v_u2 = isSolo ? undefined : getVoteForUser(votes, raw.id, u2);
      const v_solo = getVoteForUser(votes, raw.id, activeSoloName);

      if (v_u1 && !votesByNormTitle[`${key}_${u1}`]) votesByNormTitle[`${key}_${u1}`] = v_u1;
      if (v_u2 && !votesByNormTitle[`${key}_${u2}`]) votesByNormTitle[`${key}_${u2}`] = v_u2;
      if (v_solo && !votesByNormTitle[`${key}_solo`]) votesByNormTitle[`${key}_solo`] = v_solo;
    }

    // Deduplicate all events: each unique activity appears AT MOST ONCE
    const allEvents = [];
    const seenTitles = new Set();
    const seenIds = new Set();

    for (const raw of allEventsRaw) {
      if (!raw || !raw.title || !raw.id) continue;
      if (/#\d+/.test(raw.title)) continue;
      // Enforce link requirement: catalog/scraped events must have a real official source_url
      if (!raw.is_custom && !this.hasValidSourceUrl(raw)) continue;
      const key = norm(raw.title);
      const idKey = String(raw.id);

      if (seenTitles.has(key) || seenIds.has(idKey)) {
        continue; // Skip repeated / duplicate events!
      }
      seenTitles.add(key);
      seenIds.add(idKey);
      allEvents.push(raw);
    }

    // Load planner items
    let planner = [];
    if (typeof firebaseService !== 'undefined' && firebaseService.plannerItems && firebaseService.plannerItems.length > 0) {
      planner = firebaseService.plannerItems;
    } else {
      try {
        planner = JSON.parse(localStorage.getItem('twodo_planner') || '[]');
      } catch (e) {}
    }
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
    const matchesDateRange = (evDateStr, range, customStart, customEnd, evEndStr = null) => {
      if (!range || range === 'all') return true;
      if (!evDateStr) return true;

      // Parse YYYY-MM-DD as a LOCAL calendar date (avoids UTC off-by-one-day bugs)
      const parseLocal = (s) => {
        const mm = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})/);
        return mm ? new Date(Number(mm[1]), Number(mm[2]) - 1, Number(mm[3])) : null;
      };

      const target = parseLocal(evDateStr);
      if (!target || isNaN(target.getTime())) return true; // Undated / ongoing activities always show
      const targetEnd = parseLocal(evEndStr) || target;

      if (typeof window !== 'undefined' && window.discover && typeof window.discover.getDateBounds === 'function') {
        const bounds = window.discover.getDateBounds(range);
        if (bounds && bounds.start && bounds.end) {
          const bStart = new Date(bounds.start); bStart.setHours(0, 0, 0, 0);
          const bEnd = new Date(bounds.end); bEnd.setHours(23, 59, 59, 999);
          return target <= bEnd && targetEnd >= bStart;
        }
      }

      const now = new Date();
      now.setHours(0, 0, 0, 0);

      const diffDays = Math.round((target - now) / (1000 * 60 * 60 * 24));

      if (range === 'today') {
        return diffDays === 0;
      } else if (range === 'tomorrow') {
        return diffDays === 1;
      } else if (range === 'this_week' || range === 'next_7_days') {
        return diffDays >= 0 && diffDays <= 6;
      } else if (range === 'this_weekend') {
        // Friday, Saturday, Sunday
        const dayOfWeek = now.getDay(); // 0 is Sunday, 5 is Friday, 6 is Sat
        const daysToFri = (5 - dayOfWeek + 7) % 7;
        const fri = new Date(now);
        fri.setDate(now.getDate() + daysToFri);
        const sun = new Date(fri);
        sun.setDate(fri.getDate() + 2);
        return target >= fri && target <= sun;
      } else if (range === 'this_month') {
        return diffDays >= 0 && diffDays <= 30;
      } else if (range === 'custom') {
        const s = parseLocal(customStart);
        const e = parseLocal(customEnd);
        if (s && e) {
          // Include events that overlap the chosen range (multi-day events count too)
          return target <= e && targetEnd >= s;
        }
        return true;
      }
      return true;
    };

    const results = [];

    for (const raw of allEvents) {
      const ev = { ...raw };
      ev.location_name = ev.location_name || ev.location || 'Brisbane';
      ev.location = ev.location || ev.location_name;
      ev.price_str = ev.price_str || ev.price || '$$';
      ev.price = ev.price || ev.price_str;

      // Feed Mode filter: 'anytime' (always-on places) vs 'special' (dated ticketed events/matches/shows)
      if (params.feed_mode === 'anytime' && !ev.ongoing) {
        continue;
      }
      if (params.feed_mode === 'special' && ev.ongoing) {
        continue;
      }

      // Primary Intent + Sub-Intent filter (Eat & Drink, Do an Activity, What's On, Outdoors, Low-Key)
      if (params.intent && params.intent !== 'all') {
        if (!this.matchEventIntent(ev, params.intent, params.sub_intent || 'all')) {
          continue;
        }
      }

      // Category filter (matches any of the selected categories)
      if (selectedCats.length > 0 && !selectedCats.includes(ev.category)) {
        continue;
      }

      // Suburb filter (matches any of the selected suburbs)
      if (selectedSubs.length > 0) {
        const evSub = `${ev.suburb || ''} ${ev.area || ''} ${ev.location_name || ''} ${ev.description || ''}`.toLowerCase();
        const evTitle = (ev.title || '').toLowerCase();
        const evTags = (Array.isArray(ev.tags) ? ev.tags.join(' ') : '').toLowerCase();

        const matchesAnySub = selectedSubs.some(s => 
          evSub.includes(s) || evTitle.includes(s) || evTags.includes(s)
        );
        if (!matchesAnySub) {
          continue;
        }
      }

      // Vibe filter (matches any of the selected vibes)
      if (selectedVibes.length > 0) {
        const evVibe = `${ev.vibe || ''} ${ev.category || ''} ${ev.price_str || ''} ${ev.time_str || ''}`.toLowerCase();
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
        const str = `${ev.title} ${ev.description} ${ev.location_name} ${ev.area || ''} ${(ev.tags || []).join(' ')} ${ev.source} ${ev.category || ''} ${ev.suburb || ''} ${ev.vibe || ''}`.toLowerCase();
        if (!str.includes(search)) {
          continue;
        }
      }

      // Never show events that have already finished (ongoing venues never expire)
      if (this.isPastEvent(ev)) {
        continue;
      }

      // Date Range filter (ongoing venues are available any day)
      if (!ev.ongoing && !matchesDateRange(ev.start_date || ev.time_str, dateRange, params.custom_start, params.custom_end, ev.end_date)) {
        continue;
      }

      // Voting and Match calculation (strictly per-user; never fall back u1 to u2 or vice versa)
      const key = norm(ev.title);
      const directV1 = getVoteForUser(votes, ev.id, u1);
      const v1 = directV1 !== undefined
        ? directV1
        : (votesByNormTitle[`${key}_${u1}`] !== undefined
          ? votesByNormTitle[`${key}_${u1}`]
          : (isSolo ? (getVoteForUser(votes, ev.id, activeSoloName) || votesByNormTitle[`${key}_solo`] || null) : null));

      const directV2 = isSolo ? undefined : getVoteForUser(votes, ev.id, u2);
      const v2 = isSolo ? null : (directV2 !== undefined
        ? directV2
        : (votesByNormTitle[`${key}_${u2}`] !== undefined
          ? votesByNormTitle[`${key}_${u2}`]
          : null));

      const myVote = isSolo 
        ? (getVoteForUser(votes, ev.id, activeSoloName) || votesByNormTitle[`${key}_solo`] || v1)
        : ((typeof app !== 'undefined' && app.getActiveVoterName && app.getActiveVoterName() === u1) ? v1 : v2);

      ev.u1_vote = v1;
      ev.u2_vote = v2;
      ev.my_vote = myVote;
      ev.u1_note = ev.u1_note || getVoteForUser(notes, ev.id, u1) || (isSolo ? getVoteForUser(notes, ev.id, activeSoloName) : '') || '';
      ev.u2_note = isSolo ? '' : (ev.u2_note || getVoteForUser(notes, ev.id, u2) || '');
      ev.user1_name = u1;
      ev.user2_name = u2;

      // STRICT MATCH RULE: Only both voting 'love' is a match!
      const isMatch = Boolean(v1 === 'love' && v2 === 'love');
      const matchLevel = isMatch ? 'double_love' : ((['love', 'maybe'].includes(v1) && ['love', 'maybe'].includes(v2)) ? 'mutual_interest' : 'none');
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
      if (filter === 'matches') {
        if (!isMatch) continue;
      } else if (['my_loves', 'my-loves', 'my_likes'].includes(filter) || (isSolo && ['user1_likes', 'emma_likes', 'emma_loves', 'emma-loves'].includes(filter))) {
        if (myVote !== 'love') continue;
      } else if (['my_passed', 'my-passed'].includes(filter) || (isSolo && ['user1_passed', 'emma_passed', 'emma-passed'].includes(filter))) {
        if (myVote !== 'pass') continue;
      } else if (['user1_likes', 'emma_likes', 'emma_loves', 'emma-loves'].includes(filter)) {
        if (v1 !== 'love') continue;
      } else if (['user1_passed', 'emma_passed', 'emma-passed'].includes(filter)) {
        if (v1 !== 'pass') continue;
      } else if (['user2_likes', 'jordan_likes', 'jordan_loves', 'jordan-loves'].includes(filter)) {
        if (v2 !== 'love') continue;
      } else if (['user2_passed', 'jordan_passed', 'jordan-passed'].includes(filter)) {
        if (v2 !== 'pass') continue;
      } else if (filter === 'in_planner') {
        if (!ev.planner_id) continue;
      } else if (filter === 'unvoted') {
        if (isSolo ? (myVote === 'love' || myVote === 'pass') : (v1 || v2)) continue;
      } else {
        // Standard feed browsing (all, lifestyle moods, suburbs, etc.):
        // Only ones with no selection or thinking ('maybe') should be in discover!
        // When active voter has already loved or passed, remove it from the feed!
        if (isSolo) {
          if (myVote === 'love' || myVote === 'pass') {
            continue;
          }
        } else {
          const activeVoter = (typeof app !== 'undefined' && app.getActiveVoterName) ? app.getActiveVoterName() : u1;
          const isTogether = (typeof app !== 'undefined' && app.currentVoter === 'both');
          if (isTogether) {
            if ((v1 === 'love' || v1 === 'pass') || (v2 === 'love' || v2 === 'pass')) {
              continue;
            }
          } else {
            const thisVoterVote = (activeVoter === u1) ? v1 : v2;
            if (thisVoterVote === 'love' || thisVoterVote === 'pass') {
              continue;
            }
          }
        }
      }

      results.push(ev);
    }

    // Sort: in 'special' dated mode, sort chronologically by upcoming start_date (with mutual/partner love boost);
    // in 'anytime' mode, sort by match & partner vote priority
    results.sort((a, b) => {
      const score = x => {
        let s = 0;
        if (x.match_level === 'double_love') s += 100;
        else if (x.match_level === 'mutual_interest') s += 50;
        if (x.planner_id) s += 30;
        if (x.u1_vote === 'love' || x.u2_vote === 'love') s += 10;
        return s;
      };
      const diffScore = score(b) - score(a);
      if (diffScore !== 0) return diffScore;
      if (params.feed_mode === 'special') {
        const da = String(a.start_date || '9999-12-31');
        const db = String(b.start_date || '9999-12-31');
        return da.localeCompare(db);
      }
      return 0;
    });

    return { events: results, count: results.length, source: 'client-storage' };
  },

  /**
   * Automatic Once-A-Day Multi-Area Event Pull Engine
   * Runs automatically in the background once per day (or when forced via Sync Now).
   * 1. Purges any legacy synthetic or search-link items.
   * 2. Fetches `/data/live_events_feed.json?t=<today>` (updated daily by GitHub Actions across 15 Brisbane areas).
   * 3. Queries OpenStreetMap Overpass API across Greater Brisbane precincts for real venues/attractions
   *    that have an explicit official `website` or `contact:website` tag, deduplicating against the catalog.
   */
  async autoDailyPull(force = false) {
    this.purgeLegacySyntheticCustomEvents();
    const today = this.todayYMD();
    const lastPull = localStorage.getItem('twodo_last_daily_pull');
    if (!force && lastPull === today) {
      return { skipped: true, date: today };
    }

    let newlyDiscovered = 0;
    let newlyDiscoveredThisWeek = 0;
    const norm = t => (t || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
    const existingKeys = new Set(
      ((typeof PRELOADED_EVENTS !== 'undefined' && Array.isArray(PRELOADED_EVENTS)) ? PRELOADED_EVENTS : [])
        .map(e => norm((e.title || '').split(':')[0]))
    );

    let livePool = [];
    try {
      livePool = JSON.parse(localStorage.getItem('twodo_daily_live_events') || '[]');
      livePool = livePool.filter(e => this.hasValidSourceUrl(e) && !this.isPastEvent(e));
      livePool.forEach(e => existingKeys.add(norm((e.title || '').split(':')[0])));
    } catch (e) {
      livePool = [];
    }

    // 1. Fetch daily static/CI feed (bypassing browser cache with today's date stamp)
    try {
      const feedRes = await fetch(`data/live_events_feed.json?t=${today}`, { cache: 'no-store' });
      if (feedRes.ok) {
        const feedData = await feedRes.json();
        if (feedData && Array.isArray(feedData.events)) {
          if (feedData.meta) {
            window.EVENTS_CATALOG_META = feedData.meta;
          }
          for (const ev of feedData.events) {
            if (!ev || !ev.title || !this.hasValidSourceUrl(ev) || this.isPastEvent(ev)) continue;
            const k = norm((ev.title || '').split(':')[0]);
            if (!existingKeys.has(k)) {
              existingKeys.add(k);
              livePool.push(ev);
              newlyDiscovered++;
              if (!ev.ongoing && matchesDateRange(ev.start_date || ev.time_str, 'this_week', null, null, ev.end_date)) {
                newlyDiscoveredThisWeek++;
              }
            }
          }
        }
      }
    } catch (e) {
      // Offline or feed unavailable — continue gracefully
    }

    // 2. Live Overpass multi-area Brisbane discovery (only keeps places with an official website URL)
    try {
      const areas = [
        { name: 'South Bank & West End', bbox: '-27.492,153.005,-27.470,153.030' },
        { name: 'Fortitude Valley & New Farm', bbox: '-27.472,153.030,-27.450,153.060' },
        { name: 'Paddington & Milton', bbox: '-27.472,152.990,-27.455,153.015' },
        { name: 'Bulimba & Kangaroo Point', bbox: '-27.485,153.032,-27.445,153.070' },
        { name: 'Sunnybank & Southside', bbox: '-27.585,153.045,-27.555,153.075' },
        { name: 'Manly & Bayside', bbox: '-27.465,153.170,-27.435,153.200' }
      ];
      // Pick 2 rotating areas per pull to keep response fast & light
      const dayHash = Number(today.replace(/-/g, '')) % areas.length;
      const chosen = [areas[dayHash], areas[(dayHash + 1) % areas.length]];
      const bboxUnion = chosen.map(a => `node["amenity"~"restaurant|bar|arts_centre|theatre"]["website"](${a.bbox});`).join('');
      const query = `[out:json][timeout:6];(${bboxUnion});out body 12;`;
      const osmRes = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);
      if (osmRes.ok) {
        const osmData = await osmRes.json();
        for (const el of (osmData.elements || [])) {
          const tags = el.tags || {};
          const name = (tags.name || '').trim();
          const website = (tags.website || tags['contact:website'] || '').trim();
          if (!name || !website.startsWith('http')) continue;
          const k = norm(name);
          if (existingKeys.has(k)) continue;

          const amenity = tags.amenity || 'restaurant';
          const cat = (amenity === 'bar') ? 'Nightlife & Bars' : (amenity === 'arts_centre' || amenity === 'theatre') ? 'Arts & Culture' : 'Food & Drink';
          const suburb = tags['addr:suburb'] || chosen[0].name;
          const cuisine = tags.cuisine ? tags.cuisine.replace(/;/g, ', ') : 'local favourites';

          const newEv = {
            id: `osm-live-${el.id}`,
            title: `${name}: ${suburb} Date Spot`,
            description: tags.description || `Discover ${name} in ${suburb} — a verified local Brisbane venue known for ${cuisine}.`,
            insider_tip: tags.opening_hours ? `Opening hours: ${tags.opening_hours}` : `Check ${name}'s official website for bookings and menus.`,
            category: cat,
            location: `${suburb}, Brisbane`,
            time_str: tags.opening_hours || 'Open Weekly · Check website for hours',
            start_date: null,
            end_date: null,
            ongoing: true,
            price: '$$',
            source: 'Brisbane Live Map',
            source_url: website,
            image_url: cat === 'Nightlife & Bars'
              ? 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&w=900&q=80'
              : 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=900&q=80',
            tags: [suburb, cat, 'Live Pull']
          };
          if (this.hasValidSourceUrl(newEv)) {
            existingKeys.add(k);
            livePool.push(newEv);
            newlyDiscovered++;
          }
        }
      }
    } catch (e) {
      // Overpass API unreachable or blocked — ignore gracefully
    }

    window.LIVE_FEED_EVENTS = livePool;
    try {
      localStorage.setItem('twodo_daily_live_events', JSON.stringify(livePool.slice(-60)));
      localStorage.setItem('twodo_last_daily_pull', today);
    } catch (e) {}

    // Badge & Push Notification when new events are pulled for this week
    if (newlyDiscoveredThisWeek > 0) {
      try {
        const cur = parseInt(localStorage.getItem('twodo_new_this_week_count') || '0', 10) || 0;
        localStorage.setItem('twodo_new_this_week_count', (cur + newlyDiscoveredThisWeek).toString());
      } catch (e) {}

      if (typeof app !== 'undefined' && app.updateThisWeekBadges) {
        app.updateThisWeekBadges();
      }

      const notifMsg = 'New events have been added to this week, go and a look 🙂';
      if (typeof notifications !== 'undefined') {
        if (notifications.sendNotification) {
          notifications.sendNotification('✨ TwoDo', {
            body: notifMsg,
            icon: '/icons/icon-192.png',
            data: { tab: 'discover' }
          });
        }
        if (notifications.sendRemotePush) {
          notifications.sendRemotePush({
            title: '✨ TwoDo',
            message: notifMsg,
            tab: 'discover'
          });
        }
      }
    }

    return { skipped: false, date: today, newly_discovered_count: newlyDiscovered, newly_discovered_this_week: newlyDiscoveredThisWeek };
  },

  async refreshEvents(city, lat = null, lng = null) {
    let backendResult = null;
    if (this.serverAvailable !== false) {
      try {
        const res = await this.safeFetch(`${this.baseUrl}/api/events/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ city, lat, lng }),
          timeout: 4000
        });
        backendResult = await res.json();
      } catch (e) {
        this.serverAvailable = false;
      }
    }

    const pullRes = await this.autoDailyPull(true);
    const all = this.getLocalEnrichedEvents();
    const totalCount = all.count || all.events.length;
    const addedCount = (pullRes && pullRes.newly_discovered_count) || 0;
    const areaCount = (window.EVENTS_CATALOG_META && window.EVENTS_CATALOG_META.areas)
      ? Object.keys(window.EVENTS_CATALOG_META.areas).length
      : 15;

    return {
      events: all.events,
      newly_discovered_count: backendResult?.newly_discovered_count || addedCount,
      total_count: totalCount,
      last_pull_date: this.todayYMD(),
      message: `Synced ${totalCount} unique, link-verified events across ${areaCount} Greater Brisbane areas!`
    };
  },

  // ---------------------------------------------------------------------------
  // VOTING API (Supports Love Notes!)
  // ---------------------------------------------------------------------------
  async vote(eventId, userName, vote, note = null) {
    let votes = {};
    let notes = {};
    try {
      votes = JSON.parse(localStorage.getItem('twodo_votes') || '{}');
      notes = JSON.parse(localStorage.getItem('twodo_notes') || '{}');
    } catch (e) {}

    votes[`${eventId}_${userName}`] = vote;
    localStorage.setItem('twodo_votes', JSON.stringify(votes));
    if (note !== null) {
      notes[`${eventId}_${userName}`] = note;
      localStorage.setItem('twodo_notes', JSON.stringify(notes));
    }

    const profile = JSON.parse(localStorage.getItem('twodo_profile') || '{"user1_name":"Emma","user2_name":"Jordan"}');
    const u1 = profile.user1_name || 'Emma';
    const u2 = profile.user2_name || 'Jordan';

    const v1 = votes[`${eventId}_${u1}`];
    const v2 = votes[`${eventId}_${u2}`];
    const n1 = notes[`${eventId}_${u1}`] || '';
    const n2 = notes[`${eventId}_${u2}`] || '';

    // STRICT MATCH RULE: Only both voting 'love' is a match!
    const isMatch = Boolean(v1 === 'love' && v2 === 'love');
    const matchLevel = isMatch ? 'double_love' : ((['love', 'maybe'].includes(v1) && ['love', 'maybe'].includes(v2)) ? 'mutual_interest' : 'none');

    const result = {
      success: true,
      event_id: eventId,
      user_name: userName,
      vote: vote,
      note: note,
      u1_vote: v1,
      u2_vote: v2,
      u1_note: n1,
      u2_note: n2,
      is_match: isMatch,
      match_level: matchLevel
    };

    if (this.serverAvailable === false) {
      return result;
    }

    try {
      const res = await this.safeFetch(`${this.baseUrl}/api/votes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: eventId, user_name: userName, vote, note })
      });
      return await res.json();
    } catch (e) {
      this.serverAvailable = false;
      return result;
    }
  },

  // ---------------------------------------------------------------------------
  // COUPLE CHAT API (Emma & Jordan Private Chat)
  // ---------------------------------------------------------------------------
  async getChatMessages() {
    if (this.serverAvailable === false) {
      if (typeof firebaseService !== 'undefined' && firebaseService.messages && firebaseService.messages.length > 0) {
        return firebaseService.messages;
      }
      try {
        return JSON.parse(localStorage.getItem('twodo_chat_messages') || '[]');
      } catch (err) {
        return [];
      }
    }

    try {
      const res = await this.safeFetch(`${this.baseUrl}/api/chat`);
      const data = await res.json();
      if (data && Array.isArray(data.messages)) {
        localStorage.setItem('twodo_chat_messages', JSON.stringify(data.messages));
        return data.messages;
      }
      throw new Error('Invalid chat payload');
    } catch (e) {
      this.serverAvailable = false;
      try {
        return JSON.parse(localStorage.getItem('twodo_chat_messages') || '[]');
      } catch (err) {
        return [];
      }
    }
  },

  async sendChatMessage(senderName, text, activity = null) {
    const payload = {
      sender_name: senderName,
      text: text,
      activity_id: activity ? activity.id : null,
      activity_title: activity ? activity.title : null,
      activity_image: activity ? activity.image_url : null
    };

    if (this.serverAvailable === false) {
      const localMsg = {
        id: 'msg-' + Date.now(),
        sender_name: senderName,
        text: text,
        activity_id: payload.activity_id,
        activity_title: payload.activity_title,
        activity_image: payload.activity_image,
        created_at: new Date().toISOString()
      };
      let msgs = [];
      try {
        msgs = JSON.parse(localStorage.getItem('twodo_chat_messages') || '[]');
      } catch (err) {}
      msgs.push(localMsg);
      localStorage.setItem('twodo_chat_messages', JSON.stringify(msgs));
      return localMsg;
    }

    try {
      const res = await this.safeFetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data && data.message) {
        let msgs = [];
        try {
          msgs = JSON.parse(localStorage.getItem('twodo_chat_messages') || '[]');
        } catch (err) {}
        msgs.push(data.message);
        localStorage.setItem('twodo_chat_messages', JSON.stringify(msgs));
        return data.message;
      }
      throw new Error('Message send failed');
    } catch (e) {
      this.serverAvailable = false;
      const localMsg = {
        id: Date.now(),
        sender_name: senderName,
        text: text,
        activity_id: payload.activity_id,
        activity_title: payload.activity_title,
        activity_image: payload.activity_image,
        created_at: new Date().toISOString()
      };
      let msgs = [];
      try {
        msgs = JSON.parse(localStorage.getItem('twodo_chat_messages') || '[]');
      } catch (err) {}
      msgs.push(localMsg);
      localStorage.setItem('twodo_chat_messages', JSON.stringify(msgs));
      return localMsg;
    }
  },

  // ---------------------------------------------------------------------------
  // PLANNER API
  // ---------------------------------------------------------------------------
  async getPlanner() {
    // One-time client purge of hardcoded legacy demo plans (Eat Street & Rooftop Cinema)
    if (!localStorage.getItem('twodo_purged_demo_plans_v2')) {
      try {
        let cached = JSON.parse(localStorage.getItem('twodo_planner') || '[]');
        cached = cached.filter(i => i.event_id !== 'bne-eat-street' && i.event_id !== 'bne-rooftop-cinema' && i.id !== 1 && i.id !== 2);
        localStorage.setItem('twodo_planner', JSON.stringify(cached));
      } catch (err) {}
      localStorage.setItem('twodo_purged_demo_plans_v2', 'true');
    }

    if (this.serverAvailable === false) {
      let items = [];
      if (typeof firebaseService !== 'undefined' && firebaseService.plannerItems && firebaseService.plannerItems.length > 0) {
        items = firebaseService.plannerItems;
      } else {
        try {
          items = JSON.parse(localStorage.getItem('twodo_planner') || '[]');
          items = items.filter(i => i.event_id !== 'bne-eat-street' && i.event_id !== 'bne-rooftop-cinema');
        } catch (err) {}
      }
      return { items: items, count: items.length };
    }

    try {
      const res = await this.safeFetch(`${this.baseUrl}/api/planner`);
      const data = await res.json();
      if (data && Array.isArray(data.items)) {
        // Strip any residual demo events
        data.items = data.items.filter(i => i.event_id !== 'bne-eat-street' && i.event_id !== 'bne-rooftop-cinema');
        data.count = data.items.length;
        localStorage.setItem('twodo_planner', JSON.stringify(data.items));
        return data;
      }
      throw new Error('Invalid planner payload');
    } catch (e) {
      this.serverAvailable = false;
      let items = [];
      try {
        items = JSON.parse(localStorage.getItem('twodo_planner') || '[]');
        items = items.filter(i => i.event_id !== 'bne-eat-street' && i.event_id !== 'bne-rooftop-cinema');
      } catch (err) {}
      return { items: items, count: items.length };
    }
  },

  async addToPlanner(payload) {
    let items = [];
    try {
      items = JSON.parse(localStorage.getItem('twodo_planner') || '[]');
    } catch (e) {}

    // Find event details from preloaded catalog or custom events
    const allKnown = [
      ...(typeof PRELOADED_EVENTS !== 'undefined' ? PRELOADED_EVENTS : []),
      ...(typeof window !== 'undefined' && Array.isArray(window.LIVE_FEED_EVENTS) ? window.LIVE_FEED_EVENTS : []),
      ...(() => { try { return JSON.parse(localStorage.getItem('twodo_custom_events') || '[]'); } catch (e) { return []; } })()
    ];
    const ev = allKnown.find(e => e && String(e.id) === String(payload.event_id)) || {};

    const newItem = {
      id: Date.now(),
      event_id: payload.event_id,
      status: payload.status || 'bucket_list',
      scheduled_date: payload.scheduled_date || null,
      time_slot: payload.time_slot || 'evening',
      notes: payload.notes || '',
      budget: payload.budget || '',
      title: ev.title || payload.title || 'Couple Activity',
      description: ev.description || '',
      category: ev.category || 'General',
      location_name: ev.location || ev.location_name || '',
      location: ev.location || ev.location_name || '',
      source: ev.source || '',
      source_url: ev.source_url || '',
      time_str: ev.time_str || '',
      start_date: ev.start_date || null,
      end_date: ev.end_date || null,
      ongoing: Boolean(ev.ongoing),
      image_url: ev.image_url || 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80',
      price_str: ev.price || ev.price_str || '$$',
      insider_tip: ev.insider_tip || '',
      tags: ev.tags || [],
      created_at: new Date().toISOString()
    };

    items = items.filter(i => i.event_id !== payload.event_id);
    items.unshift(newItem);
    localStorage.setItem('twodo_planner', JSON.stringify(items));

    if (this.serverAvailable === false) {
      return { success: true, item: newItem };
    }

    try {
      const res = await this.safeFetch(`${this.baseUrl}/api/planner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return await res.json();
    } catch (e) {
      this.serverAvailable = false;
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

    if (this.serverAvailable === false) {
      return { success: true };
    }

    try {
      const res = await this.safeFetch(`${this.baseUrl}/api/planner/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return await res.json();
    } catch (e) {
      this.serverAvailable = false;
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

    if (this.serverAvailable === false) {
      return { success: true };
    }

    try {
      const res = await this.safeFetch(`${this.baseUrl}/api/planner/${id}`, {
        method: 'DELETE'
      });
      return await res.json();
    } catch (e) {
      this.serverAvailable = false;
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

    if (this.serverAvailable === false) {
      return { success: true, event: customEv };
    }

    try {
      const res = await this.safeFetch(`${this.baseUrl}/api/events/custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return await res.json();
    } catch (e) {
      this.serverAvailable = false;
      return { success: true, event: customEv };
    }
  },

  async getSummary() {
    if (this.serverAvailable === false) {
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

    try {
      const res = await this.safeFetch(`${this.baseUrl}/api/export/summary`);
      return await res.json();
    } catch (e) {
      this.serverAvailable = false;
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

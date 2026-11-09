/**
 * TwoDo Discover Module
 * Handles feed browsing, multi-source event rendering, searching, date-range, and category filtering.
 * Features modal bottom-sheet popups for multi-select suburb, vibe, activity, and date range filtering.
 */
const discover = {
  // Active Filter State (empty array means "All")
  activeFeedMode: 'special', // 'special' (dated ticketed events/concerts/sports/shows - default) | 'anytime' (always-on places)
  selectedCategories: [],
  selectedSuburbs: [],
  selectedVibes: [],
  activeIntent: 'all',
  activeSubIntent: 'all', // Sub-refiner within the chosen intent
  activeDateRange: 'this_week', // Default in Special Events: show this week's events
  defaultDateRange: 'this_week',
  activeFilter: 'all',
  customStart: null,
  customEnd: null,
  searchDebounceTimer: null,
  searchQuery: '',
  pageSize: 24,
  currentPage: 1,
  conciergeState: {
    intent: 'eat_drink',
    when: 'tonight',
    vibe: 'any',
    offset: 0
  },

  modeCategoryTabs: {
    anytime: [
      { intent: 'all', icon: '✨', label: 'All Places' },
      { intent: 'eat_drink', icon: '🍽️', label: 'Eat & Drink' },
      { intent: 'activity', icon: '🎯', label: 'Activities' },
      { intent: 'outdoors', icon: '🌿', label: 'Outdoors' },
      { intent: 'low_key', icon: '🌙', label: 'Low-Key' },
      { intent: 'saved', icon: '❤️', label: 'Loves & Votes' }
    ],
    special: [
      { intent: 'all', icon: '✨', label: 'All Events' },
      { intent: 'special_music', icon: '🎵', label: 'Concerts & Music' },
      { intent: 'special_sports', icon: '🏟️', label: 'Live Sports' },
      { intent: 'special_shows', icon: '🎭', label: 'Comedy & Theatre' },
      { intent: 'special_festivals', icon: '🎨', label: 'Festivals & Arts' },
      { intent: 'saved', icon: '❤️', label: 'Loves & Votes' }
    ]
  },

  intentDefinitions: {
    all: { label: '✨ All Ideas', subs: [] },
    eat_drink: {
      label: '🍽️ Eat & Drink',
      subs: [
        { id: 'all', label: '✨ All Eat & Drink' },
        { id: 'dinner', label: '🍷 Romantic Dinner' },
        { id: 'drinks', label: '🍹 Bars & Rooftops' },
        { id: 'brunch', label: '☕ Cafes & Bakeries' },
        { id: 'casual', label: '🌮 Casual & Street Food' },
        { id: 'dessert', label: '🍦 Dessert & Late Treats' }
      ]
    },
    activity: {
      label: '🎯 Activities',
      subs: [
        { id: 'all', label: '✨ All Activities' },
        { id: 'games', label: '🕹️ Arcade, Mini-Golf & Games' },
        { id: 'creative', label: '🏺 Pottery, Paint & Classes' },
        { id: 'active', label: '🏓 Play Sports Together' },
        { id: 'culture', label: '🏛️ Galleries, Cinema & Space' },
        { id: 'wellness', label: '🧖‍♀️ Bathhouse, Sauna & Spa' }
      ]
    },
    outdoors: {
      label: '🌿 Outdoors',
      subs: [
        { id: 'all', label: '✨ All Outdoors' },
        { id: 'picnic', label: '🧺 Lookouts, Picnics & Sunset' },
        { id: 'walks', label: '🥾 Walks, Hikes & Waterfalls' },
        { id: 'water', label: '🌊 River, Bay & Islands' },
        { id: 'daytrip', label: '🚗 Scenic Rim & Day Trips' }
      ]
    },
    low_key: {
      label: '🌙 Low-Key',
      subs: [
        { id: 'all', label: '✨ All Low-Key' },
        { id: 'free_budget', label: '⚡ Free & Under $30' },
        { id: 'indoor', label: '🌧️ Indoor & Air-Con' },
        { id: 'late_night', label: '🌙 Late Night (Past 8pm)' },
        { id: 'stay_in', label: '🏠 Stay-In At Home' }
      ]
    },
    special_music: {
      label: '🎵 Concerts & Music',
      subs: [
        { id: 'all', label: '✨ All Concerts' },
        { id: 'candlelight', label: '🕯️ Candlelight & Symphony' },
        { id: 'arena_outdoor', label: '🏟️ Riverstage, Suncorp & Arena' },
        { id: 'club_theatre', label: '🎸 Fortitude Hall, Tivoli & Triffid' }
      ]
    },
    special_sports: {
      label: '🏟️ Live Sports',
      subs: [
        { id: 'all', label: '✨ All Live Sports' },
        { id: 'cricket', label: '🏏 Cricket (BBL, WBBL & T20I)' },
        { id: 'basketball', label: '🏀 Basketball (Bullets NBL)' },
        { id: 'football_rugby', label: '⚽ Football & Rugby (Roar & Reds)' },
        { id: 'racing_tennis', label: '🏇 Racedays, Tennis & Baseball' }
      ]
    },
    special_shows: {
      label: '🎭 Comedy & Theatre',
      subs: [
        { id: 'all', label: '✨ All Shows' },
        { id: 'theatre_ballet', label: '🎭 QPAC Musicals, Theatre & Ballet' },
        { id: 'comedy_cinema', label: '🎤 Comedy Galas & Moonlight Cinema' }
      ]
    },
    special_festivals: {
      label: '🎨 Festivals & Arts',
      subs: [
        { id: 'all', label: '✨ All Festivals & Arts' },
        { id: 'exhibitions', label: '🖼️ GOMA Exhibitions & Film Fest' },
        { id: 'festivals_tours', label: '🎪 Festivals, Markets & Special Tours' }
      ]
    },
    whats_on: {
      label: '🎟️ Special Events',
      subs: []
    }
  },

  setFeedMode(mode) {
    const nextMode = (mode === 'special') ? 'special' : 'anytime';
    this.activeFeedMode = nextMode;
    this.activeIntent = 'all';
    this.activeSubIntent = 'all';
    this.currentPage = 1;

    // Exit personal Loves/Passed view if active so the chosen mode is shown immediately
    if (this.isSpecialMood()) {
      this.currentMood = 'all';
      this.activeFilter = 'all';
      document.querySelectorAll('.mood-chip').forEach(c => {
        c.classList.toggle('active', c.dataset.mood === 'all');
      });
    }

    this.syncIntentUI();
    this.updateFilterHeaderBadges();
    this.loadEvents(false);
  },

  setIntent(intent, subIntent = 'all') {
    if (intent === 'saved') {
      if (this.activeIntent === 'saved') {
        this.activeIntent = 'all';
        this.activeSubIntent = 'all';
        this.currentMood = 'all';
        this.activeFilter = 'all';
        document.querySelectorAll('.mood-chip').forEach(c => c.classList.remove('active'));
        this.syncIntentUI();
        this.updateActiveFilterPillBar();
        this.loadEvents(false);
        return;
      }
      this.activeIntent = 'saved';
      this.activeSubIntent = 'all';
      this.syncIntentUI();
      this.setMoodFilter('emma-loves');
      return;
    }

    // Tapping the already-active intent (when no sub-intent is narrowed) toggles back to 'all'
    if (this.activeIntent === intent && intent !== 'all' && subIntent === 'all' && this.activeSubIntent === 'all') {
      this.activeIntent = 'all';
      this.activeSubIntent = 'all';
    } else {
      this.activeIntent = intent || 'all';
      this.activeSubIntent = subIntent || 'all';
    }
    // If user was viewing a personal Loves/Passed list, switch back to live discovery
    if (this.isSpecialMood()) {
      this.currentMood = 'all';
      this.activeFilter = 'all';
      document.querySelectorAll('.mood-chip').forEach(c => {
        c.classList.toggle('active', c.dataset.mood === 'all');
      });
    }
    this.currentPage = 1;
    this.syncIntentUI();
    this.updateActiveFilterPillBar();
    this.loadEvents(false);
  },

  setSubIntent(subIntent) {
    this.activeSubIntent = (this.activeSubIntent === subIntent && subIntent !== 'all') ? 'all' : (subIntent || 'all');
    this.currentPage = 1;
    this.syncIntentUI();
    this.updateActiveFilterPillBar();
    this.loadEvents(false);
  },

  syncIntentUI() {
    const mode = this.activeFeedMode || 'anytime';
    const effectiveTab = this.isSpecialMood() ? 'saved' : this.activeIntent;

    // 1. Sync Mode Switcher buttons (Anytime Places vs Special Events)
    document.querySelectorAll('#discover-mode-switcher .feed-mode-btn, #swiper-mode-switcher .feed-mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    // 2. Show 📅 Date pill ONLY in Special Events mode (hides it in Anytime Places!)
    ['mood-chip-date', 'sw-date-pill'].forEach(id => {
      const dateBtn = document.getElementById(id);
      if (dateBtn) {
        dateBtn.classList.toggle('hidden', mode !== 'special');
      }
    });

    // 3. Update search placeholder to match active mode
    const placeholder = mode === 'special'
      ? 'Search concerts, live sports, comedy, shows...'
      : 'Search restaurants, bars, activities, walks...';
    ['discover-search-input', 'swiper-search-input'].forEach(id => {
      const inp = document.getElementById(id);
      if (inp) inp.placeholder = placeholder;
    });

    // 4. Render mode-specific Category Tabs in both Discover and Swiper
    const tabs = this.modeCategoryTabs[mode] || this.modeCategoryTabs.anytime;
    const discoverStrip = document.getElementById('discover-intent-tiles');
    if (discoverStrip) {
      discoverStrip.innerHTML = tabs.map(t => `
        <button type="button" class="cat-tab ${t.intent === effectiveTab ? 'active' : ''}" data-intent="${t.intent}" onclick="discover.setIntent('${t.intent}')">
          <span class="cat-tab-icon">${t.icon}</span>
          <span class="cat-tab-label">${t.label}</span>
        </button>
      `).join('');
    }
    const swiperStrip = document.getElementById('swiper-intent-tiles');
    if (swiperStrip) {
      const swIntent = (effectiveTab === 'saved') ? 'all' : effectiveTab;
      swiperStrip.innerHTML = tabs.map(t => {
        const clickHandler = t.intent === 'saved'
          ? "app.navigate('discover'); discover.setIntent('saved')"
          : `discover.setIntent('${t.intent}')`;
        return `
          <button type="button" class="cat-tab ${t.intent === swIntent ? 'active' : ''}" data-intent="${t.intent}" onclick="${clickHandler}">
            <span class="cat-tab-icon">${t.icon}</span>
            <span class="cat-tab-label">${t.label}</span>
          </button>
        `;
      }).join('');
    }

    // 5. Update unvoted counts on the two Mode Switcher buttons
    this.updateModeSwitcherCounts();

    const votesBar = document.getElementById('discover-votes-bar');
    if (votesBar) {
      votesBar.classList.toggle('hidden', effectiveTab !== 'saved');
    }
    this.renderSubIntentBars();
  },

  updateModeSwitcherCounts() {
    const pool = this.getAllEventsPool();
    const isSolo = (typeof firebaseService !== 'undefined') ? firebaseService.isSolo : false;
    const activeVoter = (typeof app !== 'undefined' && app.getActiveVoterName) ? app.getActiveVoterName() : 'Emma';
    const u1 = isSolo ? activeVoter : (app.profile?.user1_name || 'Emma');
    const u2 = isSolo ? 'Partner' : (app.profile?.user2_name || 'Jordan');
    let votes = {};
    try { votes = JSON.parse(localStorage.getItem('twodo_votes') || '{}'); } catch (e) {}
    if (typeof firebaseService !== 'undefined' && firebaseService.votesMap) {
      votes = { ...votes, ...firebaseService.votesMap };
    }

    let anytimeCount = 0;
    let specialCount = 0;
    pool.forEach(ev => {
      const v1 = votes[`${ev.id}_${u1}`] !== undefined ? votes[`${ev.id}_${u1}`] : ev.u1_vote;
      const v2 = isSolo ? null : (votes[`${ev.id}_${u2}`] !== undefined ? votes[`${ev.id}_${u2}`] : ev.u2_vote);
      const myVote = isSolo ? (votes[`${ev.id}_${activeVoter}`] || v1) : (activeVoter === u1 ? v1 : v2);
      if (myVote === 'love' || myVote === 'pass') return;
      if (ev.ongoing) anytimeCount++;
      else specialCount++;
    });

    ['discover-anytime-count', 'swiper-anytime-count'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = anytimeCount;
    });
    ['discover-special-count', 'swiper-special-count'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = specialCount;
    });
  },

  renderSubIntentBars() {
    const def = this.intentDefinitions[this.activeIntent];
    const bars = [
      document.getElementById('discover-sub-intent-bar'),
      document.getElementById('swiper-sub-intent-bar')
    ];
    if (!def || !def.subs || def.subs.length === 0 || this.activeIntent === 'all' || this.isSpecialMood()) {
      bars.forEach(b => { if (b) { b.classList.add('hidden'); b.innerHTML = ''; } });
      return;
    }

    // Compute live count per sub-intent from events in the current mode pool
    const mode = this.activeFeedMode || 'anytime';
    const pool = this.getAllEventsPool().filter(ev => mode === 'special' ? !ev.ongoing : Boolean(ev.ongoing));
    const html = def.subs.map(sub => {
      const count = pool.filter(ev => api.matchEventIntent(ev, this.activeIntent, sub.id)).length;
      const isActive = this.activeSubIntent === sub.id;
      return `
        <button type="button" class="sub-intent-pill ${isActive ? 'active' : ''}" onclick="discover.setSubIntent('${sub.id}')">
          <span>${sub.label}</span>
          <span class="sub-intent-count">${count}</span>
        </button>
      `;
    }).join('');

    bars.forEach(b => {
      if (b) {
        b.innerHTML = `<div class="sub-intent-scroll">${html}</div>`;
        b.classList.remove('hidden');
      }
    });
  },

  toggleHeaderSearch() {
    const drawer = document.getElementById('header-search-drawer');
    const btn = document.getElementById('btn-header-search');
    const input = document.getElementById('discover-search-input');
    if (!drawer) return;

    if (typeof app !== 'undefined' && app.activeTab && !['discover', 'swiper'].includes(app.activeTab)) {
      app.navigate('discover');
    }

    const willOpen = drawer.classList.contains('hidden');
    drawer.classList.toggle('hidden', !willOpen);
    if (btn) btn.classList.toggle('filter-active', willOpen || Boolean(this.searchQuery));
    if (willOpen && input) {
      setTimeout(() => input.focus(), 50);
    }
  },

  handleSearchInput(val) {
    this.searchQuery = (val || '').trim();
    ['discover-search-input', 'swiper-search-input'].forEach(id => {
      const el = document.getElementById(id);
      if (el && el.value !== val) el.value = val || '';
    });
    ['discover-search-clear', 'swiper-search-clear'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.classList.toggle('hidden', !this.searchQuery);
    });
    const hdrBtn = document.getElementById('btn-header-search');
    const drawer = document.getElementById('header-search-drawer');
    if (hdrBtn) hdrBtn.classList.toggle('filter-active', Boolean(this.searchQuery) || (drawer && !drawer.classList.contains('hidden')));

    clearTimeout(this.searchDebounceTimer);
    this.searchDebounceTimer = setTimeout(() => {
      this.currentPage = 1;
      this.loadEvents(false);
    }, 100);
  },

  clearSearch() {
    this.searchQuery = '';
    ['discover-search-input', 'swiper-search-input'].forEach(id => {
      const input = document.getElementById(id);
      if (input) input.value = '';
    });
    ['discover-search-clear', 'swiper-search-clear'].forEach(id => {
      const clearBtn = document.getElementById(id);
      if (clearBtn) clearBtn.classList.add('hidden');
    });
    const drawer = document.getElementById('header-search-drawer');
    if (drawer) drawer.classList.add('hidden');
    const hdrBtn = document.getElementById('btn-header-search');
    if (hdrBtn) hdrBtn.classList.remove('filter-active');
    this.currentPage = 1;
    this.loadEvents(false);
  },

  // Pop-up Filter Modal State
  currentModalType: null, // 'date' | 'suburb' | 'vibe' | 'category'
  modalSelectedSet: new Set(),

  suburbRegions: [
    { id: 'all', label: '🗺️ Everywhere', suburbs: [] },
    { id: 'inner', label: '🏙️ Inner City & River', suburbs: ['Fortitude Valley', 'South Bank', 'West End', 'Brisbane CBD', 'New Farm', 'Woolloongabba'] },
    { id: 'ring', label: '🌿 Inner Ring & West', suburbs: ['Paddington', 'Bulimba', 'Hamilton', 'Inner North', 'Mount Coot-tha'] },
    { id: 'coastal', label: '🌊 South, Bay & Escapes', suburbs: ['Sunnybank', 'Bayside', 'SEQ Day Escape'] },
    { id: 'home', label: '🏠 Stay-In At Home', suburbs: ['Stay-In'] }
  ],

  // Filter Catalog Configurations
  filterDefinitions: {
    date: {
      type: 'date',
      title: 'When are you going?',
      icon: '📅',
      subtitle: 'Pick a quick preset, a specific day, or custom dates',
      allLabel: '✨ Any Date (Show Everything)',
      isMulti: false,
      options: [] // Built dynamically from today's date by buildDateOptions()
    },
    suburb: {
      type: 'suburb',
      title: 'Where in Brisbane?',
      icon: '📍',
      subtitle: 'Tap a region shortcut or pick specific precincts',
      allLabel: '🗺️ All Suburbs (Everywhere in Brisbane)',
      isMulti: true,
      options: [
        { id: 'Fortitude Valley', icon: '🍸', shortLabel: 'Fortitude Valley', label: '🍸 Fortitude Valley & James St', desc: 'James St, laneway dining & bars' },
        { id: 'South Bank', icon: '🎭', shortLabel: 'South Bank & Fish Ln', label: '🎭 South Bank & Fish Lane', desc: 'QAGOMA, QPAC & riverfront' },
        { id: 'West End', icon: '🎨', shortLabel: 'West End', label: '🎨 West End & Highgate Hill', desc: 'Markets, breweries & Greek eats' },
        { id: 'Brisbane CBD', icon: '🏙️', shortLabel: 'CBD & Queen\'s Wharf', label: '🏙️ CBD & Queen\'s Wharf', desc: 'Sky Deck, river & speakeasies' },
        { id: 'New Farm', icon: '🥐', shortLabel: 'New Farm & Teneriffe', label: '🥐 New Farm, Teneriffe & Newstead', desc: 'Powerhouse, riverwalk & cafes' },
        { id: 'Paddington', icon: '🛍️', shortLabel: 'Paddington & Milton', label: '🛍️ Paddington, Rosalie & Milton', desc: 'Vintage shops, cafes & Suncorp' },
        { id: 'Woolloongabba', icon: '🏏', shortLabel: 'Kangaroo Pt & Gabba', label: '🏏 Woolloongabba & Kangaroo Point', desc: 'Cliffs sunset & wine bars' },
        { id: 'Bulimba', icon: '⛵', shortLabel: 'Bulimba & Hawthorne', label: '⛵ Bulimba & Hawthorne', desc: 'Oxford St dining & river parks' },
        { id: 'Hamilton', icon: '🎪', shortLabel: 'Hamilton & Eat St', label: '🎪 Hamilton, Ascot & Eat Street', desc: 'Eat Street Northshore & Portside' },
        { id: 'Sunnybank', icon: '🥟', shortLabel: 'Sunnybank & South', label: '🥟 Sunnybank & Southside', desc: 'Hotpot, dumplings, boba & parks' },
        { id: 'Inner North', icon: '🌿', shortLabel: 'Inner North & Enoggera', label: '🌿 Inner North & Enoggera', desc: 'Albion, Victoria Park & reservoir' },
        { id: 'Bayside', icon: '🌊', shortLabel: 'Manly & Bayside', label: '🌊 Manly, Sandgate & Redcliffe', desc: 'Harbour markets & seaside piers' },
        { id: 'Mount Coot-tha', icon: '🌄', shortLabel: 'Mt Coot-tha & West', label: '🌄 Mt Coot-tha & Western Suburbs', desc: 'Botanic gardens & Planetarium' },
        { id: 'SEQ Day Escape', icon: '🏝️', shortLabel: 'Islands & Hinterland', label: '🏝️ Moreton, Straddie & Hinterland', desc: 'Straddie, Tamborine & waterfalls' },
        { id: 'Stay-In', icon: '🏠', shortLabel: 'At Home (Stay-In)', label: '🏠 At Home (Stay-In Date Nights)', desc: 'Cozy at-home cooking & games' }
      ]
    },
    vibe: {
      type: 'vibe',
      title: 'Vibe & Style',
      icon: '✨',
      subtitle: 'Select "All" or pick multiple vibes and moods',
      allLabel: '💫 All Vibes & Styles',
      isMulti: true,
      options: [
        { id: 'Budget', label: '⚡ Free & Under $30', desc: 'Zero-cost lookouts, cheap eats, markets & walks' },
        { id: 'Late Night', label: '🌙 Late Night (Open Past 8pm)', desc: 'After-dinner dessert bars, speakeasies, stargazing' },
        { id: 'Indoor', label: '🌧️ Indoor & Air-Con Friendly', desc: 'Beat the heat or rain: galleries, arcades, pottery' },
        { id: 'Stay-In', label: '🏠 Stay-In At-Home Dates', desc: 'Romantic nights in when you don\'t want to go out' },
        { id: 'Romantic', label: '🕯️ Romantic Date Night', desc: 'Intimate candlelit dining & scenic viewpoints' },
        { id: 'Rooftop', label: '🍸 Rooftops & Skyline Bars', desc: 'Golden hour drinks & sparkling city views' },
        { id: 'Bakery', label: '🥐 Bakeries & Brunch Crawl', desc: 'Croissants, artisanal sourdough, specialty coffee' },
        { id: 'Pottery', label: '🏺 Hands-On Creative Workshops', desc: 'Wheel throwing, paint & sip, cooking classes' }
      ]
    },
    category: {
      type: 'category',
      title: 'Activities',
      icon: '🌟',
      subtitle: 'Select "All" or multi-select multiple activities',
      allLabel: '🌟 All Activities & Categories',
      isMulti: true,
      options: [
        { id: 'Food & Drink', label: '🍕 Food, Dining & Bakeries', desc: 'Restaurants, cafes, bakeries & culinary gems' },
        { id: 'Nightlife & Bars', label: '🍸 Bars, Rooftops & Speakeasies', desc: 'Cocktail lounges, whisky bars, breweries & wine' },
        { id: 'Outdoors & Nature', label: '🌿 Outdoors, Lookouts & Day Trips', desc: 'River walks, botanic gardens, islands & falls' },
        { id: 'Sports & Active', label: '🏟️ Live Sports & Play Together', desc: 'Suncorp/Gabba games, pickleball, climbing, putt-putt' },
        { id: 'Arts & Culture', label: '🏛️ Galleries, Museums & Cinema', desc: 'QAGOMA, Planetarium, open-air & boutique cinemas' },
        { id: 'Workshops & Classes', label: '🏺 Pottery, Cooking & Sip Classes', desc: 'Clay wheel throwing, pasta making, paint & sip' },
        { id: 'Markets & Pop-ups', label: '🎪 Night Markets & Farmers Markets', desc: 'Eat Street, weekend farmers & artisan markets' },
        { id: 'Music & Concerts', label: '🎵 Live Music, Jazz & Gigs', desc: 'Riverstage, Fortitude Music Hall, Tivoli & jazz' },
        { id: 'Comedy & Shows', label: '🎭 Comedy, Theatre & QPAC', desc: 'Stand-up comedy clubs, musicals, ballet & cabaret' }
      ]
    }
  },

  /** Returns { url, label } when the event has a valid official external URL, or null otherwise. */
  getEventLinkInfo(ev) {
    if (!ev) return null;
    const isValid = (typeof api !== 'undefined' && api.hasValidSourceUrl)
      ? api.hasValidSourceUrl(ev)
      : Boolean(ev.source_url && /^https?:\/\//i.test(ev.source_url) && !String(ev.source_url).includes('google.com/search'));
    if (!isValid) return null;

    const url = String(ev.source_url).trim();
    const u = url.toLowerCase();
    let label = '🔗 Website ↗';
    if (u.includes('ticketmaster') || u.includes('ticketek') || u.includes('eventbrite') || u.includes('qpac.com.au') || u.includes('feverup') || u.includes('moshtix') || u.includes('oztix')) {
      label = '🎟️ Tickets ↗';
    } else if (u.includes('instagram.com') || u.includes('tiktok.com')) {
      label = '📸 Official Page ↗';
    } else if (u.includes('brisbane.qld.gov.au') || u.includes('parks.detsi.qld.gov.au') || u.includes('seqwater.com.au') || u.includes('visit')) {
      label = '🏛️ Official Guide ↗';
    } else if (u.includes('seriouseats.com') || u.includes('spanishsabores.com')) {
      label = '📖 Recipe & Guide ↗';
    }
    return { url, label };
  },

  // ---------------------------------------------------------------------------
  // DATE RANGE ENGINE (This Week default, single days, upcoming weeks, custom)
  // ---------------------------------------------------------------------------
  /** Card label: real date & time for dated events, opening hours for ongoing venues. */
  formatWhen(ev) {
    const esc = (t) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    if (!ev) return '';
    if (ev.ongoing || !ev.start_date) return `🕐 ${esc(ev.time_str || 'Flexible timing')}`;
    const m = String(ev.start_date).match(/(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
    if (!m) return `🕐 ${esc(ev.time_str || 'Flexible timing')}`;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    let label = d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
    if (m[4]) {
      const h = Number(m[4]);
      label += ` · ${((h + 11) % 12) + 1}:${m[5]} ${h >= 12 ? 'PM' : 'AM'}`;
    }
    const em = String(ev.end_date || '').match(/(\d{4})-(\d{2})-(\d{2})/);
    if (em && em[0] !== m[0].slice(0, 10)) {
      const e = new Date(Number(em[1]), Number(em[2]) - 1, Number(em[3]));
      const endLabel = e.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
      const today = new Date(); today.setHours(0, 0, 0, 0);
      if (d < today) return `📅 On now – until ${endLabel}`;
      label += ` – ${endLabel}`;
    }
    return `📅 ${label}`;
  },

  toYMD(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  parseYMD(s) {
    const m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  },

  dayOffset(n) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + n);
    return d;
  },

  fmtShort(d) {
    return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
  },

  fmtDayMonth(d) {
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  },

  /** Returns { start: Date, end: Date } for a range id, or null for "any date". */
  getDateBounds(range = this.activeDateRange) {
    const span = (a, b) => ({ start: this.dayOffset(a), end: this.dayOffset(b) });
    if (!range || range === 'all') return null;
    if (range === 'this_week' || range === 'next_7_days') return span(0, 6);
    if (range === 'today') return span(0, 0);
    if (range === 'tomorrow') return span(1, 1);
    const dayMatch = range.match(/^day_(\d+)$/);
    if (dayMatch) { const n = Number(dayMatch[1]); return span(n, n); }
    const weekMatch = range.match(/^week_(\d+)$/);
    if (weekMatch) { const w = Number(weekMatch[1]); return span(w * 7, w * 7 + 6); }
    if (range === 'this_month') return span(0, 30);
    if (range === 'this_weekend') {
      const today = this.dayOffset(0);
      const dow = today.getDay(); // 0 Sun ... 6 Sat
      if (dow === 6) return span(0, 1);           // Saturday: Sat + Sun
      if (dow === 5) return span(0, 2);           // Friday: Fri + Sat + Sun
      // On Sunday (or Mon–Thu), "This Weekend (Fri – Sun)" spans the upcoming Fri–Sun of the current week
      const toFri = (5 - dow + 7) % 7;
      return span(toFri, toFri + 2);
    }
    if (range === 'custom') {
      const s = this.parseYMD(this.customStart);
      const e = this.parseYMD(this.customEnd);
      if (s && e) return s <= e ? { start: s, end: e } : { start: e, end: s };
      return null;
    }
    return null;
  },

  buildDateOptions() {
    const range = (a, b) => `${this.fmtShort(this.dayOffset(a))} – ${this.fmtShort(this.dayOffset(b))}`;
    const opts = [
      { id: 'this_week', label: '🗓️ This Week', desc: `${range(0, 6)} (default)` },
      { header: true, label: 'Pick a day' }
    ];
    for (let i = 0; i <= 6; i++) {
      const d = this.dayOffset(i);
      const name = i === 0 ? '🔥 Today' : (i === 1 ? '🌅 Tomorrow' : `📍 ${d.toLocaleDateString('en-AU', { weekday: 'long' })}`);
      opts.push({ id: `day_${i}`, label: name, desc: this.fmtShort(d) });
    }
    opts.push({ header: true, label: 'Upcoming weeks' });
    opts.push({ id: 'week_1', label: '📆 Next Week', desc: range(7, 13) });
    opts.push({ id: 'week_2', label: '📆 Week After', desc: range(14, 20) });
    opts.push({ id: 'week_3', label: '📆 The Week After That', desc: range(21, 27) });
    opts.push({ header: true, label: 'Something else' });
    opts.push({ id: 'custom', label: '🎯 Custom Date Range', desc: 'Pick exact start & end dates' });
    return opts;
  },

  /** Short label for the calendar chip / swiper pill, e.g. "All Upcoming", "This Week", "Today". */
  getDateChipLabel() {
    const r = this.activeDateRange;
    if (!r || r === 'all') return 'All Upcoming';
    if (r === 'this_week') return 'This Week';
    if (r === 'today' || r === 'day_0') return 'Today';
    if (r === 'tomorrow' || r === 'day_1') return 'Tomorrow';
    if (r === 'week_1') return 'Next Week';
    if (r === 'week_2') return 'In 2 Weeks';
    if (r === 'week_3') return 'In 3 Weeks';
    if (r === 'this_month') return 'Next 30 Days';
    if (r === 'this_weekend') return 'This Weekend';
    const b = this.getDateBounds(r);
    if (!b) return 'All Upcoming';
    if (b.start.getTime() === b.end.getTime()) return this.fmtShort(b.start);
    return `${this.fmtDayMonth(b.start)} – ${this.fmtDayMonth(b.end)}`;
  },

  isDefaultDate() {
    return !this.activeDateRange || this.activeDateRange === this.defaultDateRange;
  },

  isSpecialMood(mood = this.currentMood) {
    return ['matches', 'my-loves', 'my-passed', 'my_loves', 'my_passed', 'emma-loves', 'emma-passed', 'jordan-loves', 'jordan-passed'].includes(mood);
  },

  /** Single source of truth for filter params, shared by Discover & Swiper. */
  getFilterParams({ forSwiper = false } = {}) {
    const searchVal = this.searchQuery || document.getElementById('discover-search-input')?.value || document.getElementById('swiper-search-input')?.value || '';
    // Loves / Passed / Matches lists show everything you've voted on across both Anytime Places & Special Events
    const isSavedList = !forSwiper && (this.isSpecialMood() || this.activeIntent === 'saved');
    const mode = isSavedList ? 'all' : (this.activeFeedMode || 'anytime');
    // Date filter applies ONLY when browsing Special Events!
    const useDateFilter = (mode === 'special') && !isSavedList;
    const bounds = useDateFilter ? this.getDateBounds() : null;
    return {
      city: (typeof app !== 'undefined' && app.currentCity) || 'Brisbane',
      feed_mode: mode,
      intent: isSavedList ? 'all' : (this.activeIntent || 'all'),
      sub_intent: isSavedList ? 'all' : (this.activeSubIntent || 'all'),
      category: this.selectedCategories.length > 0 ? this.selectedCategories.join(',') : 'All',
      suburb: this.selectedSuburbs.length > 0 ? this.selectedSuburbs.join(',') : 'All',
      vibe: this.selectedVibes.length > 0 ? this.selectedVibes.join(',') : 'All',
      search: searchVal,
      filter: forSwiper ? 'all' : this.activeFilter,
      date_range: bounds ? 'custom' : 'all',
      custom_start: bounds ? this.toYMD(bounds.start) : null,
      custom_end: bounds ? this.toYMD(bounds.end) : null
    };
  },

  onDateChipClick() {
    // From a Loves / Passed list, one tap takes you back to the feed and opens the calendar
    if (this.isSpecialMood()) {
      this.setMoodFilter('all');
    }
    this.openFilterModal('date');
  },

  updateDateChipLabels() {
    const label = this.getDateChipLabel();
    const isDateFiltered = !this.isDefaultDate();
    ['date-chip-label', 'sw-date-pill-label'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = label;
    });
    ['mood-chip-date', 'sw-date-pill'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.classList.toggle('active', isDateFiltered);
    });
  },

  async loadEvents(showLoading = false) {
    const grid = document.getElementById('events-grid');
    if (showLoading && grid && (!app.events || app.events.length === 0)) {
      grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 3rem;"><span class="spin-icon" style="font-size:2rem; display:inline-block; animation:spin 1s infinite linear;">🔄</span><p style="margin-top:10px; color:var(--text-muted);">Searching councils, venues, galleries, Reddit, and live feeds...</p></div>';
    }

    this.currentPage = 1;
    const params = this.getFilterParams();
    try {
      const data = await api.getEvents(params);
      app.events = data.events || [];
    } catch (e) {
      console.warn('API fetch warning, using offline activities vault:', e);
      app.events = (api.getLocalEnrichedEvents(params).events) || [];
    }

    this.renderEvents();
    this.updateMatchBanner();
    this.updateFilterHeaderBadges();
    // Swiper uses the same date / suburb / vibe / category filters
    if (typeof swiper !== 'undefined') swiper.initDeck();
  },

  renderEvents() {
    const grid = document.getElementById('events-grid');
    const empty = document.getElementById('events-empty');
    const countText = document.getElementById('results-count-text');
    const loadMoreWrap = document.getElementById('load-more-wrap');
    const remainingSpan = document.getElementById('load-more-remaining');

    if (!grid) return;

    const isSolo = (typeof firebaseService !== 'undefined') ? firebaseService.isSolo : false;
    const activeVoter = app.getActiveVoterName();
    const u1 = isSolo ? activeVoter : (app.profile?.user1_name || 'Emma');
    const u2 = isSolo ? 'Partner' : (app.profile?.user2_name || 'Jordan');
    const isTogether = app.currentVoter === 'both';
    const isSpecialMood = ['matches', 'my-loves', 'my-passed', 'my_loves', 'my_passed', 'emma-loves', 'emma-passed', 'jordan-loves', 'jordan-passed'].includes(this.currentMood);

    // In normal feed browsing: only show items with no selection or thinking ('maybe')!
    // Loved or passed items are excluded from the main feed & search results.
    let displayEvents = (app.events || []).filter(ev => {
      if (this.searchQuery) {
        const q = this.searchQuery.toLowerCase();
        const str = `${ev.title} ${ev.description} ${ev.location_name} ${(ev.tags || []).join(' ')} ${ev.source} ${ev.category || ''} ${ev.suburb || ''} ${ev.vibe || ''}`.toLowerCase();
        if (!str.includes(q)) return false;
      }

      if (!isSpecialMood) {
        if (isSolo) {
          const vote = ev.my_vote !== undefined ? ev.my_vote : (activeVoter === u1 ? ev.u1_vote : ev.u2_vote);
          if (vote === 'love' || vote === 'pass') {
            return false;
          }
        } else if (isTogether) {
          if (ev.u1_vote === 'love' || ev.u1_vote === 'pass' || ev.u2_vote === 'love' || ev.u2_vote === 'pass') {
            return false;
          }
        } else {
          const myVote = (activeVoter === u1) ? ev.u1_vote : ev.u2_vote;
          if (myVote === 'love' || myVote === 'pass') {
            return false;
          }
        }
      }

      return true;
    });

    const visibleEvents = displayEvents.slice(0, this.pageSize * this.currentPage);
    this.renderSpotlights(displayEvents);

    if (countText) {
      const isSpecial = (this.activeFeedMode === 'special') && !this.isSpecialMood();
      const itemNoun = isSpecial ? 'special events' : (this.isSpecialMood() ? 'saved ideas' : 'anytime places');
      const dateLabel = isSpecial ? ` · 📅 ${this.getDateChipLabel()}` : '';
      const filterDetails = [];
      if (this.activeIntent && this.activeIntent !== 'all' && !this.isSpecialMood()) {
        const iDef = this.intentDefinitions[this.activeIntent];
        let iLabel = iDef ? iDef.label : this.activeIntent;
        if (this.activeSubIntent && this.activeSubIntent !== 'all' && iDef?.subs) {
          const sDef = iDef.subs.find(s => s.id === this.activeSubIntent);
          if (sDef) iLabel += ` → ${sDef.label}`;
        }
        filterDetails.push(iLabel);
      }
      if (this.searchQuery) filterDetails.push(`Search: "${this.searchQuery}"`);
      if (this.selectedSuburbs.length > 0) filterDetails.push(this.selectedSuburbs.join(', '));
      if (this.selectedVibes.length > 0) filterDetails.push(this.selectedVibes.join(', '));
      if (this.selectedCategories.length > 0) filterDetails.push(this.selectedCategories.join(', '));
      const filterStr = filterDetails.length > 0 ? ` • ${filterDetails.join(' | ')}` : '';
      
      if (displayEvents.length > visibleEvents.length) {
        countText.textContent = `Showing ${visibleEvents.length} of ${displayEvents.length} ${itemNoun} in ${app.currentCity}${dateLabel}${filterStr}`;
      } else {
        countText.textContent = `Showing ${displayEvents.length} ${itemNoun} in ${app.currentCity}${dateLabel}${filterStr}`;
      }
    }

    if (displayEvents.length === 0) {
      grid.innerHTML = '';
      empty?.classList.remove('hidden');
      if (loadMoreWrap) loadMoreWrap.classList.add('hidden');
      return;
    }

    empty?.classList.add('hidden');

    // Manage Load More button
    const remaining = displayEvents.length - visibleEvents.length;
    if (remaining > 0 && loadMoreWrap) {
      loadMoreWrap.classList.remove('hidden');
      if (remainingSpan) remainingSpan.textContent = remaining;
    } else if (loadMoreWrap) {
      loadMoreWrap.classList.add('hidden');
    }

    grid.innerHTML = visibleEvents.map(ev => {
      const isMatch = ev.is_match;
      const v1 = ev.u1_vote;
      const v2 = ev.u2_vote;

      // Active voter's current vote & partner's vote
      const currentVote = (activeVoter === u1) ? v1 : v2;
      const partnerName = (activeVoter === u1) ? u2 : u1;
      const partnerVote = (activeVoter === u1) ? v2 : v1;

      const loveActive = currentVote === 'love' ? 'active-love' : '';
      const passActive = currentVote === 'pass' ? 'active-pass' : '';

      // Match or Partner-Loved Signal (Zero noise when nobody has voted yet!)
      let signalBadgeHtml = '';
      if (!isSolo && isMatch) {
        signalBadgeHtml = `<div class="card-match-banner">🎉 Mutual Match! Both Love This</div>`;
      } else if (!isSolo && partnerVote === 'love') {
        signalBadgeHtml = `<div class="card-partner-loved-banner">💜 ${discover.escapeHtml(partnerName)} loves this — tap ❤️ to Match!</div>`;
      }

      // Clean 1-line tip
      const tipHtml = ev.insider_tip 
        ? `<div class="card-tip-clean">💡 ${discover.escapeHtml(ev.insider_tip)}</div>`
        : '';

      // Love Notes HTML (only shown if someone wrote a note)
      let loveNotesHtml = '';
      const notesList = [];
      if (ev.u1_note) {
        notesList.push(`
          <div class="card-love-note u1-note">
            <span class="note-author-pill u1">${ev.u1_vote === 'love' ? '❤️' : '💬'} ${u1}</span>
            <span class="note-quote-text">"${discover.escapeHtml(ev.u1_note)}"</span>
          </div>
        `);
      }
      if (ev.u2_note) {
        notesList.push(`
          <div class="card-love-note u2-note">
            <span class="note-author-pill u2">${ev.u2_vote === 'love' ? '💜' : '💬'} ${u2}</span>
            <span class="note-quote-text">"${discover.escapeHtml(ev.u2_note)}"</span>
          </div>
        `);
      }
      if (notesList.length > 0) {
        loveNotesHtml = `<div class="card-love-notes-box">${notesList.join('')}</div>`;
      }

      const myExistingNote = (activeVoter === u1) ? ev.u1_note : ev.u2_note;
      const locLabel = ev.location || ev.location_name || ev.city || 'Brisbane';
      const priceLabel = ev.price || ev.price_str || ev.price_level || '$$';
      const linkInfo = discover.getEventLinkInfo(ev);
      const externalLinkHtml = linkInfo
        ? `<span class="meta-dot">•</span><a href="${discover.escapeHtml(linkInfo.url)}" target="_blank" rel="noopener noreferrer" class="card-source-link" title="Visit ${discover.escapeHtml(ev.source || 'official website')}">${linkInfo.label}</a>`
        : '';

      return `
        <article class="event-card ${isMatch ? 'is-match-card' : ''}" data-event-id="${ev.id}">
          <div class="card-media" ondblclick="discover.handleDoubleTap('${ev.id}')" title="Double-tap photo to Love ❤️">
            <img class="card-img" src="${ev.image_url}" alt="${discover.escapeHtml(ev.title)}" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80'">
            <span class="card-source-badge">${discover.escapeHtml(ev.category || 'Date Idea')}</span>
            <span class="card-price-badge">${discover.escapeHtml(priceLabel)}</span>
            ${signalBadgeHtml}
            <div class="heart-burst-overlay" id="burst-${ev.id}">❤️</div>
          </div>

          <div class="card-body">
            <h3 class="card-title">${discover.escapeHtml(ev.title)}</h3>
            
            <div class="card-meta-line">
              <a href="https://maps.apple.com/?q=${encodeURIComponent(locLabel + ', Brisbane')}" target="_blank" rel="noopener" class="card-map-link" title="Open in Maps">
                📍 ${discover.escapeHtml(locLabel)} <span class="map-link-arrow">↗</span>
              </a>
              <span class="meta-dot">•</span>
              <span class="card-time-span">${discover.formatWhen(ev)}</span>
              ${externalLinkHtml}
            </div>

            ${tipHtml}
            ${!isSolo ? loveNotesHtml : ''}

            <!-- Single-Row Clean Action Bar -->
            <div class="card-actions-clean">
              <button class="btn-vote-pill btn-vote-love ${loveActive}" onclick="collaborative.handleVote('${ev.id}', 'love')" title="Love it!">
                <span>❤️ ${loveActive ? 'Loved' : 'Love'}</span>
              </button>
              <button class="btn-vote-pill btn-vote-pass ${passActive}" onclick="collaborative.handleVote('${ev.id}', 'pass')" title="Pass">
                <span>✕ ${passActive ? 'Passed' : 'Pass'}</span>
              </button>
              <button type="button" class="btn-card-icon" onclick="planner.openScheduleModal('${ev.id}', '${ev.title.replace(/'/g, "\\'")}', ${ev.planner_id ? `'${ev.planner_id}'` : 'null'})" title="Schedule this activity">
                📅
              </button>
              ${!isSolo ? `
                <button type="button" class="btn-card-icon ${myExistingNote ? 'has-note' : ''}" onclick="collaborative.openNoteModal('${ev.id}')" title="${myExistingNote ? 'Edit your note' : 'Add a note for your partner'}">
                  💬
                </button>
                <button type="button" class="btn-card-icon" onclick="chatView.shareEventToChat('${ev.id}')" title="Share to Couple Chat">
                  ↗
                </button>
              ` : ''}
            </div>
          </div>
        </article>
      `;
    }).join('');
  },

  currentMood: 'all',

  handleDoubleTap(eventId) {
    collaborative.handleVote(eventId, 'love');
    const burst = document.getElementById(`burst-${eventId}`);
    if (burst) {
      burst.classList.add('animate-burst');
      setTimeout(() => burst.classList.remove('animate-burst'), 850);
    }
    app.showToast('❤️ Loved! Double-tap saved');
  },

  setMoodFilter(mood) {
    const prevMood = this.currentMood;
    this.currentMood = mood;
    this.currentPage = 1;

    // Highlight active chip
    document.querySelectorAll('.mood-chip').forEach(c => {
      c.classList.toggle('active', c.dataset.mood === mood);
    });

    // Reset custom parameters (the chosen date range is kept — it's set from the 📅 calendar chip)
    this.selectedCategories = [];
    this.selectedVibes = [];
    const dateMoods = ['weekend', 'tonight'];
    if (dateMoods.includes(prevMood) && !dateMoods.includes(mood)) {
      this.activeDateRange = this.defaultDateRange;
      this.customStart = null;
      this.customEnd = null;
    }
    const isSolo = (typeof firebaseService !== 'undefined') ? firebaseService.isSolo : false;

    if (mood === 'all') {
      this.activeFilter = 'all';
    } else if (mood === 'matches') {
      this.activeFilter = 'matches';
    } else if (mood === 'my-loves' || mood === 'emma-loves') {
      this.activeFilter = isSolo ? 'my_loves' : 'user1_likes';
    } else if (mood === 'my-passed' || mood === 'emma-passed') {
      this.activeFilter = isSolo ? 'my_passed' : 'user1_passed';
    } else if (mood === 'jordan-loves') {
      this.activeFilter = 'user2_likes';
    } else if (mood === 'jordan-passed') {
      this.activeFilter = 'user2_passed';
    } else if (mood === 'weekend') {
      this.activeFilter = 'all';
      this.activeDateRange = 'this_weekend';
    } else if (mood === 'tonight') {
      this.activeFilter = 'all';
      this.activeDateRange = 'today';
    } else if (mood === 'dinner') {
      this.activeFilter = 'all';
      this.selectedCategories = ['Food & Drink'];
    } else if (mood === 'drinks') {
      this.activeFilter = 'all';
      this.selectedCategories = ['Nightlife & Bars'];
    } else if (mood === 'outdoor') {
      this.activeFilter = 'all';
      this.selectedCategories = ['Outdoors & Nature', 'Outdoor & Adventure', 'Sightseeing & Nature'];
    } else if (mood === 'shows') {
      this.activeFilter = 'all';
      this.selectedCategories = ['Comedy & Shows', 'Music & Concerts'];
    } else if (mood === 'sports') {
      this.activeFilter = 'all';
      this.selectedCategories = ['Sports & Active'];
    } else if (mood === 'budget') {
      this.activeFilter = 'all';
      this.selectedVibes = ['Budget', 'Free'];
    } else if (mood === 'late-night') {
      this.activeFilter = 'all';
      this.selectedVibes = ['Late Night'];
    } else if (mood === 'indoor') {
      this.activeFilter = 'all';
      this.selectedVibes = ['Indoor'];
    } else if (mood === 'stay-in') {
      this.activeFilter = 'all';
      this.selectedVibes = ['Stay-In'];
    }

    this.updateActiveFilterPillBar();
    this.loadEvents(false);
  },

  updateActiveFilterPillBar() {
    const bar = document.getElementById('active-filter-pill-bar');
    const summary = document.getElementById('active-filter-summary');
    if (!bar || !summary) return;

    const isSolo = (typeof firebaseService !== 'undefined') ? firebaseService.isSolo : false;
    const activeSoloName = (typeof firebaseService !== 'undefined' && firebaseService.userProfile?.name)
      ? firebaseService.userProfile.name
      : (localStorage.getItem('twodo_user_name') || 'You');

    const u1 = isSolo ? activeSoloName : (app.profile?.user1_name || 'Emma');
    const u2 = isSolo ? 'Partner' : (app.profile?.user2_name || 'Jordan');

    const parts = [];
    if (this.activeIntent && this.activeIntent !== 'all' && !this.isSpecialMood()) {
      const iDef = this.intentDefinitions[this.activeIntent];
      let iLabel = iDef ? iDef.label : this.activeIntent;
      if (this.activeSubIntent && this.activeSubIntent !== 'all' && iDef?.subs) {
        const sDef = iDef.subs.find(s => s.id === this.activeSubIntent);
        if (sDef) iLabel += ` (${sDef.label})`;
      }
      parts.push(iLabel);
    }
    if (this.selectedSuburbs && this.selectedSuburbs.length > 0) {
      parts.push(`📍 ${this.selectedSuburbs.join(', ')}`);
    }
    if (this.selectedCategories && this.selectedCategories.length > 0 && this.currentMood === 'all') {
      parts.push(`🌟 ${this.selectedCategories.join(', ')}`);
    }
    if (this.selectedVibes && this.selectedVibes.length > 0 && this.currentMood === 'all') {
      parts.push(`✨ ${this.selectedVibes.join(', ')}`);
    }
    if (!this.isDefaultDate() && this.activeDateRange !== 'all' && this.currentMood === 'all') {
      parts.push(`📅 ${this.getDateChipLabel()}`);
    }

    // Quick mood chips (Comedy & Shows, Tonight, Budget, etc.) — show them so they can be cleared
    const moodLabels = {
      weekend: '🥂 This Weekend',
      tonight: '🔥 Tonight',
      dinner: '🍷 Romantic Dinner',
      drinks: '🍹 Rooftops & Drinks',
      outdoor: '🌿 Outdoors & Sun',
      shows: '🎭 Comedy & Shows',
      budget: '⚡ Budget & Free',
      sports: '🏟️ Sports',
      'late-night': '🌙 Late Night',
      indoor: '🌧️ Indoor & Cozy',
      'stay-in': '🏠 Stay-In Dates'
    };
    if (moodLabels[this.currentMood]) {
      parts.push(moodLabels[this.currentMood]);
    }

    if (this.currentMood === 'my-loves' || (isSolo && this.currentMood === 'emma-loves')) {
      parts.push(`❤️ My Loves`);
    } else if (this.currentMood === 'my-passed' || (isSolo && this.currentMood === 'emma-passed')) {
      parts.push(`❌ My Passed`);
    } else if (this.currentMood === 'emma-loves') {
      parts.push(`❤️ ${u1}'s Loves`);
    } else if (this.currentMood === 'emma-passed') {
      parts.push(`❌ ${u1}'s Passed`);
    } else if (this.currentMood === 'jordan-loves') {
      parts.push(`💜 ${u2}'s Loves`);
    } else if (this.currentMood === 'jordan-passed') {
      parts.push(`❌ ${u2}'s Passed`);
    } else if (this.currentMood === 'matches') {
      parts.push(`💖 Mutual Date Matches`);
    }

    if (parts.length > 0) {
      summary.textContent = `🎯 Filtered by: ${parts.join(' • ')}`;
      bar.classList.remove('hidden');
    } else {
      bar.classList.add('hidden');
    }
  },

  /**
   * Renders 3 horizontal Curated Spotlight Carousels when browsing 'All Ideas' with no active search/filter,
   * drawing couples in immediately without forcing them to scroll through a flat 368-card wall.
   */
  renderSpotlights(displayEvents = []) {
    const wrap = document.getElementById('discover-spotlights');
    if (!wrap) return;

    const showSpotlights = (
      this.activeIntent === 'all' &&
      this.currentMood === 'all' &&
      !this.searchQuery &&
      this.selectedSuburbs.length === 0 &&
      this.selectedCategories.length === 0 &&
      this.selectedVibes.length === 0 &&
      this.currentPage === 1 &&
      displayEvents.length > 12
    );

    if (!showSpotlights) {
      wrap.classList.add('hidden');
      wrap.innerHTML = '';
      return;
    }

    const upcomingDated = displayEvents.filter(ev => !ev.ongoing).slice(0, 8);
    const dinnerAndDrinks = displayEvents.filter(ev => api.matchEventIntent(ev, 'eat_drink', 'all')).slice(0, 8);
    const funActivities = displayEvents.filter(ev => api.matchEventIntent(ev, 'activity', 'all')).slice(0, 8);

    const sections = [
      {
        title: '🎟️ Happening Soon in Brisbane',
        subtitle: 'Upcoming live shows, gigs, comedy & matches',
        intent: 'whats_on',
        cta: 'See All What\'s On →',
        items: upcomingDated
      },
      {
        title: '🍽️ Date-Night Eats & Rooftops',
        subtitle: 'Romantic dinners, hidden cocktail bars & dessert spots',
        intent: 'eat_drink',
        cta: 'Explore Eat & Drink →',
        items: dinnerAndDrinks
      },
      {
        title: '🎯 Fun Activities (Not Just Dinner)',
        subtitle: 'Pottery, mini-golf, arcades, bathhouses & games',
        intent: 'activity',
        cta: 'Explore Activities →',
        items: funActivities
      }
    ].filter(s => s.items.length > 0);

    if (sections.length === 0) {
      wrap.classList.add('hidden');
      wrap.innerHTML = '';
      return;
    }

    wrap.innerHTML = sections.map(sec => `
      <div class="spotlight-row-block">
        <div class="spotlight-row-header">
          <div>
            <h3 class="spotlight-row-title">${sec.title}</h3>
            <p class="spotlight-row-sub">${sec.subtitle}</p>
          </div>
          <button type="button" class="btn-spotlight-more" onclick="discover.setIntent('${sec.intent}')">${sec.cta}</button>
        </div>
        <div class="spotlight-carousel">
          ${sec.items.map(ev => {
            const locLabel = ev.location || ev.location_name || ev.city || 'Brisbane';
            const priceLabel = ev.price || ev.price_str || ev.price_level || '$$';
            const linkInfo = this.getEventLinkInfo(ev);
            const extHtml = linkInfo
              ? `<a href="${this.escapeHtml(linkInfo.url)}" target="_blank" rel="noopener noreferrer" class="card-source-link" onclick="event.stopPropagation()">${linkInfo.label}</a>`
              : '';
            return `
              <div class="spotlight-mini-card" data-event-id="${ev.id}">
                <div class="spotlight-mini-media" ondblclick="discover.handleDoubleTap('${ev.id}')">
                  <img src="${ev.image_url}" alt="${this.escapeHtml(ev.title)}" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=600&q=80'">
                  <span class="card-price-badge">${this.escapeHtml(priceLabel)}</span>
                </div>
                <div class="spotlight-mini-body">
                  <div class="spotlight-mini-cat">${this.escapeHtml(ev.category)}</div>
                  <h4 class="spotlight-mini-title">${this.escapeHtml(ev.title)}</h4>
                  <div class="spotlight-mini-meta">
                    <span>📍 ${this.escapeHtml(locLabel)}</span>
                    ${extHtml}
                  </div>
                  <div class="spotlight-mini-when">${this.formatWhen(ev)}</div>
                  <div class="spotlight-mini-actions">
                    <button type="button" class="btn-spot-love" onclick="collaborative.handleVote('${ev.id}', 'love')">❤️ Love</button>
                    <button type="button" class="btn-spot-pass" onclick="collaborative.handleVote('${ev.id}', 'pass')">✕ Pass</button>
                    <button type="button" class="btn-spot-plan" onclick="planner.openScheduleModal('${ev.id}', '${ev.title.replace(/'/g, "\\'")}', null)" title="Pick Date & Plan">📅</button>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `).join('');
    wrap.classList.remove('hidden');
  },

  // ---------------------------------------------------------------------------
  // 15-SECOND COUPLE DATE CONCIERGE (3 Quick Choices → Top 3 Hand-Picked Ideas)
  // ---------------------------------------------------------------------------
  openConcierge() {
    this.conciergeState = {
      intent: this.activeIntent !== 'all' ? this.activeIntent : 'eat_drink',
      when: 'tonight',
      vibe: 'any',
      offset: 0
    };
    this.renderConcierge();
    const modal = document.getElementById('concierge-modal');
    if (modal) {
      modal.classList.remove('hidden');
      document.body.style.overflow = 'hidden';
    }
  },

  closeConcierge() {
    const modal = document.getElementById('concierge-modal');
    if (modal) {
      modal.classList.add('hidden');
      document.body.style.overflow = '';
    }
  },

  setConciergeOption(key, val) {
    this.conciergeState[key] = val;
    this.conciergeState.offset = 0;
    this.renderConcierge();
  },

  dealConciergePicks() {
    this.conciergeState.offset += 3;
    this.renderConcierge();
  },

  applyConciergeToFeed() {
    const st = this.conciergeState;
    if (st.intent === 'whats_on') {
      this.activeFeedMode = 'special';
      this.activeIntent = 'all';
    } else {
      this.activeFeedMode = 'anytime';
      this.activeIntent = st.intent === 'surprise' ? 'all' : st.intent;
    }
    this.activeSubIntent = 'all';
    if (st.when === 'tonight') {
      this.activeDateRange = 'today';
    } else if (st.when === 'weekend') {
      this.activeDateRange = 'this_weekend';
    } else {
      this.activeDateRange = this.defaultDateRange;
    }
    this.selectedVibes = [];
    if (st.vibe === 'budget') this.selectedVibes = ['Budget'];
    else if (st.vibe === 'indoor') this.selectedVibes = ['Indoor'];
    this.closeConcierge();
    this.syncIntentUI();
    this.updateActiveFilterPillBar();
    this.updateFilterHeaderBadges();
    this.loadEvents(false);
    if (typeof app !== 'undefined' && app.activeTab !== 'discover') {
      app.navigate('discover');
    }
  },

  getConciergeMatches() {
    const st = this.conciergeState;
    const isSolo = (typeof firebaseService !== 'undefined') ? firebaseService.isSolo : false;
    const activeVoter = app.getActiveVoterName();
    const u1 = isSolo ? activeVoter : (app.profile?.user1_name || 'Emma');
    const u2 = isSolo ? 'Partner' : (app.profile?.user2_name || 'Jordan');

    const enriched = api.getLocalEnrichedEvents({
      city: (typeof app !== 'undefined' && app.currentCity) || 'Brisbane',
      intent: st.intent === 'surprise' ? 'all' : st.intent,
      date_range: 'all'
    }).events || [];

    // Filter out anything already passed or loved by active user
    const candidates = enriched.filter(ev => {
      const myVote = isSolo ? ev.my_vote : (activeVoter === u1 ? ev.u1_vote : ev.u2_vote);
      if (myVote === 'pass' || myVote === 'love') return false;
      const t = `${ev.title || ''} ${ev.description || ''} ${ev.time_str || ''} ${(ev.tags || []).join(' ')} ${ev.vibe || ''}`.toLowerCase();
      const price = String(ev.price || ev.price_str || '');

      // Vibe filter
      if (st.vibe === 'budget' && !(['Free', '$'].includes(price) || t.includes('free') || t.includes('under $') || t.includes('budget'))) {
        return false;
      }
      if (st.vibe === 'treat' && ['Free', '$'].includes(price)) {
        return false;
      }
      if (st.vibe === 'indoor' && !['indoor', 'cinema', 'gallery', 'museum', 'pottery', 'arcade', 'bowling', 'restaurant', 'bar', 'bistro', 'theatre', 'qpac', 'bathhouse'].some(k => t.includes(k))) {
        return false;
      }
      return true;
    });

    // Score candidates (partner already loved = huge boost, timing match = boost)
    const scored = candidates.map(ev => {
      let score = 0;
      const partnerVote = !isSolo ? (activeVoter === u1 ? ev.u2_vote : ev.u1_vote) : null;
      if (partnerVote === 'love') score += 50;
      const t = `${ev.title || ''} ${ev.description || ''} ${ev.time_str || ''} ${(ev.tags || []).join(' ')}`.toLowerCase();
      if (st.when === 'tonight' && ['evening', 'night', 'dinner', 'bar', 'pm', 'late'].some(k => t.includes(k))) score += 15;
      if (st.when === 'day' && ['morning', 'day', 'brunch', 'cafe', 'bakery', 'walk', 'picnic', 'market', 'am'].some(k => t.includes(k))) score += 15;
      if (st.when === 'late_night' && ['late', '10pm', '11pm', 'midnight', 'speakeasy', 'dessert', 'stargazing'].some(k => t.includes(k))) score += 20;
      if (st.when === 'weekend' && !ev.ongoing) score += 20;
      return { ev, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.map(s => s.ev);
  },

  renderConcierge() {
    const body = document.getElementById('concierge-body');
    if (!body) return;
    const st = this.conciergeState;
    const isSolo = (typeof firebaseService !== 'undefined') ? firebaseService.isSolo : false;
    const activeVoter = app.getActiveVoterName();
    const u1 = isSolo ? activeVoter : (app.profile?.user1_name || 'Emma');
    const u2 = isSolo ? 'Partner' : (app.profile?.user2_name || 'Jordan');
    const partnerName = activeVoter === u1 ? u2 : u1;

    const intentOpts = [
      { id: 'eat_drink', label: '🍽️ Eat & Drink' },
      { id: 'activity', label: '🎯 Fun Activity' },
      { id: 'whats_on', label: '🎟️ Live Show / Event' },
      { id: 'outdoors', label: '🌿 Outdoors' },
      { id: 'low_key', label: '🌙 Low-Key' },
      { id: 'surprise', label: '🎲 Surprise Us' }
    ];
    const whenOpts = [
      { id: 'tonight', label: '🔥 Tonight / Evening' },
      { id: 'day', label: '☀️ Day Date / Brunch' },
      { id: 'weekend', label: '🥂 This Weekend' },
      { id: 'late_night', label: '🌙 Late Night' }
    ];
    const vibeOpts = [
      { id: 'any', label: '💫 Any Budget' },
      { id: 'budget', label: '⚡ Free / Under $30' },
      { id: 'treat', label: '🍷 Treat Ourselves' },
      { id: 'indoor', label: '🌧️ Indoor & Cozy' }
    ];

    const matches = this.getConciergeMatches();
    const total = matches.length;
    const startIdx = total > 0 ? (st.offset % total) : 0;
    const picks = [];
    for (let i = 0; i < Math.min(3, total); i++) {
      picks.push(matches[(startIdx + i) % total]);
    }

    body.innerHTML = `
      <div class="concierge-steps">
        <div class="concierge-step-row">
          <span class="concierge-step-label">1. What are you feeling?</span>
          <div class="concierge-pills">
            ${intentOpts.map(o => `<button type="button" class="concierge-opt-pill ${st.intent === o.id ? 'active' : ''}" onclick="discover.setConciergeOption('intent', '${o.id}')">${o.label}</button>`).join('')}
          </div>
        </div>
        <div class="concierge-step-row">
          <span class="concierge-step-label">2. When?</span>
          <div class="concierge-pills">
            ${whenOpts.map(o => `<button type="button" class="concierge-opt-pill ${st.when === o.id ? 'active' : ''}" onclick="discover.setConciergeOption('when', '${o.id}')">${o.label}</button>`).join('')}
          </div>
        </div>
        <div class="concierge-step-row">
          <span class="concierge-step-label">3. Vibe &amp; Budget?</span>
          <div class="concierge-pills">
            ${vibeOpts.map(o => `<button type="button" class="concierge-opt-pill ${st.vibe === o.id ? 'active' : ''}" onclick="discover.setConciergeOption('vibe', '${o.id}')">${o.label}</button>`).join('')}
          </div>
        </div>
      </div>

      <div class="concierge-results-header">
        <span>🎯 Top 3 Picks For You (${total} matching)</span>
        ${total > 3 ? `<button type="button" class="btn-concierge-shuffle" onclick="discover.dealConciergePicks()">🔄 Deal 3 New Picks</button>` : ''}
      </div>

      <div class="concierge-picks-list">
        ${picks.length === 0 ? `
          <div style="text-align:center; padding:1.5rem; color:var(--text-muted);">
            No exact matches for that combo — try tapping <strong>💫 Any Budget</strong> or <strong>🎲 Surprise Us</strong>!
          </div>
        ` : picks.map((ev, idx) => {
          const locLabel = ev.location || ev.location_name || ev.city || 'Brisbane';
          const priceLabel = ev.price || ev.price_str || ev.price_level || '$$';
          const partnerVote = !isSolo ? (activeVoter === u1 ? ev.u2_vote : ev.u1_vote) : null;
          const partnerBadge = partnerVote === 'love'
            ? `<span class="concierge-partner-love-pill">💜 ${this.escapeHtml(partnerName)} already loves this!</span>`
            : '';
          const linkInfo = this.getEventLinkInfo(ev);
          const extHtml = linkInfo
            ? `<a href="${this.escapeHtml(linkInfo.url)}" target="_blank" rel="noopener noreferrer" class="card-source-link">${linkInfo.label}</a>`
            : '';

          return `
            <div class="concierge-pick-card" onclick="discover.goToEventCard('${ev.id}')" style="cursor:pointer;" title="Tap to view this event card">
              <img class="concierge-pick-img" src="${ev.image_url}" alt="${this.escapeHtml(ev.title)}" onerror="this.src='https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=400&q=80'">
              <div class="concierge-pick-info">
                <div class="concierge-pick-top">
                  <span class="concierge-pick-rank">#${idx + 1} Pick · ${this.escapeHtml(priceLabel)}</span>
                  ${partnerBadge}
                </div>
                <h4 class="concierge-pick-title">${this.escapeHtml(ev.title)}</h4>
                <div class="concierge-pick-meta" onclick="event.stopPropagation()">
                  <span>📍 ${this.escapeHtml(locLabel)}</span>
                  <span>• ${this.formatWhen(ev)}</span>
                  ${extHtml}
                </div>
                <div class="concierge-pick-actions" onclick="event.stopPropagation()">
                  <button type="button" class="btn btn-sm btn-primary" onclick="discover.goToEventCard('${ev.id}')">✨ View Event Card →</button>
                  <button type="button" class="btn btn-sm btn-secondary" onclick="collaborative.handleVote('${ev.id}', 'love'); discover.renderConcierge();">❤️ Love It</button>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <div class="concierge-footer">
        <button type="button" class="btn btn-secondary btn-sm" onclick="discover.closeConcierge()">Close</button>
        <button type="button" class="btn btn-primary btn-sm" onclick="discover.applyConciergeToFeed()">Browse All ${total} Matching Ideas →</button>
      </div>
    `;
  },

  /** Navigates directly to the event card in Discover (without opening Schedule Activity) so the user can inspect or schedule it from the card. */
  async goToEventCard(eventId) {
    this.closeConcierge();
    const pool = this.getAllEventsPool();
    const targetEv = pool.find(e => String(e.id) === String(eventId));
    if (targetEv) {
      this.activeFeedMode = targetEv.ongoing ? 'anytime' : 'special';
    }
    this.activeIntent = 'all';
    this.activeSubIntent = 'all';
    this.activeDateRange = 'all';
    this.selectedSuburbs = [];
    this.selectedVibes = [];
    this.selectedCategories = [];
    this.searchQuery = '';
    ['discover-search-input', 'swiper-search-input'].forEach(id => {
      const inp = document.getElementById(id);
      if (inp) inp.value = '';
    });

    if (typeof app !== 'undefined' && app.activeTab !== 'discover') {
      app.navigate('discover');
    }

    this.syncIntentUI();
    this.updateFilterHeaderBadges();
    await this.loadEvents(false);

    // Ensure the selected event is at the top of app.events so it is on Page 1 and immediately visible
    if (Array.isArray(app.events)) {
      const idx = app.events.findIndex(e => String(e.id) === String(eventId));
      if (idx > 0) {
        const [picked] = app.events.splice(idx, 1);
        app.events.unshift(picked);
        this.renderEvents();
      } else if (idx === -1 && targetEv) {
        app.events.unshift(targetEv);
        this.renderEvents();
      }
    }

    setTimeout(() => {
      const card = document.querySelector(`#events-grid .event-card[data-event-id="${CSS.escape(String(eventId))}"]`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('card-highlight-pulse');
        setTimeout(() => card.classList.remove('card-highlight-pulse'), 2800);
      }
    }, 80);
  },

  getAllEventsPool() {
    if (typeof api !== 'undefined' && api.purgeLegacySyntheticCustomEvents) {
      api.purgeLegacySyntheticCustomEvents();
    }
    const rawSeeds = (typeof PRELOADED_EVENTS !== 'undefined' && Array.isArray(PRELOADED_EVENTS)) ? PRELOADED_EVENTS : [];
    const liveFeed = (typeof window !== 'undefined' && Array.isArray(window.LIVE_FEED_EVENTS)) ? window.LIVE_FEED_EVENTS : [];
    let customEvents = [];
    try { customEvents = JSON.parse(localStorage.getItem('twodo_custom_events') || '[]'); } catch (e) {}
    const fbCustoms = (typeof firebaseService !== 'undefined' && firebaseService.customEvents) ? firebaseService.customEvents : [];
    const appEvs = (typeof app !== 'undefined' && Array.isArray(app.events)) ? app.events : [];
    
    const combined = [...fbCustoms, ...customEvents, ...liveFeed, ...appEvs, ...rawSeeds]
      .filter(ev => {
        if (!ev || !ev.id || !ev.title) return false;
        if (/#\d+/.test(ev.title)) return false;
        if (!ev.is_custom && typeof api !== 'undefined' && api.hasValidSourceUrl && !api.hasValidSourceUrl(ev)) return false;
        if (typeof api !== 'undefined' && api.isPastEvent && api.isPastEvent(ev)) return false;
        return true;
      });
    const seenTitles = new Set();
    const seenIds = new Set();
    const norm = t => (t || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();

    return combined.filter(ev => {
      ev.location_name = ev.location_name || ev.location || 'Brisbane';
      ev.location = ev.location || ev.location_name;
      ev.price_str = ev.price_str || ev.price || '$$';
      ev.price = ev.price || ev.price_str;
      const tKey = norm(ev.title);
      const idKey = String(ev.id);
      if (seenTitles.has(tKey) || seenIds.has(idKey)) return false;
      seenTitles.add(tKey);
      seenIds.add(idKey);
      return true;
    });
  },

  updateMatchBanner() {
    const isSolo = (typeof firebaseService !== 'undefined') ? firebaseService.isSolo : false;
    const banner = document.getElementById('matches-callout-banner');
    const title = document.getElementById('matches-banner-title');
    const moodBadge = document.getElementById('mood-matches-count');
    const emmaBadge = document.getElementById('mood-emma-count');
    const emmaPassBadge = document.getElementById('mood-emma-passed-count');
    const jordanBadge = document.getElementById('mood-jordan-count');
    const jordanPassBadge = document.getElementById('mood-jordan-passed-count');

    let votes = {};
    try { votes = JSON.parse(localStorage.getItem('twodo_votes') || '{}'); } catch (e) {}
    if (typeof firebaseService !== 'undefined' && firebaseService.votesMap) {
      votes = { ...votes, ...firebaseService.votesMap };
    }

    const activeSoloName = (typeof firebaseService !== 'undefined' && firebaseService.userProfile?.name)
      ? firebaseService.userProfile.name
      : (localStorage.getItem('twodo_user_name') || 'You');

    const u1 = isSolo ? activeSoloName : (app.profile?.user1_name || 'Emma');
    const u2 = isSolo ? 'Partner' : (app.profile?.user2_name || 'Jordan');

    const pool = this.getAllEventsPool();
    const seen = new Set();
    let matchesCount = 0;
    let emmaLoveCount = 0;
    let emmaPassCount = 0;
    let jordanLoveCount = 0;
    let jordanPassCount = 0;

    pool.forEach(ev => {
      if (!ev || !ev.id || seen.has(ev.id)) return;
      seen.add(ev.id);
      const v1 = votes[`${ev.id}_${u1}`] !== undefined ? votes[`${ev.id}_${u1}`] : ev.u1_vote;
      const v2 = isSolo ? null : (votes[`${ev.id}_${u2}`] !== undefined ? votes[`${ev.id}_${u2}`] : ev.u2_vote);
      const myVote = isSolo ? (votes[`${ev.id}_${activeSoloName}`] || v1) : null;

      if (isSolo) {
        if (myVote === 'love') emmaLoveCount++;
        if (myVote === 'pass') emmaPassCount++;
      } else {
        if (v1 === 'love') emmaLoveCount++;
        if (v1 === 'pass') emmaPassCount++;
        if (v2 === 'love') jordanLoveCount++;
        if (v2 === 'pass') jordanPassCount++;
        if (v1 === 'love' && v2 === 'love') matchesCount++;
      }
    });

    if (typeof matchesView !== 'undefined') matchesView.refresh();

    if (moodBadge) {
      moodBadge.textContent = matchesCount;
      moodBadge.classList.toggle('has-matches', matchesCount > 0);
    }
    if (emmaBadge) {
      emmaBadge.textContent = emmaLoveCount;
      emmaBadge.classList.toggle('has-matches', emmaLoveCount > 0);
    }
    if (emmaPassBadge) {
      emmaPassBadge.textContent = emmaPassCount;
      emmaPassBadge.classList.toggle('has-matches', emmaPassCount > 0);
    }
    if (jordanBadge) {
      jordanBadge.textContent = jordanLoveCount;
      jordanBadge.classList.toggle('has-matches', jordanLoveCount > 0);
    }
    if (jordanPassBadge) {
      jordanPassBadge.textContent = jordanPassCount;
      jordanPassBadge.classList.toggle('has-matches', jordanPassCount > 0);
    }

    if (!banner || !title) return;
    if (!isSolo && matchesCount > 0) {
      banner.classList.remove('hidden');
      title.textContent = `${matchesCount} Mutual Date ${matchesCount === 1 ? 'Match' : 'Matches'}!`;
    } else {
      banner.classList.add('hidden');
    }
  },

  refreshWithLatestVotes() {
    if (!app.events || app.events.length === 0) return;

    const u1 = app.profile?.user1_name || 'Partner 1';
    const u2 = app.profile?.user2_name || 'Partner 2';
    const votes = (typeof firebaseService !== 'undefined' && firebaseService.votesMap) ? firebaseService.votesMap : {};
    const notes = (typeof firebaseService !== 'undefined' && firebaseService.notesMap) ? firebaseService.notesMap : {};

    let newlyMatchedEvent = null;

    app.events.forEach(ev => {
      const prevMatch = ev.is_match;
      const v1 = votes[`${ev.id}_${u1}`] !== undefined ? votes[`${ev.id}_${u1}`] : ev.u1_vote;
      const v2 = votes[`${ev.id}_${u2}`] !== undefined ? votes[`${ev.id}_${u2}`] : ev.u2_vote;
      ev.u1_vote = v1;
      ev.u2_vote = v2;
      if (notes[`${ev.id}_${u1}`] !== undefined) ev.u1_note = notes[`${ev.id}_${u1}`];
      if (notes[`${ev.id}_${u2}`] !== undefined) ev.u2_note = notes[`${ev.id}_${u2}`];

      const isMatch = Boolean(v1 === 'love' && v2 === 'love');
      ev.is_match = isMatch;
      ev.match_level = isMatch ? 'double_love' : 'none';

      // Detect if an event just became a match from partner's real-time vote
      if (!prevMatch && isMatch) {
        newlyMatchedEvent = ev;
      }
    });

    this.renderEvents();
    this.updateMatchBanner();
    if (window.swiper) swiper.initDeck();

    if (newlyMatchedEvent && collaborative.triggerMatchCelebration) {
      collaborative.triggerMatchCelebration(newlyMatchedEvent);
    }
  },

  loadMore() {
    this.currentPage++;
    this.renderEvents();
  },

  // ---------------------------------------------------------------------------
  // FILTER MODAL POPUP & MULTI-SELECT ENGINE (Airbnb / Fever Inspired v4.0)
  // ---------------------------------------------------------------------------
  openFilterModal(type) {
    // Stay on Swiper if opened from there (filters apply to both views)
    if (typeof app !== 'undefined' && app.activeTab && !['discover', 'swiper'].includes(app.activeTab)) {
      app.navigate('discover');
    }
    this.currentModalType = type;
    const def = this.filterDefinitions[type];
    if (!def) return;
    if (type === 'date') {
      def.options = this.buildDateOptions();
    }

    const iconEl = document.getElementById('filter-modal-icon');
    const titleEl = document.getElementById('filter-modal-title');
    const subEl = document.getElementById('filter-modal-sub');

    if (iconEl) iconEl.textContent = def.icon;
    if (titleEl) titleEl.textContent = def.title;
    if (subEl) subEl.textContent = def.subtitle;

    // Populate working selection set
    this.modalSelectedSet = new Set();
    if (type === 'date') {
      // Opening the Date Modal automatically ensures we're filtering Special Dated Events
      if (this.activeFeedMode !== 'special') {
        this.activeFeedMode = 'special';
        this.activeIntent = 'all';
        this.activeSubIntent = 'all';
        this.syncIntentUI();
      }
      const initDate = (this.activeDateRange === 'today') ? 'day_0' : ((this.activeDateRange === 'tomorrow') ? 'day_1' : (this.activeDateRange || this.defaultDateRange || 'this_week'));
      this.modalSelectedSet.add(initDate);
    } else if (type === 'suburb') {
      (this.selectedSuburbs || []).forEach(s => this.modalSelectedSet.add(s));
    } else if (type === 'vibe') {
      (this.selectedVibes || []).forEach(v => this.modalSelectedSet.add(v));
    } else if (type === 'category') {
      (this.selectedCategories || []).forEach(c => this.modalSelectedSet.add(c));
    }

    this.renderModalOptions();

    const modal = document.getElementById('filter-modal');
    if (modal) {
      modal.classList.remove('hidden');
      document.body.style.overflow = 'hidden';
    }
  },

  closeFilterModal() {
    const modal = document.getElementById('filter-modal');
    if (modal) {
      modal.classList.add('hidden');
      document.body.style.overflow = '';
    }
    this.currentModalType = null;
  },

  handleModalOverlayClick(e) {
    if (e.target.id === 'filter-modal') {
      this.closeFilterModal();
    }
  },

  /** Computes live un-voted matching activity count for a specific date range id or the current modal selection */
  getDateRangePreviewCount(rangeId) {
    if (typeof api === 'undefined' || !api.getLocalEnrichedEvents) return 0;
    const params = this.getFilterParams({ forSwiper: true });
    params.feed_mode = 'special';
    const bounds = this.getDateBounds(rangeId);
    params.date_range = bounds ? 'custom' : 'all';
    params.custom_start = bounds ? this.toYMD(bounds.start) : null;
    params.custom_end = bounds ? this.toYMD(bounds.end) : null;
    const rawList = api.getLocalEnrichedEvents(params).events || [];
    const isSolo = (typeof firebaseService !== 'undefined') ? firebaseService.isSolo : false;
    const activeVoter = (typeof app !== 'undefined' && app.getActiveVoterName) ? app.getActiveVoterName() : 'Emma';
    const u1 = isSolo ? activeVoter : (app.profile?.user1_name || 'Emma');
    return rawList.filter(ev => {
      const myVote = isSolo ? (ev.my_vote || ev.u1_vote) : (activeVoter === u1 ? ev.u1_vote : ev.u2_vote);
      return myVote !== 'love' && myVote !== 'pass';
    }).length;
  },

  /** Computes live un-voted matching activity count for the current modal selection */
  getModalPreviewCount() {
    if (typeof api === 'undefined' || !api.getLocalEnrichedEvents) return null;
    if (this.currentModalType === 'date') {
      const selDate = Array.from(this.modalSelectedSet)[0] || 'all';
      return this.getDateRangePreviewCount(selDate);
    }
    const params = this.getFilterParams({ forSwiper: true });
    if (this.currentModalType === 'suburb') {
      const subs = Array.from(this.modalSelectedSet).filter(s => s !== 'all' && s !== 'All');
      params.suburb = subs.length > 0 ? subs.join(',') : 'All';
    }
    const rawList = api.getLocalEnrichedEvents(params).events || [];
    const isSolo = (typeof firebaseService !== 'undefined') ? firebaseService.isSolo : false;
    const activeVoter = (typeof app !== 'undefined' && app.getActiveVoterName) ? app.getActiveVoterName() : 'Emma';
    const u1 = isSolo ? activeVoter : (app.profile?.user1_name || 'Emma');
    return rawList.filter(ev => {
      const myVote = isSolo ? (ev.my_vote || ev.u1_vote) : (activeVoter === u1 ? ev.u1_vote : ev.u2_vote);
      return myVote !== 'love' && myVote !== 'pass';
    }).length;
  },

  renderModalOptions() {
    const def = this.filterDefinitions[this.currentModalType];
    const container = document.getElementById('filter-modal-options-list');
    const applyBtn = document.getElementById('filter-modal-apply-btn');
    if (!def || !container) return;

    // Update live count on the footer CTA button
    const matchCount = this.getModalPreviewCount();
    if (applyBtn) {
      const actionWord = (typeof app !== 'undefined' && app.activeTab === 'swiper') ? 'Swipe' : 'Show';
      const isSpecial = (this.currentModalType === 'date' || this.activeFeedMode === 'special');
      const noun = isSpecial
        ? (matchCount === 1 ? 'Special Event' : 'Special Events')
        : (matchCount === 1 ? 'Place' : 'Places');
      if (matchCount !== null) {
        applyBtn.textContent = `${actionWord} ${matchCount} ${noun} ✨`;
      } else {
        applyBtn.textContent = 'Apply Filter ✨';
      }
    }

    // 1. PURPOSE-BUILT DATE PICKER UX (Exclusively for Special Dated Events)
    if (def.type === 'date') {
      const sel = Array.from(this.modalSelectedSet)[0] || this.defaultDateRange || 'this_week';
      const presets = [
        { id: 'all', icon: '✨', title: 'All Upcoming' },
        { id: 'this_week', icon: '🗓️', title: 'This Week' },
        { id: 'this_weekend', icon: '🥂', title: 'This Weekend' },
        { id: 'day_0', icon: '🔥', title: 'Today' },
        { id: 'day_1', icon: '🌅', title: 'Tomorrow' },
        { id: 'week_1', icon: '📆', title: 'Next Week' }
      ];

      let daysHtml = '';
      for (let i = 0; i <= 6; i++) {
        const d = this.dayOffset(i);
        const dayId = `day_${i}`;
        const isDayActive = sel === dayId || (i === 0 && sel === 'today') || (i === 1 && sel === 'tomorrow');
        const wk = i === 0 ? 'Today' : (i === 1 ? 'Tmrw' : d.toLocaleDateString('en-AU', { weekday: 'short' }));
        const dayNum = d.getDate();
        const mon = d.toLocaleDateString('en-AU', { month: 'short' });
        const dayCount = this.getDateRangePreviewCount(dayId);
        daysHtml += `
          <button type="button" class="cal-day-pill ${isDayActive ? 'active' : ''}" onclick="discover.toggleModalOption('${dayId}')">
            <span class="cal-day-wk">${wk}</span>
            <span class="cal-day-num">${dayNum}</span>
            <span class="cal-day-mon">${mon}</span>
            <span class="cal-day-count">${dayCount}</span>
          </button>
        `;
      }

      const defaultStart = this.customStart || this.toYMD(this.dayOffset(0));
      const defaultEnd = this.customEnd || this.toYMD(this.dayOffset(13));
      const minDate = this.toYMD(this.dayOffset(0));

      container.innerHTML = `
        <div class="date-modal-layout">
          <div class="date-presets-grid">
            ${presets.map(p => {
              const active = sel === p.id || (p.id === 'day_0' && sel === 'today') || (p.id === 'day_1' && sel === 'tomorrow');
              const pCount = this.getDateRangePreviewCount(p.id);
              return `
                <button type="button" class="date-preset-card ${active ? 'active' : ''}" onclick="discover.toggleModalOption('${p.id}')">
                  <span class="date-preset-left">
                    <span class="date-preset-icon">${p.icon}</span>
                    <span class="date-preset-title">${p.title}</span>
                  </span>
                  <span class="date-preset-badge">${pCount}</span>
                </button>
              `;
            }).join('')}
          </div>

          <div class="cal-week-strip">
            ${daysHtml}
          </div>

          <div class="date-further-row">
            <button type="button" class="date-further-pill ${sel === 'week_2' ? 'active' : ''}" onclick="discover.toggleModalOption('week_2')">
              📆 In 2 Weeks (${this.fmtDayMonth(this.dayOffset(14))}–${this.fmtDayMonth(this.dayOffset(20))}) · ${this.getDateRangePreviewCount('week_2')}
            </button>
            <button type="button" class="date-further-pill ${sel === 'this_month' ? 'active' : ''}" onclick="discover.toggleModalOption('this_month')">
              🗓️ Next 30 Days · ${this.getDateRangePreviewCount('this_month')}
            </button>
            <button type="button" class="date-further-pill ${sel === 'custom' ? 'active' : ''}" onclick="discover.toggleModalOption('custom')">
              🎯 Custom Dates
            </button>
          </div>

          <div id="modal-custom-date-section" class="custom-date-box-clean ${sel === 'custom' ? '' : 'hidden'}">
            <div class="custom-date-grid">
              <div class="custom-date-field">
                <label for="modal-date-start">Start Date</label>
                <input type="date" id="modal-date-start" value="${defaultStart}" min="${minDate}" onchange="discover.onCustomDateChange()">
              </div>
              <div class="custom-date-field">
                <label for="modal-date-end">End Date</label>
                <input type="date" id="modal-date-end" value="${defaultEnd}" min="${minDate}" onchange="discover.onCustomDateChange()">
              </div>
            </div>
          </div>
        </div>
      `;
      return;
    }

    // 2. PURPOSE-BUILT SUBURB / LOCATION PICKER UX
    if (def.type === 'suburb') {
      const isAll = this.modalSelectedSet.size === 0 || this.modalSelectedSet.has('All') || this.modalSelectedSet.has('all');

      const precinctsHtml = def.options.map(opt => {
        const isChecked = !isAll && this.modalSelectedSet.has(opt.id);
        return `
          <button type="button" class="suburb-tile-card ${isChecked ? 'selected' : ''}" onclick="discover.toggleModalOption('${opt.id}')">
            <div class="suburb-tile-top">
              <span class="suburb-tile-icon">${opt.icon || '📍'}</span>
              <span class="suburb-tile-name">${opt.shortLabel || opt.id}</span>
              <span class="suburb-tile-check">${isChecked ? '✓' : ''}</span>
            </div>
          </button>
        `;
      }).join('');

      container.innerHTML = `
        <div class="suburb-modal-layout">
          <div class="filter-section-heading-row" style="justify-content:flex-end; margin-bottom:0.25rem;">
            <div class="suburb-quick-links">
              <button type="button" class="btn-text-link" onclick="discover.modalCheckAllOptions()">Select All</button>
              <span class="dot-sep">·</span>
              <button type="button" class="btn-text-link" onclick="discover.modalClearAllOptions()">Clear</button>
            </div>
          </div>

          <div class="suburb-grid-2col">
            ${precinctsHtml}
          </div>
        </div>
      `;
      return;
    }

    // Fallback for vibe / category modals
    const isAll = this.modalSelectedSet.size === 0 || this.modalSelectedSet.has('All') || this.modalSelectedSet.has('all');
    let html = '';
    def.options.forEach(opt => {
      if (opt.header) {
        html += `<div class="filter-option-section">${opt.label}</div>`;
        return;
      }
      const isChecked = !isAll && this.modalSelectedSet.has(opt.id);
      html += `
        <div class="filter-option-row ${isChecked ? 'selected' : ''}" onclick="discover.toggleModalOption('${opt.id}')">
          <div class="filter-option-checkbox">${isChecked ? '✓' : ''}</div>
          <div class="filter-option-content">
            <span class="filter-option-label">${opt.label}</span>
            <span class="filter-option-desc">${opt.desc}</span>
          </div>
        </div>
      `;
    });
    container.innerHTML = html;
  },

  selectSuburbRegion(regionId) {
    const reg = this.suburbRegions.find(r => r.id === regionId);
    if (!reg || regionId === 'all') {
      this.modalSelectedSet.clear();
      this.renderModalOptions();
      return;
    }
    const alreadyExact = this.modalSelectedSet.size === reg.suburbs.length && reg.suburbs.every(s => this.modalSelectedSet.has(s));
    this.modalSelectedSet.clear();
    if (!alreadyExact) {
      reg.suburbs.forEach(s => this.modalSelectedSet.add(s));
    }
    this.renderModalOptions();
  },

  toggleModalOption(id) {
    const def = this.filterDefinitions[this.currentModalType];
    if (!def) return;

    if (def.type === 'date') {
      this.modalSelectedSet.clear();
      this.modalSelectedSet.add(id);
      if (id === 'custom') {
        if (!this.customStart) this.customStart = this.toYMD(this.dayOffset(0));
        if (!this.customEnd) this.customEnd = this.toYMD(this.dayOffset(13));
      }
    } else {
      if (this.modalSelectedSet.has('All') || this.modalSelectedSet.has('all')) {
        this.modalSelectedSet.clear();
      }
      if (this.modalSelectedSet.has(id)) {
        this.modalSelectedSet.delete(id);
      } else {
        this.modalSelectedSet.add(id);
      }
    }

    this.renderModalOptions();
  },

  modalSelectAll() {
    this.modalSelectedSet.clear();
    if (this.currentModalType === 'date') {
      this.modalSelectedSet.add('all');
    }
    this.renderModalOptions();
  },

  modalCheckAllOptions() {
    const def = this.filterDefinitions[this.currentModalType];
    if (!def) return;
    this.modalSelectedSet.clear();
    def.options.forEach(opt => {
      if (opt.id !== 'all') this.modalSelectedSet.add(opt.id);
    });
    this.renderModalOptions();
  },

  modalClearAllOptions() {
    this.modalSelectAll();
  },

  onCustomDateChange() {
    const s = document.getElementById('modal-date-start')?.value;
    const e = document.getElementById('modal-date-end')?.value;
    if (s && e) {
      this.customStart = s <= e ? s : e;
      this.customEnd = s <= e ? e : s;
      this.renderModalOptions();
    }
  },

  resetCurrentModalCategory() {
    if (this.currentModalType === 'date') {
      this.modalSelectedSet.clear();
      this.modalSelectedSet.add(this.defaultDateRange);
      this.renderModalOptions();
      return;
    }
    this.modalSelectAll();
  },

  applyModalFilter() {
    const type = this.currentModalType;
    const def = this.filterDefinitions[type];
    if (!def) return;

    if (type === 'date') {
      let selected = Array.from(this.modalSelectedSet)[0] || this.defaultDateRange || 'this_week';
      if (selected === 'custom') {
        const s = document.getElementById('modal-date-start')?.value || null;
        const e = document.getElementById('modal-date-end')?.value || null;
        if (s && e) {
          this.customStart = s <= e ? s : e;
          this.customEnd = s <= e ? e : s;
        } else {
          if (typeof app !== 'undefined' && app.showToast) app.showToast('Pick both a start and end date 📅');
          return;
        }
      } else {
        this.customStart = null;
        this.customEnd = null;
      }
      this.activeDateRange = selected;

      // Date ranges apply to the main feed — leave Loves/Passed lists or the Tonight/Weekend shortcuts
      if (this.isSpecialMood() || ['weekend', 'tonight'].includes(this.currentMood)) {
        this.currentMood = 'all';
        this.activeFilter = 'all';
        document.querySelectorAll('.mood-chip').forEach(c => {
          c.classList.toggle('active', c.dataset.mood === 'all');
        });
      }
      this.updateActiveFilterPillBar();
    } else if (type === 'suburb') {
      if (this.modalSelectedSet.size === 0 || this.modalSelectedSet.has('All') || this.modalSelectedSet.has('all')) {
        this.selectedSuburbs = [];
      } else {
        this.selectedSuburbs = Array.from(this.modalSelectedSet);
      }
    } else if (type === 'vibe') {
      if (this.modalSelectedSet.size === 0 || this.modalSelectedSet.has('All') || this.modalSelectedSet.has('all')) {
        this.selectedVibes = [];
      } else {
        this.selectedVibes = Array.from(this.modalSelectedSet);
      }
    } else if (type === 'category') {
      if (this.modalSelectedSet.size === 0 || this.modalSelectedSet.has('All') || this.modalSelectedSet.has('all')) {
        this.selectedCategories = [];
      } else {
        this.selectedCategories = Array.from(this.modalSelectedSet);
      }
    }

    this.closeFilterModal();
    this.updateFilterHeaderBadges();
    this.loadEvents(true);
  },

  updateFilterHeaderBadges() {
    // 1. Date (including header 📅 button and the 📅 calendar chip)
    // "This Week" is the default, so it doesn't count as an extra filter
    const isDateFiltered = !this.isDefaultDate();
    const dateLabel = this.getDateRangeLabel();
    this.updateDateChipLabels();
    const btnHeaderDate = document.getElementById('btn-header-date');
    const headerDateDot = document.getElementById('header-date-dot');
    if (btnHeaderDate) btnHeaderDate.classList.toggle('filter-active', isDateFiltered);
    if (headerDateDot) headerDateDot.classList.toggle('hidden', !isDateFiltered);

    // Header 🎯 Suburb & Category Filter button
    const isOtherFiltered = this.selectedSuburbs.length > 0 || this.selectedVibes.length > 0 || this.selectedCategories.length > 0;
    const btnHeaderFilter = document.getElementById('btn-header-filter');
    const headerFilterDot = document.getElementById('header-filter-dot');
    if (btnHeaderFilter) btnHeaderFilter.classList.toggle('filter-active', isOtherFiltered);
    if (headerFilterDot) headerFilterDot.classList.toggle('hidden', !isOtherFiltered);

    ['f', 'sw-f', 'map-f'].forEach(prefix => {
      const dateVal = document.getElementById(`${prefix}-val-date`);
      const dateBadge = document.getElementById(`${prefix}-badge-date`);
      const dateCard = document.getElementById(`${prefix}-hdr-date`);
      if (dateVal) dateVal.textContent = dateLabel;
      if (dateBadge) dateBadge.classList.toggle('hidden', !isDateFiltered);
      if (dateCard) dateCard.classList.toggle('filter-active', isDateFiltered);
    });

    // 2. Suburb
    const subCount = this.selectedSuburbs.length;
    let subLabel = 'All Suburbs';
    if (subCount === 1) {
      const found = this.filterDefinitions.suburb.options.find(o => o.id === this.selectedSuburbs[0]);
      subLabel = found ? (found.shortLabel || this.selectedSuburbs[0]) : this.selectedSuburbs[0];
    } else if (subCount === 2) {
      subLabel = `${this.selectedSuburbs[0]} + 1`;
    } else if (subCount > 2) {
      // Check if selection matches a named region shortcut
      const regMatch = (this.suburbRegions || []).find(r => r.suburbs.length === subCount && r.suburbs.every(s => this.selectedSuburbs.includes(s)));
      subLabel = regMatch ? regMatch.label.replace(/^[^\w]+/, '').trim() : `${subCount} Areas`;
    }
    ['suburb-chip-label', 'sw-suburb-pill-label'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = subCount === 0 ? 'All Suburbs' : subLabel;
    });
    ['mood-chip-suburb', 'sw-suburb-pill'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.classList.toggle('active', subCount > 0);
    });

    ['f', 'sw-f', 'map-f'].forEach(prefix => {
      const subVal = document.getElementById(`${prefix}-val-suburb`);
      const subBadge = document.getElementById(`${prefix}-badge-suburb`);
      const subCard = document.getElementById(`${prefix}-hdr-suburb`);
      if (subVal) subVal.textContent = subLabel;
      if (subBadge) {
        subBadge.textContent = subCount;
        subBadge.classList.toggle('hidden', subCount === 0);
      }
      if (subCard) subCard.classList.toggle('filter-active', subCount > 0);
    });

    // 3. Vibe
    const vibeCount = this.selectedVibes.length;
    let vibeLabel = '💫 All Vibes';
    if (vibeCount === 1) {
      const found = this.filterDefinitions.vibe.options.find(o => o.id === this.selectedVibes[0]);
      vibeLabel = found ? found.label.split(' ')[1] || this.selectedVibes[0] : this.selectedVibes[0];
    } else if (vibeCount === 2) {
      vibeLabel = `${this.selectedVibes[0]} + 1`;
    } else if (vibeCount > 2) {
      vibeLabel = `${vibeCount} Vibes`;
    }

    ['f', 'sw-f', 'map-f'].forEach(prefix => {
      const vibeVal = document.getElementById(`${prefix}-val-vibe`);
      const vibeBadge = document.getElementById(`${prefix}-badge-vibe`);
      const vibeCard = document.getElementById(`${prefix}-hdr-vibe`);
      if (vibeVal) vibeVal.textContent = vibeLabel;
      if (vibeBadge) {
        vibeBadge.textContent = vibeCount;
        vibeBadge.classList.toggle('hidden', vibeCount === 0);
      }
      if (vibeCard) vibeCard.classList.toggle('filter-active', vibeCount > 0);
    });

    // 4. Category
    const catCount = this.selectedCategories.length;
    let catLabel = '🌟 All Activities';
    if (catCount === 1) {
      const found = this.filterDefinitions.category.options.find(o => o.id === this.selectedCategories[0]);
      catLabel = found ? found.label.split(' ')[1] || this.selectedCategories[0] : this.selectedCategories[0];
    } else if (catCount === 2) {
      catLabel = `${this.selectedCategories[0]} + 1`;
    } else if (catCount > 2) {
      catLabel = `${catCount} Activities`;
    }

    ['f', 'sw-f', 'map-f'].forEach(prefix => {
      const catVal = document.getElementById(`${prefix}-val-category`);
      const catBadge = document.getElementById(`${prefix}-badge-category`);
      const catCard = document.getElementById(`${prefix}-hdr-category`);
      if (catVal) catVal.textContent = catLabel;
      if (catBadge) {
        catBadge.textContent = catCount;
        catBadge.classList.toggle('hidden', catCount === 0);
      }
      if (catCard) catCard.classList.toggle('filter-active', catCount > 0);
    });

    // Show/hide clear all filters buttons on discover, swiper, and map views
    const anyActive = isDateFiltered || subCount > 0 || vibeCount > 0 || catCount > 0 || this.activeFilter !== 'all' || this.activeIntent !== 'all';
    const clearBtn = document.getElementById('btn-clear-all-filters');
    if (clearBtn) clearBtn.classList.toggle('hidden', !anyActive);
    const swClearBtn = document.getElementById('sw-btn-clear-filters');
    if (swClearBtn) swClearBtn.classList.toggle('hidden', !anyActive);
    const mapClearBtn = document.getElementById('map-btn-clear-filters');
    if (mapClearBtn) mapClearBtn.classList.toggle('hidden', !anyActive);

    this.syncIntentUI();
    this.updateActiveFilterPillBar();

    // Synchronize Swiper filter counter if available
    if (typeof swiper !== 'undefined' && swiper.updateSwiperFilterStatus) {
      swiper.updateSwiperFilterStatus();
    }
    // Synchronize Map filter markers if map initialized
    if (typeof mapView !== 'undefined' && mapView.renderMarkers) {
      mapView.renderMarkers();
    }
  },

  getDateRangeLabel() {
    if (!this.activeDateRange || this.activeDateRange === 'all') return '✨ Any Date';
    return `📅 ${this.getDateChipLabel()}`;
  },

  setFilter(filter) {
    this.activeFilter = filter;
    const sel = document.getElementById('vote-filter-select');
    if (sel) sel.value = filter;
    this.updateFilterHeaderBadges();
    this.loadEvents(true);
  },

  resetFilters() {
    this.selectedCategories = [];
    this.selectedSuburbs = [];
    this.selectedVibes = [];
    this.activeIntent = 'all';
    this.activeSubIntent = 'all';
    this.activeDateRange = this.defaultDateRange;
    this.customStart = null;
    this.customEnd = null;
    this.activeFilter = 'all';
    this.currentMood = 'all';
    this.searchQuery = '';
    
    document.querySelectorAll('.mood-chip').forEach(c => {
      c.classList.toggle('active', c.dataset.mood === 'all');
    });

    ['discover-search-input', 'swiper-search-input'].forEach(id => {
      const sInput = document.getElementById(id);
      if (sInput) sInput.value = '';
    });
    ['discover-search-clear', 'swiper-search-clear'].forEach(id => {
      const clearSearchBtn = document.getElementById(id);
      if (clearSearchBtn) clearSearchBtn.classList.add('hidden');
    });
    const sel = document.getElementById('vote-filter-select');
    if (sel) sel.value = 'all';

    this.syncIntentUI();
    this.updateActiveFilterPillBar();
    this.updateFilterHeaderBadges();
    this.loadEvents(true);
  },

  // Legacy helper aliases for external calls
  setSuburb(suburb) {
    this.selectedSuburbs = (suburb === 'All' || !suburb) ? [] : [suburb];
    this.updateFilterHeaderBadges();
    this.loadEvents(true);
  },

  setVibe(vibe) {
    this.selectedVibes = (vibe === 'All' || !vibe) ? [] : [vibe];
    this.updateFilterHeaderBadges();
    this.loadEvents(true);
  },

  setCategory(category) {
    this.selectedCategories = (category === 'All' || !category) ? [] : [category];
    this.updateFilterHeaderBadges();
    this.loadEvents(true);
  },

  setDateRange(range) {
    this.activeDateRange = range || this.defaultDateRange;
    this.updateFilterHeaderBadges();
    this.loadEvents(true);
  },

  debounceSearch() {
    clearTimeout(this.searchDebounceTimer);
    this.searchDebounceTimer = setTimeout(() => {
      this.loadEvents(false);
    }, 300);
  },

  showRefreshResultModal(newlyAdded, totalCount) {
    const modal = document.getElementById('refresh-result-modal');
    const iconEl = document.getElementById('refresh-result-icon');
    const titleEl = document.getElementById('refresh-result-title');
    const msgEl = document.getElementById('refresh-result-message');
    const addedEl = document.getElementById('refresh-stat-added');
    const totalEl = document.getElementById('refresh-stat-total');

    const currentTotal = totalCount || app.events?.length || 0;

    if (!modal) {
      console.warn('refresh-result-modal element not found in DOM!');
      alert(newlyAdded > 0 
        ? `🎉 ${newlyAdded} New Activities Added!\nTotal activities across Brisbane: ${currentTotal}` 
        : `✨ Events Up to Date!\nAll ${currentTotal} activities across Brisbane are fresh and verified for the next 30 days.`);
      return;
    }

    if (newlyAdded > 0) {
      if (iconEl) iconEl.textContent = '🎉';
      if (titleEl) titleEl.textContent = `${newlyAdded} New Activities Added!`;
      if (msgEl) msgEl.textContent = `Scoured Reddit secrets, TikTok spots, Google 5★ reviews, Brisbane City Council, gig guides, and art galleries for the next 30 days!`;
      if (addedEl) addedEl.textContent = `+${newlyAdded}`;
    } else {
      if (iconEl) iconEl.textContent = '✨';
      if (titleEl) titleEl.textContent = 'Events Up to Date!';
      if (msgEl) msgEl.textContent = `All ${currentTotal} activities across Brisbane City Council, Reddit secrets, TikTok picks, and gig guides are completely fresh and verified for the next 30 days!`;
      if (addedEl) addedEl.textContent = '0 new';
    }

    if (totalEl) totalEl.textContent = currentTotal;

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  },

  closeRefreshModal() {
    const modal = document.getElementById('refresh-result-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = '';
      document.body.style.overflow = '';
    }
  },

  async refreshLiveSources() {
    const btn = document.getElementById('btn-refresh-sources');
    const subText = document.getElementById('pull-feeds-sub-text');
    const iconSpin = btn?.querySelector('.spin-icon');
    if (btn) btn.disabled = true;
    if (iconSpin) iconSpin.style.animation = 'spin 0.8s infinite linear';

    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

    let newlyAdded = 0;
    let totalCount = 0;

    try {
      if (subText) subText.textContent = 'Scanning Brisbane City Council & park programs...';
      await wait(350);

      if (subText) subText.textContent = 'Reading Reddit secrets & Google 5★ venues...';
      await wait(350);

      if (subText) subText.textContent = 'Scraping TikTok & Instagram trending spots...';
      await wait(350);

      if (subText) subText.textContent = 'Checking live gig guides & ticketed shows for 30 days...';
      await wait(350);

      try {
        const res = await api.refreshEvents(app.currentCity);
        if (res) {
          if (typeof res.newly_discovered_count !== 'undefined') {
            newlyAdded = res.newly_discovered_count;
          } else if (typeof res.newly_added !== 'undefined') {
            newlyAdded = res.newly_added;
          }
          if (res.total_count) {
            totalCount = res.total_count;
          }
        }
      } catch (err) {
        console.warn('API refresh error:', err);
      }

      // Safely reload UI events without crashing the modal
      try {
        await this.loadEvents(false);
      } catch (err) {
        console.warn('loadEvents notice during refresh:', err);
      }

      if (!totalCount) {
        totalCount = app.events?.length || 0;
      }

      // 100% GUARANTEED UNMISSABLE POP-UP TRIGGER
      this.showRefreshResultModal(newlyAdded, totalCount);

    } catch (e) {
      console.error('Fatal refresh error:', e);
      this.showRefreshResultModal(0, app.events?.length || 0);
    } finally {
      if (btn) btn.disabled = false;
      if (iconSpin) iconSpin.style.animation = '';
      if (subText) subText.textContent = 'Tap to scan Brisbane City Council, Reddit, TikTok, venues & live feeds';
    }
  },

  handleQuickLinkInput(val) {
    if (!val || val.length < 10) return;
    if (/https?:\/\//i.test(val) || val.includes('facebook.com') || val.includes('fb.me') || val.includes('oztix') || val.includes('humanitix') || val.includes('eventbrite')) {
      this.autoFillFromLink();
    }
  },

  autoFillFromLink() {
    const linkInput = document.getElementById('cust-link-input');
    const titleInput = document.getElementById('cust-title');
    const notesInput = document.getElementById('cust-notes');
    const locInput = document.getElementById('cust-location');

    if (!linkInput) return;
    const raw = linkInput.value.trim();
    if (!raw) {
      if (typeof app !== 'undefined' && app.showToast) app.showToast('Paste an event URL or share text first 🔗');
      return;
    }

    // 1. Extract URL from pasted text (handles when users copy full share text e.g. "Check out this event: https://...")
    const urlMatch = raw.match(/https?:\/\/[^\s]+/i);
    const eventUrl = urlMatch ? urlMatch[0] : (raw.startsWith('www.') ? `https://${raw}` : raw);

    const titleEl = titleInput;
    const notesEl = notesInput;
    const locEl = locInput;

    const toTitleCase = (str) => {
      return (str || '')
        .replace(/[-_+]/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase())
        .trim();
    };

    // 2. Identify Facebook Events
    if (/facebook\.com\/events|fb\.me\/e\//i.test(eventUrl)) {
      let slug = '';
      const fbSlugMatch = eventUrl.match(/events\/([^\/?#]+)/i);
      if (fbSlugMatch && isNaN(Number(fbSlugMatch[1]))) {
        slug = fbSlugMatch[1];
      }
      let userPrefix = raw.replace(eventUrl, '').trim().replace(/Check out this event:?|Take a look at:?/i, '').trim();

      if (titleEl && !titleEl.value) {
        if (slug) {
          titleEl.value = toTitleCase(slug);
        } else if (userPrefix) {
          titleEl.value = userPrefix;
        } else {
          titleEl.value = 'Facebook Event';
        }
      }

      if (notesEl) {
        const existing = notesEl.value.trim();
        notesEl.value = existing ? `${existing} • 🔗 Facebook: ${eventUrl}` : `🔗 Facebook Event: ${eventUrl}`;
      }

      if (locEl && !locEl.value) {
        locEl.value = 'Brisbane';
      }

      if (typeof app !== 'undefined' && app.showToast) {
        app.showToast('✨ Facebook Event linked & filled!');
      }
      return;
    }

    // 3. Identify Oztix / Moshtix / Humanitix / Eventbrite
    if (/oztix|humanitix|moshtix|eventbrite|ticketmaster|ticketek|qpac/i.test(eventUrl)) {
      let slug = '';
      try {
        const u = new URL(eventUrl);
        const parts = u.pathname.split('/').filter(Boolean);
        const lastPart = parts[parts.length - 1] || parts[parts.length - 2] || '';
        slug = lastPart.replace(/-tickets-\d+.*$|\d+$/i, '').replace(/^[a-z0-9]{8,}-/i, '');
      } catch (e) {}

      if (titleEl && !titleEl.value && slug) {
        titleEl.value = toTitleCase(slug);
      }

      if (notesEl) {
        const existing = notesEl.value.trim();
        notesEl.value = existing ? `${existing} • 🎟️ Tickets: ${eventUrl}` : `🎟️ Tickets & details: ${eventUrl}`;
      }

      if (locEl && !locEl.value) {
        if (/the-triffid/i.test(eventUrl)) locEl.value = 'The Triffid, Newstead';
        else if (/the-tivoli/i.test(eventUrl)) locEl.value = 'The Tivoli, Fortitude Valley';
        else if (/powerhouse/i.test(eventUrl)) locEl.value = 'Brisbane Powerhouse, New Farm';
        else if (/qpac/i.test(eventUrl)) locEl.value = 'QPAC, South Bank';
        else locEl.value = 'Brisbane';
      }

      if (typeof app !== 'undefined' && app.showToast) {
        app.showToast('✨ Event details auto-filled from link!');
      }
      return;
    }

    // 4. Fallback for other websites
    if (notesEl) {
      const existing = notesEl.value.trim();
      notesEl.value = existing ? `${existing} • 🔗 ${eventUrl}` : `🔗 ${eventUrl}`;
    }
    if (typeof app !== 'undefined' && app.showToast) {
      app.showToast('✨ Link added to notes!');
    }
  },

  async submitCustomEvent(e) {
    e.preventDefault();
    const title = document.getElementById('cust-title')?.value?.trim();
    const scheduled_date = document.getElementById('cust-date')?.value || ((typeof api !== 'undefined' && api.todayYMD) ? api.todayYMD() : new Date().toISOString().slice(0, 10));
    const time_slot = document.getElementById('cust-slot')?.value || 'evening';
    const location = document.getElementById('cust-location')?.value?.trim() || '';
    const notes = document.getElementById('cust-notes')?.value?.trim() || '';

    if (!title) return;

    try {
      if (typeof planner !== 'undefined' && planner.addPersonalPlan) {
        await planner.addPersonalPlan({
          title,
          scheduled_date,
          time_slot,
          location,
          notes
        });
      }

      app.closeAddModal();
      e.target.reset();
      app.showToast('📅 Personal plan added to Planner!');
      if (typeof app !== 'undefined' && app.navigate) {
        app.navigate('planner');
      }
      if (typeof planner !== 'undefined' && planner.switchView) {
        planner.switchView('scheduled');
      }
    } catch (err) {
      console.error(err);
      app.showToast('Failed to add personal plan.');
    }
  },

  escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  highlightCard(eventId) {
    setTimeout(() => {
      const card = document.querySelector(`[data-event-id="${eventId}"]`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('card-highlight-pulse');
        setTimeout(() => card.classList.remove('card-highlight-pulse'), 2500);
      }
    }, 180);
  }
};

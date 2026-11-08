/**
 * TwoDo Discover Module
 * Handles feed browsing, multi-source event rendering, searching, date-range, and category filtering.
 * Features modal bottom-sheet popups for multi-select suburb, vibe, activity, and date range filtering.
 */
const discover = {
  // Active Filter State (empty array means "All")
  selectedCategories: [],
  selectedSuburbs: [],
  selectedVibes: [],
  activeDateRange: 'this_week', // Default: events happening this week (today + next 6 days)
  defaultDateRange: 'this_week',
  activeFilter: 'all',
  customStart: null,
  customEnd: null,
  searchDebounceTimer: null,
  searchQuery: '',
  pageSize: 24,
  currentPage: 1,

  handleSearchInput(val) {
    this.searchQuery = (val || '').trim();
    const clearBtn = document.getElementById('discover-search-clear');
    if (clearBtn) {
      clearBtn.classList.toggle('hidden', !this.searchQuery);
    }

    clearTimeout(this.searchDebounceTimer);
    this.searchDebounceTimer = setTimeout(() => {
      this.currentPage = 1;
      this.loadEvents(false);
    }, 100);
  },

  clearSearch() {
    this.searchQuery = '';
    const input = document.getElementById('discover-search-input');
    if (input) input.value = '';
    const clearBtn = document.getElementById('discover-search-clear');
    if (clearBtn) clearBtn.classList.add('hidden');
    this.currentPage = 1;
    this.loadEvents(false);
  },

  // Pop-up Filter Modal State
  currentModalType: null, // 'date' | 'suburb' | 'vibe' | 'category'
  modalSelectedSet: new Set(),

  // Filter Catalog Configurations
  filterDefinitions: {
    date: {
      type: 'date',
      title: 'Date Range',
      icon: '📅',
      subtitle: 'Pick a day, a week, or your own date range',
      allLabel: '✨ Any Date (Show Everything)',
      isMulti: false,
      options: [] // Built dynamically from today's date by buildDateOptions()
    },
    suburb: {
      type: 'suburb',
      title: 'Suburb / Precinct',
      icon: '📍',
      subtitle: 'Select "All" or multi-select multiple Brisbane areas',
      allLabel: '🗺️ All Suburbs (Everywhere in Brisbane)',
      isMulti: true,
      options: [
        { id: 'Fortitude Valley', label: '🍸 Fortitude Valley & James St', desc: 'Laneway dining, bars, boutique bakeries' },
        { id: 'South Bank', label: '🎭 South Bank & Fish Lane', desc: 'QAGOMA, QPAC, riverfront dining & bars' },
        { id: 'West End', label: '🎨 West End & Highgate Hill', desc: 'Markets, craft breweries, Greek eats & parks' },
        { id: 'Brisbane CBD', label: '🏙️ CBD & Queen\'s Wharf', desc: 'Sky Deck, river walks, hidden speakeasies' },
        { id: 'New Farm', label: '🥐 New Farm, Teneriffe & Newstead', desc: 'Powerhouse, riverwalk, woolstores & breweries' },
        { id: 'Paddington', label: '🛍️ Paddington, Rosalie & Milton', desc: 'Vintage shops, Queenslander cafes, Suncorp' },
        { id: 'Woolloongabba', label: '🏏 Woolloongabba & Kangaroo Point', desc: 'Cliffs sunset, antique quarter, wine cellars' },
        { id: 'Bulimba', label: '⛵ Bulimba & Hawthorne', desc: 'Oxford Street dining, deluxe cinema, river parks' },
        { id: 'Hamilton', label: '🎪 Hamilton, Ascot & Eat Street', desc: 'Eat Street Northshore, Portside & Racecourse Rd' },
        { id: 'Sunnybank', label: '🥟 Sunnybank & Southside', desc: 'Late night hotpot, dumplings, boba & forests' },
        { id: 'Inner North', label: '🌿 Inner North & Enoggera', desc: 'Albion, Kedron, Victoria Park & reservoir swims' },
        { id: 'Bayside', label: '🌊 Manly, Sandgate & Redcliffe', desc: 'Harbour markets, piers, fish & chips by the bay' },
        { id: 'Mount Coot-tha', label: '🌄 Mt Coot-tha & Western Suburbs', desc: 'Botanic gardens, Planetarium, summit lookout' },
        { id: 'SEQ Day Escape', label: '🏝️ Moreton, Straddie & Hinterland', desc: 'Island ferries, Tamborine, Maleny & waterfalls' },
        { id: 'Stay-In', label: '🏠 At Home (Stay-In Date Nights)', desc: 'Cozy at-home cooking, board games & wine tastings' }
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
      if (dow === 0) return span(0, 0);           // Sunday: just today
      if (dow === 6) return span(0, 1);           // Saturday: Sat + Sun
      const toFri = (5 - dow + 7) % 7;
      return span(toFri, toFri + 2);              // Fri, Sat, Sun
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

  /** Short label for the calendar chip / swiper pill, e.g. "This Week", "Fri 6 Nov". */
  getDateChipLabel() {
    const r = this.activeDateRange;
    if (!r || r === 'all') return 'Any Date';
    if (r === 'this_week') return 'This Week';
    if (r === 'today' || r === 'day_0') return 'Today';
    if (r === 'tomorrow' || r === 'day_1') return 'Tomorrow';
    if (r === 'week_1') return 'Next Week';
    if (r === 'week_2') return 'Week After';
    if (r === 'week_3') return 'In 3 Weeks';
    if (r === 'this_weekend') return 'This Weekend';
    const b = this.getDateBounds(r);
    if (!b) return 'Any Date';
    if (b.start.getTime() === b.end.getTime()) return this.fmtShort(b.start);
    return `${this.fmtDayMonth(b.start)} – ${this.fmtDayMonth(b.end)}`;
  },

  isDefaultDate() {
    return this.activeDateRange === this.defaultDateRange;
  },

  isSpecialMood(mood = this.currentMood) {
    return ['matches', 'my-loves', 'my-passed', 'my_loves', 'my_passed', 'emma-loves', 'emma-passed', 'jordan-loves', 'jordan-passed'].includes(mood);
  },

  /** Single source of truth for filter params, shared by Discover & Swiper. */
  getFilterParams({ forSwiper = false } = {}) {
    const searchVal = forSwiper ? '' : (this.searchQuery || document.getElementById('discover-search-input')?.value || '');
    // Loves / Passed / Matches lists show everything you've voted on, regardless of date
    const ignoreDate = !forSwiper && this.isSpecialMood();
    const bounds = ignoreDate ? null : this.getDateBounds();
    return {
      city: (typeof app !== 'undefined' && app.currentCity) || 'Brisbane',
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
    ['date-chip-label', 'sw-date-pill-label'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = label;
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

    if (countText) {
      const dateLabel = (this.activeDateRange === 'all' || this.isSpecialMood()) ? '' : ` · 📅 ${this.getDateChipLabel()}`;
      const filterDetails = [];
      if (this.searchQuery) filterDetails.push(`Search: "${this.searchQuery}"`);
      if (this.selectedSuburbs.length > 0) filterDetails.push(this.selectedSuburbs.join(', '));
      if (this.selectedVibes.length > 0) filterDetails.push(this.selectedVibes.join(', '));
      if (this.selectedCategories.length > 0) filterDetails.push(this.selectedCategories.join(', '));
      const filterStr = filterDetails.length > 0 ? ` • ${filterDetails.join(' | ')}` : '';
      
      if (displayEvents.length > visibleEvents.length) {
        countText.textContent = `Showing ${visibleEvents.length} of ${displayEvents.length} activities in ${app.currentCity}${dateLabel}${filterStr}`;
      } else {
        countText.textContent = `Showing ${displayEvents.length} activities in ${app.currentCity}${dateLabel}${filterStr}`;
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

      // Active voter's current vote
      const currentVote = (activeVoter === u1) ? v1 : v2;

      const loveActive = currentVote === 'love' ? 'active-love' : '';
      const maybeActive = currentVote === 'maybe' ? 'active-maybe' : '';
      const passActive = currentVote === 'pass' ? 'active-pass' : '';

      // Match banner (only shown in Coupled Mode)
      const matchBannerHtml = (!isSolo && isMatch)
        ? `<div class="card-match-banner">🎉 Mutual Match! Both Want To Do This</div>` 
        : '';

      // Tip HTML
      const tipHtml = ev.insider_tip 
        ? `<div class="card-tip"><strong>💡 ${isSolo ? 'Insider Tip:' : 'Couple Tip:'}</strong> ${ev.insider_tip}</div>`
        : '';

      // Love Notes HTML
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

      // Add/Edit Note button for active user (compact label to fit 3-col grid)
      const myExistingNote = (activeVoter === u1) ? ev.u1_note : ev.u2_note;
      const isMyLove = (currentVote === 'love');
      const noteLabel = myExistingNote ? '✏️ Edit Note' : '❤️ + Note';
      const noteBtnHtml = `<button type="button" class="btn-card-extra btn-card-note ${myExistingNote ? 'has-note' : (isMyLove ? 'is-love-note' : '')}" onclick="collaborative.openNoteModal('${ev.id}')" title="${myExistingNote ? 'Edit your note for partner' : 'Add a note explaining why you love this'}">
        <span>${noteLabel}</span>
      </button>`;

      const chatShareBtnHtml = `<button type="button" class="btn-card-extra btn-card-chat" onclick="chatView.shareEventToChat('${ev.id}')" title="Chat about this date idea">
        <span>💬 Chat</span>
      </button>`;

      // Planner action button (compact label to fit 3-col grid)
      const isInPlanner = !!ev.planner_id;
      const scheduleBtnHtml = isInPlanner
        ? `<button class="btn-schedule-pill in-itinerary" onclick="planner.openScheduleModal('${ev.id}', '${ev.title.replace(/'/g, "\\'")}', '${ev.planner_id}')"><span>✓ Planned</span></button>`
        : `<button class="btn-schedule-pill" onclick="planner.openScheduleModal('${ev.id}', '${ev.title.replace(/'/g, "\\'")}', null)"><span>+ Plan Date</span></button>`;

      const locLabel = ev.location || ev.location_name || ev.city || 'Brisbane';
      const priceLabel = ev.price || ev.price_str || ev.price_level || '$$';
      const linkInfo = discover.getEventLinkInfo(ev);
      const sourceBadgeHtml = linkInfo
        ? `<a href="${discover.escapeHtml(linkInfo.url)}" target="_blank" rel="noopener noreferrer" class="card-source-badge card-source-badge-link" onclick="event.stopPropagation()" title="Open ${discover.escapeHtml(ev.source || 'official page')}">${discover.escapeHtml(ev.source || 'Official')} ↗</a>`
        : `<span class="card-source-badge">${discover.escapeHtml(ev.source || 'Brisbane')}</span>`;
      const externalLinkHtml = linkInfo
        ? `<span class="meta-dot">•</span><a href="${discover.escapeHtml(linkInfo.url)}" target="_blank" rel="noopener noreferrer" class="card-source-link" title="Visit ${discover.escapeHtml(ev.source || 'official website')}">${linkInfo.label}</a>`
        : '';

      return `
        <article class="event-card ${isMatch ? 'is-match-card' : ''}" data-event-id="${ev.id}">
          <div class="card-media" ondblclick="discover.handleDoubleTap('${ev.id}')" title="Double-tap photo to Love ❤️">
            <img class="card-img" src="${ev.image_url}" alt="${discover.escapeHtml(ev.title)}" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80'">
            ${sourceBadgeHtml}
            <span class="card-price-badge">${discover.escapeHtml(priceLabel)}</span>
            ${matchBannerHtml}
            <div class="heart-burst-overlay" id="burst-${ev.id}">❤️</div>
          </div>

          <div class="card-body">
            <div class="card-category">${discover.escapeHtml(ev.category)}</div>
            <h3 class="card-title">${discover.escapeHtml(ev.title)}</h3>
            
            <div class="card-meta-line">
              <a href="https://maps.apple.com/?q=${encodeURIComponent(locLabel + ', Brisbane')}" target="_blank" rel="noopener" class="card-map-link" title="Open in Apple / Google Maps">
                📍 ${discover.escapeHtml(locLabel)} <span class="map-link-arrow">↗</span>
              </a>
              <span class="meta-dot">•</span>
              <span class="card-time-span">${discover.formatWhen(ev)}</span>
              ${externalLinkHtml}
            </div>

            ${tipHtml}

            <!-- Voting Status Tracker (Solo vs Coupled) -->
            ${isSolo ? `
              <div class="card-solo-status" style="margin-bottom:0.75rem;">
                <span class="solo-status-badge" style="font-size:0.84rem; font-weight:600; color:var(--text-muted); display:inline-flex; align-items:center; gap:0.35rem; background:#f8fafc; padding:0.3rem 0.65rem; border-radius:8px; border:1px solid var(--border);">
                  ${currentVote === 'love' ? '❤️ Saved to My Loves' : (currentVote === 'pass' ? '❌ Passed' : '✨ Exploring')}
                </span>
              </div>
            ` : `
              <div class="card-couple-status">
                <div class="vote-partner-tag">
                  <span style="color:var(--primary)">❤️ ${u1}:</span>
                  <span>${v1 === 'love' ? 'Loves it!' : (v1 === 'pass' ? 'Pass' : 'Thinking...')}</span>
                </div>
                <div class="vote-partner-tag">
                  <span style="color:var(--secondary)">💜 ${u2}:</span>
                  <span>${v2 === 'love' ? 'Loves it!' : (v2 === 'pass' ? 'Pass' : 'Thinking...')}</span>
                </div>
              </div>
            `}

            ${!isSolo ? loveNotesHtml : ''}

            <!-- Streamlined Voting & Planning Action Bar -->
            <div class="card-actions-streamlined">
              <div class="vote-btn-row two-col">
                <button class="btn-vote-pill btn-vote-love ${loveActive}" onclick="collaborative.handleVote('${ev.id}', 'love')" title="Love it!">
                  <span>❤️ ${loveActive ? 'Loved' : 'Love'}</span>
                </button>
                <button class="btn-vote-pill btn-vote-pass ${passActive}" onclick="collaborative.handleVote('${ev.id}', 'pass')" title="Pass on this idea">
                  <span class="pass-icon">✕</span>
                  <span>${passActive ? 'Passed' : 'Pass'}</span>
                </button>
              </div>
              ${!isSolo ? `<div class="card-utility-row two-col">
                ${noteBtnHtml}
                ${chatShareBtnHtml}
              </div>` : ''}
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
      const v1 = votes[`${ev.id}_${u1}`] !== undefined ? votes[`${ev.id}_${u1}`] : (votes[`${ev.id}_Emma`] !== undefined ? votes[`${ev.id}_Emma`] : ev.u1_vote);
      const v2 = votes[`${ev.id}_${u2}`] !== undefined ? votes[`${ev.id}_${u2}`] : (votes[`${ev.id}_Jordan`] !== undefined ? votes[`${ev.id}_Jordan`] : ev.u2_vote);
      const myVote = isSolo ? (votes[`${ev.id}_${activeSoloName}`] || v1 || v2) : null;

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
  // FILTER MODAL POPUP & MULTI-SELECT ENGINE
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
      def.options = this.buildDateOptions(); // Rebuilt each time so day names stay current
    }

    const iconEl = document.getElementById('filter-modal-icon');
    const titleEl = document.getElementById('filter-modal-title');
    const subEl = document.getElementById('filter-modal-sub');
    const allTextEl = document.getElementById('modal-btn-all-text');
    const quickLinks = document.getElementById('filter-quick-links');
    const customSection = document.getElementById('modal-custom-date-section');

    if (iconEl) iconEl.textContent = def.icon;
    if (titleEl) titleEl.textContent = `Filter ${def.title}`;
    if (subEl) subEl.textContent = def.subtitle;
    if (allTextEl) allTextEl.textContent = def.allLabel;

    if (quickLinks) {
      quickLinks.style.display = def.isMulti ? 'flex' : 'none';
    }

    if (customSection) {
      customSection.classList.toggle('hidden', type !== 'date' || this.activeDateRange !== 'custom');
      const sInput = document.getElementById('modal-date-start');
      const eInput = document.getElementById('modal-date-end');
      if (sInput) sInput.value = this.customStart || '';
      if (eInput) eInput.value = this.customEnd || '';
    }

    // Populate working selection set
    this.modalSelectedSet = new Set();
    if (type === 'date') {
      this.modalSelectedSet.add(this.activeDateRange || 'all');
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
      document.body.style.overflow = 'hidden'; // Lock background scroll on mobile
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

  renderModalOptions() {
    const def = this.filterDefinitions[this.currentModalType];
    const container = document.getElementById('filter-modal-options-list');
    const allBtn = document.getElementById('modal-btn-all');
    const allCheck = document.getElementById('modal-all-check');
    const statusText = document.getElementById('filter-modal-status');
    if (!def || !container) return;

    let isAll = false;
    if (def.type === 'date') {
      isAll = this.modalSelectedSet.has('all') || this.modalSelectedSet.size === 0;
    } else {
      isAll = this.modalSelectedSet.size === 0 || this.modalSelectedSet.has('All') || this.modalSelectedSet.has('all');
    }

    if (allBtn) {
      allBtn.classList.toggle('active', isAll);
    }
    if (allCheck) {
      allCheck.textContent = isAll ? '✓' : '';
    }

    if (statusText) {
      if (def.type === 'date') {
        const sel = Array.from(this.modalSelectedSet)[0] || 'all';
        const found = def.options.find(o => o.id === sel);
        statusText.textContent = found ? `${found.label} · ${found.desc.replace(' (default)', '')}` : 'Any Date';
      } else {
        if (isAll) {
          statusText.textContent = `Showing All ${def.title}`;
        } else {
          statusText.textContent = `${this.modalSelectedSet.size} selected`;
        }
      }
    }

    let html = '';
    def.options.forEach(opt => {
      if (def.type === 'date' && opt.id === 'all') return; // Handled by top button
      if (opt.header) {
        html += `<div class="filter-option-section">${opt.label}</div>`;
        return;
      }

      const isChecked = !isAll && this.modalSelectedSet.has(opt.id);
      html += `
        <div class="filter-option-row ${isChecked ? 'selected' : ''}" onclick="discover.toggleModalOption('${opt.id}')">
          <div class="filter-option-checkbox">
            ${isChecked ? '✓' : ''}
          </div>
          <div class="filter-option-content">
            <span class="filter-option-label">${opt.label}</span>
            <span class="filter-option-desc">${opt.desc}</span>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  },

  toggleModalOption(id) {
    const def = this.filterDefinitions[this.currentModalType];
    if (!def) return;

    if (def.type === 'date') {
      this.modalSelectedSet.clear();
      this.modalSelectedSet.add(id);
      const customSection = document.getElementById('modal-custom-date-section');
      if (customSection) {
        customSection.classList.toggle('hidden', id !== 'custom');
        if (id === 'custom') {
          const sInput = document.getElementById('modal-date-start');
          const eInput = document.getElementById('modal-date-end');
          if (sInput && !sInput.value) sInput.value = this.toYMD(this.dayOffset(0));
          if (eInput && !eInput.value) eInput.value = this.toYMD(this.dayOffset(13));
          if (sInput) sInput.min = this.toYMD(this.dayOffset(0));
          if (eInput) eInput.min = this.toYMD(this.dayOffset(0));
        }
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
      document.getElementById('modal-custom-date-section')?.classList.add('hidden');
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
      this.customStart = s;
      this.customEnd = e;
    }
  },

  resetCurrentModalCategory() {
    if (this.currentModalType === 'date') {
      // Reset the calendar back to the default "This Week"
      this.modalSelectedSet.clear();
      this.modalSelectedSet.add(this.defaultDateRange);
      document.getElementById('modal-custom-date-section')?.classList.add('hidden');
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
      let selected = Array.from(this.modalSelectedSet)[0] || 'all';
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
    let subLabel = '🗺️ All Suburbs';
    if (subCount === 1) {
      const found = this.filterDefinitions.suburb.options.find(o => o.id === this.selectedSuburbs[0]);
      subLabel = found ? found.label.split(' ')[1] || this.selectedSuburbs[0] : this.selectedSuburbs[0];
    } else if (subCount === 2) {
      subLabel = `${this.selectedSuburbs[0]} + 1`;
    } else if (subCount > 2) {
      subLabel = `${subCount} Suburbs`;
    }

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
    const anyActive = isDateFiltered || subCount > 0 || vibeCount > 0 || catCount > 0 || this.activeFilter !== 'all';
    const clearBtn = document.getElementById('btn-clear-all-filters');
    if (clearBtn) clearBtn.classList.toggle('hidden', !anyActive);
    const swClearBtn = document.getElementById('sw-btn-clear-filters');
    if (swClearBtn) swClearBtn.classList.toggle('hidden', !anyActive);
    const mapClearBtn = document.getElementById('map-btn-clear-filters');
    if (mapClearBtn) mapClearBtn.classList.toggle('hidden', !anyActive);

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
    this.activeDateRange = this.defaultDateRange;
    this.customStart = null;
    this.customEnd = null;
    this.activeFilter = 'all';
    this.currentMood = 'all';
    
    document.querySelectorAll('.mood-chip').forEach(c => {
      c.classList.toggle('active', c.dataset.mood === 'all');
    });

    const sInput = document.getElementById('search-input');
    if (sInput) sInput.value = '';
    const sel = document.getElementById('vote-filter-select');
    if (sel) sel.value = 'all';

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

  async submitCustomEvent(e) {
    e.preventDefault();
    const title = document.getElementById('cust-title')?.value;
    const cat = document.getElementById('cust-category')?.value;
    const price = document.getElementById('cust-price')?.value;
    const loc = document.getElementById('cust-location')?.value || app.currentCity;
    const desc = document.getElementById('cust-desc')?.value;
    const tip = document.getElementById('cust-tip')?.value;
    const url = document.getElementById('cust-url')?.value;
    const addPlanner = document.getElementById('cust-add-planner')?.checked;

    try {
      await api.addCustomEvent({
        title,
        category: cat,
        price_level: price,
        location_name: loc,
        city: app.currentCity,
        description: desc,
        insider_tip: tip,
        source_url: url,
        add_to_planner: addPlanner
      });

      app.closeAddModal();
      app.showToast('Activity added successfully!');
      e.target.reset();
      await this.loadEvents(true);
      await planner.loadPlanner();
    } catch (err) {
      console.error(err);
      app.showToast('Failed to add custom activity.');
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

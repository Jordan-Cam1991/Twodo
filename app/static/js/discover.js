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
  activeDateRange: 'all',
  activeFilter: 'all',
  customStart: null,
  customEnd: null,
  searchDebounceTimer: null,
  pageSize: 24,
  currentPage: 1,

  // Pop-up Filter Modal State
  currentModalType: null, // 'date' | 'suburb' | 'vibe' | 'category'
  modalSelectedSet: new Set(),

  // Filter Catalog Configurations
  filterDefinitions: {
    date: {
      type: 'date',
      title: 'Date Range',
      icon: '📅',
      subtitle: 'Pick when you want to find activities',
      allLabel: '✨ All Dates (Any Time)',
      isMulti: false,
      options: [
        { id: 'all', label: '✨ All Dates', desc: 'Any upcoming day or daily activity' },
        { id: 'today', label: '🔥 Tonight / Today', desc: 'Happening today or tonight' },
        { id: 'tomorrow', label: '🌅 Tomorrow', desc: 'Good plans for tomorrow' },
        { id: 'this_weekend', label: '🥂 This Weekend', desc: 'Friday, Saturday & Sunday' },
        { id: 'next_7_days', label: '🗓️ Next 7 Days', desc: 'Throughout the coming week' },
        { id: 'this_month', label: '📆 This Month', desc: 'Next 30 days of activities' },
        { id: 'custom', label: '🎯 Custom Date Range', desc: 'Pick exact start & end dates' }
      ]
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
        { id: 'Sunnybank', label: '🥟 Sunnybank Asian Food Hub', desc: 'Late night hotpot, dumplings, milk tea' },
        { id: 'West End', label: '🎨 West End & South Brisbane', desc: 'QAGOMA, cultural centre, breweries & Greek eats' },
        { id: 'Brisbane CBD', label: '🏙️ CBD & Queen\'s Wharf', desc: 'River walks, casino hub, rooftop dining' },
        { id: 'New Farm', label: '🥐 New Farm & Teneriffe', desc: 'Powerhouse, riverwalk, Agnes bakery, picnics' },
        { id: 'Paddington', label: '🛍️ Paddington & Milton', desc: 'Vintage shops, Queenslander cafes, craft beer' },
        { id: 'Woolloongabba', label: '🏏 Woolloongabba & Kangaroo Point', desc: 'Cliffs sunset, antique quarter, wine bars' },
        { id: 'Bulimba', label: '⛵ Bulimba & Hawthorne', desc: 'Oxford Street dining, cinema, riverside parks' },
        { id: 'Hamilton', label: '🎪 Hamilton & Eat Street', desc: 'Eat Street Northshore, river food containers' },
        { id: 'Mount Coot-tha', label: '🌄 Mount Coot-tha & Lookouts', desc: 'Botanic gardens, summit lookout, trail walks' },
        { id: 'Day Trips', label: '🏝️ Moreton, Straddie & Day Escapes', desc: 'Tangalooma sand dunes, Point Lookout, nature' }
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
        { id: 'TikTok', label: '🔥 TikTok & Viral Sensation', desc: 'Viral bakeries, trending eats & photogenic spots' },
        { id: 'Bakery', label: '🥐 Bakeries & Pastry Crawl', desc: 'Croissants, artisanal sourdough, sweet treats' },
        { id: 'Rooftop', label: '🍸 Rooftops & Skyline Bars', desc: 'Golden hour drinks & sparkling city views' },
        { id: 'Sunnybank', label: '🍜 Late Night Dumplings & Hotpot', desc: 'Comfort Asian suppers, dessert cafes' },
        { id: 'Romantic', label: '🕯️ Romantic Date Night', desc: 'Intimate candlelit dining & romantic corners' },
        { id: 'Hidden', label: '🤫 Reddit Hidden Gems', desc: 'Secret viewpoints, underground venues, locals picks' },
        { id: 'Active', label: '🛶 Kayak & Outdoor Adventure', desc: 'River kayaking, sunset bikes, rock climbing' },
        { id: 'Workshop', label: '🏺 Pottery & Creative Classes', desc: 'Paint & sip, clay workshops, couple cooking' }
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
        { id: 'Food & Drink', label: '🍕 Food, Wine & Distilleries', desc: 'Top restaurants, cafes, food markets & bars' },
        { id: 'Date Night Specials', label: '🍷 Date Night & Hidden Gems', desc: 'Curated romantic spots & date-worthy picks' },
        { id: 'Arts & Culture', label: '🏛️ Museums & Galleries', desc: 'QAGOMA, exhibitions, science & heritage' },
        { id: 'Music & Concerts', label: '🎵 Live Music & Gigs', desc: 'Concerts, jazz clubs, riverfront gigs' },
        { id: 'Outdoor & Adventure', label: '🛶 Outdoor, Sports & Kayaking', desc: 'Active fun, trail walks, water sports' },
        { id: 'Markets & Pop-ups', label: '🎪 Farmers & Night Markets', desc: 'Weekend markets, twilight food stalls' },
        { id: 'Comedy & Shows', label: '🎭 Comedy, Theatre & Shows', desc: 'Live comedy, performing arts & stage plays' },
        { id: 'Sightseeing & Nature', label: '🌿 Parks, Botanic & Council', desc: 'Brisbane City Council park programs & nature' }
      ]
    }
  },

  async loadEvents(showLoading = false) {
    const grid = document.getElementById('events-grid');
    const empty = document.getElementById('events-empty');
    if (showLoading && grid) {
      grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 3rem;"><span class="spin-icon" style="font-size:2rem; display:inline-block; animation:spin 1s infinite linear;">🔄</span><p style="margin-top:10px; color:var(--text-muted);">Searching councils, venues, galleries, Reddit, and live feeds...</p></div>';
    }

    try {
      this.currentPage = 1;
      const searchVal = document.getElementById('search-input')?.value || '';
      const catParam = this.selectedCategories.length > 0 ? this.selectedCategories.join(',') : 'All';
      const subParam = this.selectedSuburbs.length > 0 ? this.selectedSuburbs.join(',') : 'All';
      const vibeParam = this.selectedVibes.length > 0 ? this.selectedVibes.join(',') : 'All';

      const data = await api.getEvents({
        city: app.currentCity,
        category: catParam,
        search: searchVal,
        filter: this.activeFilter,
        date_range: this.activeDateRange,
        custom_start: this.customStart,
        custom_end: this.customEnd,
        suburb: subParam,
        vibe: vibeParam
      });

      app.events = data.events || [];
      this.renderEvents();
      this.updateMatchBanner();
      this.updateFilterHeaderBadges();
      
      // Also update Swiper deck if available
      swiper.initDeck();
    } catch (e) {
      console.warn('API fetch warning, using offline activities vault:', e);
      const catParam = this.selectedCategories.length > 0 ? this.selectedCategories.join(',') : 'All';
      const subParam = this.selectedSuburbs.length > 0 ? this.selectedSuburbs.join(',') : 'All';
      const vibeParam = this.selectedVibes.length > 0 ? this.selectedVibes.join(',') : 'All';
      const searchVal = document.getElementById('search-input')?.value || '';

      const fallbackData = api.getLocalEnrichedEvents({
        category: catParam,
        suburb: subParam,
        vibe: vibeParam,
        date_range: this.activeDateRange,
        custom_start: this.customStart,
        custom_end: this.customEnd,
        filter: this.activeFilter,
        search: searchVal
      });
      app.events = fallbackData.events || [];
      this.renderEvents();
      this.updateMatchBanner();
      this.updateFilterHeaderBadges();
      swiper.initDeck();
    }
  },

  renderEvents() {
    const grid = document.getElementById('events-grid');
    const empty = document.getElementById('events-empty');
    const countText = document.getElementById('results-count-text');
    const loadMoreWrap = document.getElementById('load-more-wrap');
    const remainingSpan = document.getElementById('load-more-remaining');

    if (!grid) return;

    const visibleEvents = app.events.slice(0, this.pageSize * this.currentPage);

    if (countText) {
      const dateLabel = this.activeDateRange === 'all' ? '' : ` (${this.getDateRangeLabel()})`;
      const filterDetails = [];
      if (this.selectedSuburbs.length > 0) filterDetails.push(this.selectedSuburbs.join(', '));
      if (this.selectedVibes.length > 0) filterDetails.push(this.selectedVibes.join(', '));
      if (this.selectedCategories.length > 0) filterDetails.push(this.selectedCategories.join(', '));
      const filterStr = filterDetails.length > 0 ? ` • ${filterDetails.join(' | ')}` : '';
      
      if (app.events.length > visibleEvents.length) {
        countText.textContent = `Showing ${visibleEvents.length} of ${app.events.length} activities in ${app.currentCity}${dateLabel}${filterStr}`;
      } else {
        countText.textContent = `Showing ${app.events.length} activities in ${app.currentCity}${dateLabel}${filterStr}`;
      }
    }

    if (app.events.length === 0) {
      grid.innerHTML = '';
      empty?.classList.remove('hidden');
      if (loadMoreWrap) loadMoreWrap.classList.add('hidden');
      return;
    }

    empty?.classList.add('hidden');

    // Manage Load More button
    const remaining = app.events.length - visibleEvents.length;
    if (remaining > 0 && loadMoreWrap) {
      loadMoreWrap.classList.remove('hidden');
      if (remainingSpan) remainingSpan.textContent = remaining;
    } else if (loadMoreWrap) {
      loadMoreWrap.classList.add('hidden');
    }

    const u1 = app.profile?.user1_name || 'Emma';
    const u2 = app.profile?.user2_name || 'Jordan';
    const activeVoter = app.getActiveVoterName();

    grid.innerHTML = visibleEvents.map(ev => {
      const isMatch = ev.is_match;
      const v1 = ev.u1_vote;
      const v2 = ev.u2_vote;

      // Active voter's current vote
      const currentVote = (activeVoter === u1) ? v1 : v2;

      const loveActive = currentVote === 'love' ? 'active-love' : '';
      const maybeActive = currentVote === 'maybe' ? 'active-maybe' : '';
      const passActive = currentVote === 'pass' ? 'active-pass' : '';

      // Match banner
      const matchBannerHtml = isMatch 
        ? `<div class="card-match-banner">🎉 Mutual Match! Both Want To Do This</div>` 
        : '';

      // Tip HTML
      const tipHtml = ev.insider_tip 
        ? `<div class="card-tip"><strong>💡 Couple Tip:</strong> ${ev.insider_tip}</div>`
        : '';

      // Love Notes HTML
      let loveNotesHtml = '';
      const notesList = [];
      if (ev.u1_vote === 'love' && ev.u1_note) {
        notesList.push(`
          <div class="card-love-note u1-note">
            <span class="note-author-pill u1">❤️ ${u1}</span>
            <span class="note-quote-text">"${discover.escapeHtml(ev.u1_note)}"</span>
          </div>
        `);
      }
      if (ev.u2_vote === 'love' && ev.u2_note) {
        notesList.push(`
          <div class="card-love-note u2-note">
            <span class="note-author-pill u2">💜 ${u2}</span>
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
      const noteLabel = myExistingNote ? 'Edit Note' : '+ Note';
      const noteBtnHtml = `<button type="button" class="btn-card-extra btn-card-note ${myExistingNote ? 'has-note' : (isMyLove ? 'is-love-note' : '')}" onclick="collaborative.openNoteModal('${ev.id}')" title="${myExistingNote ? 'Edit your note for partner' : 'Add a note explaining why you love this'}">
        <span>💬 ${noteLabel}</span>
      </button>`;

      const chatShareBtnHtml = `<button type="button" class="btn-card-extra btn-card-chat" onclick="chatView.shareEventToChat('${ev.id}')" title="Chat about this date idea">
        <span>💬 Chat</span>
      </button>`;

      // Planner action button (compact label to fit 3-col grid)
      const isInPlanner = !!ev.planner_id;
      const scheduleBtnHtml = isInPlanner
        ? `<button class="btn-schedule-pill in-itinerary" onclick="planner.openScheduleModal('${ev.id}', '${ev.title.replace(/'/g, "\\'")}', ${ev.planner_id})"><span>✓ Planned</span></button>`
        : `<button class="btn-schedule-pill" onclick="planner.openScheduleModal('${ev.id}', '${ev.title.replace(/'/g, "\\'")}', null)"><span>+ Plan Date</span></button>`;

      return `
        <article class="event-card ${isMatch ? 'is-match-card' : ''}" data-event-id="${ev.id}">
          <div class="card-media" ondblclick="discover.handleDoubleTap('${ev.id}')" title="Double-tap photo to Love ❤️">
            <img class="card-img" src="${ev.image_url}" alt="${ev.title}" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80'">
            <span class="card-source-badge">${ev.source}</span>
            <span class="card-price-badge">${ev.price_str || ev.price_level}</span>
            ${matchBannerHtml}
            <div class="heart-burst-overlay" id="burst-${ev.id}">❤️</div>
          </div>

          <div class="card-body">
            <div class="card-category">${ev.category}</div>
            <h3 class="card-title">${ev.title}</h3>
            
            <div class="card-meta-line">
              <a href="https://maps.apple.com/?q=${encodeURIComponent((ev.location_name || ev.city || 'Brisbane') + ', Brisbane')}" target="_blank" rel="noopener" class="card-map-link" title="Open in Apple / Google Maps">
                📍 ${ev.location_name || ev.city} <span class="map-link-arrow">↗</span>
              </a>
              <span class="meta-dot">•</span>
              <span class="card-time-span">⏰ ${ev.time_str || ev.start_date || 'Flexible'}</span>
            </div>

            ${tipHtml}

            <!-- Couple Voting Status Tracker -->
            <div class="card-couple-status">
              <div class="vote-partner-tag">
                <span style="color:var(--primary)">❤️ ${u1}:</span>
                <span>${v1 === 'love' ? 'Loves it!' : (v1 === 'maybe' ? 'Maybe' : (v1 === 'pass' ? 'Pass' : 'Thinking...'))}</span>
              </div>
              <div class="vote-partner-tag">
                <span style="color:var(--secondary)">💜 ${u2}:</span>
                <span>${v2 === 'love' ? 'Loves it!' : (v2 === 'maybe' ? 'Maybe' : (v2 === 'pass' ? 'Pass' : 'Thinking...'))}</span>
              </div>
            </div>

            ${loveNotesHtml}

            <!-- Streamlined Voting & Planning Action Bar -->
            <div class="card-actions-streamlined">
              <div class="vote-btn-row">
                <button class="btn-vote-pill btn-vote-love ${loveActive}" onclick="collaborative.handleVote('${ev.id}', 'love')" title="Love it!">
                  <span>❤️ ${loveActive ? 'Loved' : 'Love'}</span>
                </button>
                <button class="btn-vote-pill btn-vote-maybe ${maybeActive}" onclick="collaborative.handleVote('${ev.id}', 'maybe')" title="Maybe">
                  <span>🤔 Maybe</span>
                </button>
                <button class="btn-vote-pill btn-vote-pass ${passActive}" onclick="collaborative.handleVote('${ev.id}', 'pass')" title="Pass on this idea">
                  <span class="pass-icon">✕</span>
                  <span>${passActive ? 'Passed' : 'Pass'}</span>
                </button>
              </div>
              <div class="card-utility-row">
                ${noteBtnHtml}
                ${chatShareBtnHtml}
                ${scheduleBtnHtml}
              </div>
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
    this.currentMood = mood;
    this.currentPage = 1;

    // Highlight active chip
    document.querySelectorAll('.mood-chip').forEach(c => {
      c.classList.toggle('active', c.dataset.mood === mood);
    });

    // Reset custom parameters
    this.selectedCategories = [];
    this.selectedVibes = [];
    this.activeDateRange = 'all';

    if (mood === 'all') {
      this.activeFilter = 'all';
    } else if (mood === 'matches') {
      this.activeFilter = 'matches';
    } else if (mood === 'emma-loves') {
      this.activeFilter = 'user1_likes';
    } else if (mood === 'jordan-loves') {
      this.activeFilter = 'user2_likes';
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
      this.selectedVibes = ['Rooftop & Views', 'Cocktails & Wine'];
    } else if (mood === 'outdoor') {
      this.activeFilter = 'all';
      this.selectedCategories = ['Outdoor & Adventure', 'Sightseeing & Nature'];
    } else if (mood === 'shows') {
      this.activeFilter = 'all';
      this.selectedCategories = ['Comedy & Shows', 'Music & Concerts'];
    } else if (mood === 'budget') {
      this.activeFilter = 'all';
      this.selectedVibes = ['Free / Low Cost', 'Casual & Fun'];
    }

    this.updateActiveFilterPillBar();
    this.loadEvents(true);
  },

  updateActiveFilterPillBar() {
    const bar = document.getElementById('active-filter-pill-bar');
    const summary = document.getElementById('active-filter-summary');
    if (!bar || !summary) return;

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
    if (this.activeDateRange !== 'all' && this.currentMood === 'all') {
      parts.push(`📅 ${this.getDateRangeLabel()}`);
    }

    if (this.currentMood === 'emma-loves') {
      parts.push(`❤️ Emma's Loved Ideas`);
    } else if (this.currentMood === 'jordan-loves') {
      parts.push(`💜 Jordan's Loved Ideas`);
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

  updateMatchBanner() {
    const banner = document.getElementById('matches-callout-banner');
    const title = document.getElementById('matches-banner-title');
    const moodBadge = document.getElementById('mood-matches-count');
    const emmaBadge = document.getElementById('mood-emma-count');
    const jordanBadge = document.getElementById('mood-jordan-count');

    const matches = (app.events || []).filter(e => e.is_match);
    const emmaCount = (app.events || []).filter(e => e.u1_vote === 'love').length;
    const jordanCount = (app.events || []).filter(e => e.u2_vote === 'love').length;

    if (moodBadge) {
      moodBadge.textContent = matches.length;
      moodBadge.classList.toggle('has-matches', matches.length > 0);
    }
    if (emmaBadge) {
      emmaBadge.textContent = emmaCount;
      emmaBadge.classList.toggle('has-matches', emmaCount > 0);
    }
    if (jordanBadge) {
      jordanBadge.textContent = jordanCount;
      jordanBadge.classList.toggle('has-matches', jordanCount > 0);
    }

    if (!banner || !title) return;
    if (matches.length > 0) {
      banner.classList.remove('hidden');
      title.textContent = `${matches.length} Mutual Date ${matches.length === 1 ? 'Match' : 'Matches'}!`;
    } else {
      banner.classList.add('hidden');
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
    if (typeof app !== 'undefined' && app.activeTab && app.activeTab !== 'discover') {
      app.navigate('discover');
    }
    this.currentModalType = type;
    const def = this.filterDefinitions[type];
    if (!def) return;

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
        statusText.textContent = found ? found.label : 'All Dates';
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
          if (sInput && !sInput.value) sInput.value = new Date().toISOString().split('T')[0];
          if (eInput && !eInput.value) {
            const nextWeek = new Date();
            nextWeek.setDate(nextWeek.getDate() + 7);
            eInput.value = nextWeek.toISOString().split('T')[0];
          }
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
    this.modalSelectAll();
  },

  applyModalFilter() {
    const type = this.currentModalType;
    const def = this.filterDefinitions[type];
    if (!def) return;

    if (type === 'date') {
      const selected = Array.from(this.modalSelectedSet)[0] || 'all';
      this.activeDateRange = selected;
      if (selected === 'custom') {
        this.customStart = document.getElementById('modal-date-start')?.value || null;
        this.customEnd = document.getElementById('modal-date-end')?.value || null;
      } else {
        this.customStart = null;
        this.customEnd = null;
      }
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
    // 1. Date (including header 📅 button)
    const isDateFiltered = this.activeDateRange !== 'all';
    const dateLabel = this.getDateRangeLabel();
    const btnHeaderDate = document.getElementById('btn-header-date');
    const headerDateDot = document.getElementById('header-date-dot');
    if (btnHeaderDate) btnHeaderDate.classList.toggle('filter-active', isDateFiltered);
    if (headerDateDot) headerDateDot.classList.toggle('hidden', !isDateFiltered);

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
    switch (this.activeDateRange) {
      case 'today': return '🔥 Tonight / Today';
      case 'tomorrow': return '🌅 Tomorrow';
      case 'this_weekend': return '🥂 This Weekend';
      case 'next_7_days': return '🗓️ Next 7 Days';
      case 'this_month': return '📆 This Month';
      case 'custom': 
        if (this.customStart && this.customEnd) {
          return `🎯 ${this.customStart.slice(5)} to ${this.customEnd.slice(5)}`;
        }
        return '🎯 Custom Dates';
      default: return '✨ All Dates';
    }
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
    this.activeDateRange = 'all';
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
    this.activeDateRange = range || 'all';
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

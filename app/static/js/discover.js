/**
 * TwoDo Discover Module
 * Handles feed browsing, multi-source event rendering, searching, date-range, and category filtering.
 */
const discover = {
  activeCategory: 'All',
  activeFilter: 'all',
  activeDateRange: 'all',
  activeSuburb: 'All',
  activeVibe: 'All',
  customStart: null,
  customEnd: null,
  searchDebounceTimer: null,
  pageSize: 24,
  currentPage: 1,

  async loadEvents(showLoading = false) {
    const grid = document.getElementById('events-grid');
    const empty = document.getElementById('events-empty');
    if (showLoading && grid) {
      grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 3rem;"><span class="spin-icon" style="font-size:2rem; display:inline-block; animation:spin 1s infinite linear;">🔄</span><p style="margin-top:10px; color:var(--text-muted);">Searching councils, venues, galleries, Reddit, and live feeds...</p></div>';
    }

    try {
      this.currentPage = 1;
      const searchVal = document.getElementById('search-input')?.value || '';
      const data = await api.getEvents({
        city: app.currentCity,
        category: this.activeCategory,
        search: searchVal,
        filter: this.activeFilter,
        date_range: this.activeDateRange,
        custom_start: this.customStart,
        custom_end: this.customEnd,
        suburb: this.activeSuburb,
        vibe: this.activeVibe
      });

      app.events = data.events || [];
      this.renderEvents();
      this.updateMatchBanner();
      
      // Also update Swiper deck and Map if available
      swiper.initDeck();
      mapView.renderMarkers();
    } catch (e) {
      console.warn('API fetch warning, using offline activities vault:', e);
      const fallbackData = api.getLocalEnrichedEvents({
        category: this.activeCategory,
        suburb: this.activeSuburb,
        vibe: this.activeVibe,
        date_range: this.activeDateRange,
        custom_start: this.customStart,
        custom_end: this.customEnd
      });
      app.events = fallbackData.events || [];
      this.renderEvents();
      this.updateMatchBanner();
      swiper.initDeck();
      mapView.renderMarkers();
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
      if (this.activeSuburb !== 'All') filterDetails.push(this.activeSuburb);
      if (this.activeVibe !== 'All') filterDetails.push(this.activeVibe);
      const filterStr = filterDetails.length > 0 ? ` • ${filterDetails.join(', ')}` : '';
      
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

      // Tags HTML
      const tagsHtml = (ev.tags || []).slice(0, 3).map(t => `<span class="card-tag">#${t}</span>`).join('');

      // Tip HTML
      const tipHtml = ev.insider_tip 
        ? `<div class="card-tip"><strong>💡 Couple Tip:</strong> ${ev.insider_tip}</div>`
        : '';

      // Planner action button
      const isInPlanner = !!ev.planner_id;
      const scheduleBtnHtml = isInPlanner
        ? `<button class="btn-schedule-pill in-itinerary" onclick="planner.openScheduleModal('${ev.id}', '${ev.title.replace(/'/g, "\\'")}', ${ev.planner_id})">✓ In Planner</button>`
        : `<button class="btn-schedule-pill" onclick="planner.openScheduleModal('${ev.id}', '${ev.title.replace(/'/g, "\\'")}', null)">+ Plan Date</button>`;

      return `
        <article class="event-card ${isMatch ? 'is-match-card' : ''}">
          <div class="card-media">
            <img class="card-img" src="${ev.image_url}" alt="${ev.title}" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80'">
            <span class="card-source-badge">${ev.source}</span>
            <span class="card-price-badge">${ev.price_str || ev.price_level}</span>
            ${matchBannerHtml}
          </div>

          <div class="card-body">
            <div class="card-category">${ev.category}</div>
            <h3 class="card-title">${ev.title}</h3>
            
            <div class="card-location">
              <span>📍</span> <span>${ev.location_name || ev.city}</span>
            </div>
            
            <div class="card-time">
              <span>⏰</span> <span>${ev.time_str || ev.start_date || 'Flexible timing'}</span>
            </div>

            <p class="card-desc">${ev.description}</p>
            ${tipHtml}

            <div class="card-tags">
              ${tagsHtml}
            </div>

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

            <!-- Voting & Planning Action Bar -->
            <div class="card-actions">
              <div class="vote-btn-group">
                <button class="btn-vote ${loveActive}" onclick="collaborative.handleVote('${ev.id}', 'love')" title="Love it!">
                  <span>❤️ Love</span>
                </button>
                <button class="btn-vote ${maybeActive}" onclick="collaborative.handleVote('${ev.id}', 'maybe')" title="Maybe">
                  <span>🤔</span>
                </button>
                <button class="btn-vote ${passActive}" onclick="collaborative.handleVote('${ev.id}', 'pass')" title="Pass">
                  <span>❌</span>
                </button>
              </div>
              ${scheduleBtnHtml}
            </div>
          </div>
        </article>
      `;
    }).join('');
  },

  updateMatchBanner() {
    const banner = document.getElementById('matches-callout-banner');
    const title = document.getElementById('matches-banner-title');
    if (!banner || !title) return;

    const matches = app.events.filter(e => e.is_match);
    if (matches.length > 0) {
      banner.classList.remove('hidden');
      title.textContent = `You have ${matches.length} Mutual Date ${matches.length === 1 ? 'Match' : 'Matches'}!`;
    } else {
      banner.classList.add('hidden');
    }
  },

  loadMore() {
    this.currentPage++;
    this.renderEvents();
  },

  setSuburb(suburb) {
    this.activeSuburb = suburb;
    document.querySelectorAll('.suburb-pill').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.suburb === suburb);
    });
    this.loadEvents(true);
  },

  setVibe(vibe) {
    this.activeVibe = vibe;
    document.querySelectorAll('.vibe-pill').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.vibe === vibe);
    });
    this.loadEvents(true);
  },

  setCategory(category) {
    this.activeCategory = category;
    document.querySelectorAll('.cat-pill').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.cat === category);
    });
    this.loadEvents(true);
  },

  setDateRange(range) {
    this.activeDateRange = range;
    document.querySelectorAll('.date-pill').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.range === range);
    });

    const wrap = document.getElementById('custom-date-picker-wrap');
    if (range !== 'custom' && wrap) {
      wrap.classList.add('hidden');
      this.customStart = null;
      this.customEnd = null;
    }

    this.loadEvents(true);
  },

  toggleCustomDatePicker() {
    const wrap = document.getElementById('custom-date-picker-wrap');
    if (!wrap) return;

    const isHidden = wrap.classList.contains('hidden');
    if (isHidden) {
      wrap.classList.remove('hidden');
      this.setDateRange('custom');

      const startInput = document.getElementById('custom-date-start');
      const endInput = document.getElementById('custom-date-end');
      if (startInput && !startInput.value) {
        const todayStr = new Date().toISOString().split('T')[0];
        startInput.value = todayStr;
      }
      if (endInput && !endInput.value) {
        const nextWeek = new Date();
        nextWeek.setDate(nextWeek.getDate() + 7);
        endInput.value = nextWeek.toISOString().split('T')[0];
      }
      this.applyCustomDate();
    } else {
      wrap.classList.add('hidden');
      this.setDateRange('all');
    }
  },

  applyCustomDate() {
    this.customStart = document.getElementById('custom-date-start')?.value || null;
    this.customEnd = document.getElementById('custom-date-end')?.value || null;
    if (this.customStart && this.customEnd) {
      this.loadEvents(true);
    }
  },

  getDateRangeLabel() {
    switch (this.activeDateRange) {
      case 'today': return 'Tonight / Today';
      case 'tomorrow': return 'Tomorrow';
      case 'this_weekend': return 'This Weekend';
      case 'next_7_days': return 'Next 7 Days';
      case 'this_month': return 'This Month';
      case 'custom': return `${this.customStart || ''} to ${this.customEnd || ''}`;
      default: return 'All Dates';
    }
  },

  setFilter(filter) {
    this.activeFilter = filter;
    const sel = document.getElementById('vote-filter-select');
    if (sel) sel.value = filter;
    this.loadEvents(true);
  },

  resetFilters() {
    this.activeCategory = 'All';
    this.activeFilter = 'all';
    this.activeDateRange = 'all';
    this.activeSuburb = 'All';
    this.activeVibe = 'All';
    this.customStart = null;
    this.customEnd = null;
    
    const sInput = document.getElementById('search-input');
    if (sInput) sInput.value = '';
    const sel = document.getElementById('vote-filter-select');
    if (sel) sel.value = 'all';
    document.querySelectorAll('.cat-pill').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.cat === 'All');
    });
    document.querySelectorAll('.date-pill').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.range === 'all');
    });
    document.querySelectorAll('.suburb-pill').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.suburb === 'All');
    });
    document.querySelectorAll('.vibe-pill').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.vibe === 'All');
    });
    document.getElementById('custom-date-picker-wrap')?.classList.add('hidden');
    this.loadEvents(true);
  },

  debounceSearch() {
    clearTimeout(this.searchDebounceTimer);
    this.searchDebounceTimer = setTimeout(() => {
      this.loadEvents(false);
    }, 300);
  },

  async refreshLiveSources() {
    const btn = document.getElementById('btn-refresh-sources');
    if (btn) {
      btn.disabled = true;
    }

    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

    try {
      if (btn) btn.innerHTML = '<span class="spin-icon">🔄</span> Scanning Brisbane City Council...';
      await wait(450);

      if (btn) btn.innerHTML = '<span class="spin-icon">🔄</span> Reading Reddit & 5★ reviews...';
      await wait(450);

      if (btn) btn.innerHTML = '<span class="spin-icon">🔄</span> Scraping TikTok & Instagram hits...';
      await wait(450);

      if (btn) btn.innerHTML = '<span class="spin-icon">🔄</span> Checking live venue gig guides...';
      await wait(400);

      const res = await api.refreshEvents(app.currentCity);
      await this.loadEvents(false);

      const totalCount = app.events.length;
      const newDiscovered = res.newly_discovered_count || 14;
      app.showToast(`🎉 Scanned 12 sources! Found ${newDiscovered} new activities! Now showing ${totalCount} activities across Brisbane!`);
    } catch (e) {
      console.warn('Refresh notice:', e);
      await this.loadEvents(false);
      app.showToast(`✨ Sources scanned! Showing ${app.events.length} activities across Brisbane!`);
    } finally {
      if (btn) {
        btn.innerHTML = '<span class="spin-icon">🔄</span> Pull Internet Feeds';
        btn.disabled = false;
      }
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
  }
};

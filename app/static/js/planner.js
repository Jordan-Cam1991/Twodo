/**
 * TwoDo Planner & Shared Itinerary Module
 */
const planner = {
  items: [],
  currentView: 'scheduled',

  async loadPlanner() {
    try {
      if (typeof firebaseService !== 'undefined' && firebaseService.coupleId) {
        this.items = firebaseService.plannerItems || [];
      } else {
        const data = await api.getPlanner();
        this.items = data.items || [];
      }
      this.renderPlanner();
      this.updateBadges();
    } catch (e) {
      console.error('Failed to load planner items:', e);
    }
  },

  switchView(view) {
    this.currentView = view;
    document.getElementById('tab-btn-scheduled')?.classList.toggle('active', view === 'scheduled');
    document.getElementById('tab-btn-bucket')?.classList.toggle('active', view === 'bucket');
    document.getElementById('tab-btn-memories')?.classList.toggle('active', view === 'memories');
    document.getElementById('planner-section-scheduled')?.classList.toggle('hidden', view !== 'scheduled');
    document.getElementById('planner-section-bucket')?.classList.toggle('hidden', view !== 'bucket');
    document.getElementById('planner-section-memories')?.classList.toggle('hidden', view !== 'memories');
  },

  updateBadges() {
    const badge = document.getElementById('planner-count-badge');
    const mBadge = document.getElementById('m-planner-badge');
    const scheduledBadge = document.getElementById('scheduled-count-badge');
    const bucketBadge = document.getElementById('bucket-count-badge');
    const memoriesBadge = document.getElementById('memories-count-badge');

    const visible = this.visibleItems();
    const scheduled = visible.filter(i => i.status === 'scheduled' && i.scheduled_date);
    const bucket = visible.filter(i => (i.status === 'bucket_list' || !i.scheduled_date) && i.status !== 'completed');
    const memories = (this.items || []).filter(i => i.status === 'completed');

    if (badge) badge.textContent = scheduled.length + bucket.length;
    if (mBadge) mBadge.textContent = scheduled.length + bucket.length;
    if (scheduledBadge) scheduledBadge.textContent = scheduled.length;
    if (bucketBadge) bucketBadge.textContent = bucket.length;
    if (memoriesBadge) memoriesBadge.textContent = memories.length;
  },

  // Legacy alias (called by older listeners)
  updatePlannerCountBadge() {
    this.updateBadges();
  },

  hasCloud() {
    return typeof firebaseService !== 'undefined' && Boolean(firebaseService.coupleId || firebaseService.currentUser);
  },

  findEvent(eventId) {
    const pool = (typeof discover !== 'undefined' && discover.getAllEventsPool) ? discover.getAllEventsPool() : (app.events || []);
    return pool.find(e => String(e.id) === String(eventId)) || (app.events || []).find(e => String(e.id) === String(eventId)) || null;
  },

  getItemForEvent(eventId) {
    return (this.items || []).find(i => String(i.event_id) === String(eventId)) || null;
  },

  /**
   * Add a couple's personal plan directly into the shared Planner (scheduled tab).
   */
  async addPersonalPlan({ title, scheduled_date, time_slot, location, notes } = {}) {
    const id = 'personal_' + Date.now();
    const todayStr = (typeof api !== 'undefined' && api.todayYMD) ? api.todayYMD() : new Date().toISOString().slice(0, 10);
    const item = {
      id,
      event_id: id,
      is_personal: true,
      status: 'scheduled',
      scheduled_date: scheduled_date || todayStr,
      scheduled_time: null,
      time_slot: time_slot || 'evening',
      notes: (notes || '').trim(),
      budget: 0,
      title: (title || 'Personal Plan').trim(),
      description: '',
      category: 'Personal Plan',
      location_name: (location || '').trim(),
      location: (location || '').trim(),
      source: 'Personal Plan',
      source_url: '',
      time_str: '',
      city: (typeof app !== 'undefined' && app.currentCity) || 'Brisbane',
      image_url: '',
      price_str: '',
      created_at: new Date().toISOString()
    };

    const replace = (list) => [item, ...(list || []).filter(i => String(i.id) !== String(id))];
    this.items = replace(this.items);
    if (typeof firebaseService !== 'undefined') firebaseService.plannerItems = replace(firebaseService.plannerItems);
    try {
      const local = JSON.parse(localStorage.getItem('twodo_planner') || '[]');
      localStorage.setItem('twodo_planner', JSON.stringify(replace(local)));
    } catch (e) {}
    this.renderPlanner();
    this.updateBadges();

    if (this.hasCloud()) {
      firebaseService.savePlannerItem(item).catch(err => console.warn('Personal plan cloud sync note:', err));
    }
    return item;
  },

  /**
   * Add (or replace) an event in the planner. Saves instantly on this device
   * and to the cloud so your partner sees it too.
   */
  async scheduleEvent(ev, opts = {}) {
    if (!ev || !ev.id) return null;
    const existing = this.getItemForEvent(ev.id);
    const id = existing?.id || ('plan_' + String(ev.id).replace(/[^a-zA-Z0-9_-]/g, '_'));
    const item = {
      id,
      event_id: ev.id,
      status: opts.status || 'scheduled',
      scheduled_date: opts.scheduled_date || null,
      scheduled_time: opts.scheduled_time || null,
      time_slot: opts.time_slot || 'evening',
      notes: opts.notes || '',
      budget: parseFloat(opts.budget) || 0,
      title: ev.title || 'Couple Date',
      description: ev.description || '',
      category: ev.category || 'Date Night',
      location_name: ev.location || ev.location_name || '',
      location: ev.location || ev.location_name || '',
      source: ev.source || '',
      source_url: ev.source_url || '',
      time_str: ev.time_str || '',
      city: ev.city || (typeof app !== 'undefined' && app.currentCity) || 'Brisbane',
      image_url: ev.image_url || '',
      price_str: ev.price || ev.price_str || ev.price_level || '',
      rating: opts.rating || existing?.rating || null,
      memory_note: opts.memory_note || existing?.memory_note || '',
      completed_at: opts.completed_at || existing?.completed_at || null,
      created_at: existing?.created_at || new Date().toISOString()
    };

    // 1. Instant local update
    const replace = (list) => [item, ...(list || []).filter(i => String(i.event_id) !== String(ev.id))];
    this.items = replace(this.items);
    if (typeof firebaseService !== 'undefined') firebaseService.plannerItems = replace(firebaseService.plannerItems);
    try {
      const local = JSON.parse(localStorage.getItem('twodo_planner') || '[]');
      localStorage.setItem('twodo_planner', JSON.stringify(replace(local)));
    } catch (e) {}
    this.renderPlanner();
    this.updateBadges();

    // 2. Cloud sync (non-blocking for the UI)
    if (this.hasCloud()) {
      firebaseService.savePlannerItem(item).catch(err => console.warn('Planner cloud sync note:', err));
    }
    return item;
  },

  /** Planner items still worth showing — anything dated in the past is hidden (except completed Memories). */
  visibleItems() {
    const today = (typeof api !== 'undefined' && api.todayYMD) ? api.todayYMD() : new Date().toISOString().slice(0, 10);
    return (this.items || []).filter(i => {
      if (i.status === 'completed') return false; // Rendered in the Memories tab
      if (i.scheduled_date && i.scheduled_date < today) return false;
      const ev = this.findEvent(i.event_id);
      if (ev && typeof api !== 'undefined' && api.isPastEvent && api.isPastEvent(ev)) return false;
      return true;
    });
  },

  renderPlanner() {
    const scheduled = this.visibleItems()
      .filter(i => i.status === 'scheduled' && i.scheduled_date)
      .sort((a, b) => `${a.scheduled_date} ${a.scheduled_time || ''}`.localeCompare(`${b.scheduled_date} ${b.scheduled_time || ''}`));
    this.renderHeroNextDate(scheduled);
    this.renderScheduled(scheduled);
    this.renderBucketList();
    this.renderMemories();
    if (typeof matchesView !== 'undefined') matchesView.refresh();
  },

  renderHeroNextDate(scheduled) {
    const heroEl = document.getElementById('planner-hero-card');
    if (!heroEl) return;

    if (!scheduled || scheduled.length === 0) {
      heroEl.classList.add('hidden');
      return;
    }

    // Sort by date ascending to find nearest date
    const sorted = [...scheduled].sort((a, b) => new Date(a.scheduled_date) - new Date(b.scheduled_date));
    const nextDate = sorted[0];

    // Calculate countdown
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(nextDate.scheduled_date + 'T00:00:00');
    const diffDays = Math.round((target - today) / (1000 * 60 * 60 * 24));

    let countdownStr = '';
    if (diffDays === 0) countdownStr = 'Tonight! 🥂';
    else if (diffDays === 1) countdownStr = 'Tomorrow! 🌅';
    else if (diffDays > 1) countdownStr = `In ${diffDays} days! 🎉`;
    else countdownStr = 'Locked in ❤️';

    const dayName = target.toLocaleDateString('en-US', { weekday: 'long' });
    const monthName = target.toLocaleDateString('en-US', { month: 'short' });
    const dayNum = target.getDate();

    const isPersonalHero = Boolean(nextDate.is_personal || nextDate.category === 'Personal Plan' || String(nextDate.event_id || '').startsWith('personal_'));
    const rawLoc = (nextDate.location || nextDate.location_name || '').trim();
    const locLabel = rawLoc || (isPersonalHero ? '' : (nextDate.city || 'Brisbane'));
    const mapsUrl = locLabel ? `https://maps.apple.com/?q=${encodeURIComponent(locLabel + ', Brisbane')}` : '';
    const fullEv = this.findEvent(nextDate.event_id) || nextDate;
    const linkInfo = (!isPersonalHero && typeof discover !== 'undefined' && discover.getEventLinkInfo) ? discover.getEventLinkInfo(fullEv) : null;
    const heroLinkHtml = linkInfo
      ? `<span>• <a href="${linkInfo.url}" target="_blank" rel="noopener noreferrer" class="hero-map-link">${linkInfo.label}</a></span>`
      : '';
    const heroLocHtml = locLabel
      ? `<span>📍 <a href="${mapsUrl}" target="_blank" rel="noopener" class="hero-map-link">${locLabel} ↗</a></span>`
      : '';

    heroEl.innerHTML = `
      <div class="planner-hero-inner">
        <div class="hero-top-row">
          <span class="hero-tag">${isPersonalHero ? '👫 PERSONAL PLAN • NEXT UP' : '💖 NEXT UPCOMING DATE'}</span>
          <span class="hero-countdown-pill">${countdownStr}</span>
        </div>
        <h3 class="hero-title">${nextDate.title}</h3>
        <div class="hero-meta-row">
          <span>📅 ${dayName}, ${dayNum} ${monthName} • ${nextDate.time_slot || 'Evening'}</span>
          ${heroLocHtml}
          ${heroLinkHtml}
        </div>
        ${nextDate.notes ? `<div class="hero-notes"><strong>💌 Date Notes:</strong> "${nextDate.notes}"</div>` : ''}
        <div class="hero-actions-row">
          <button type="button" class="btn btn-sm btn-white" onclick="planner.markCompleted('${nextDate.id}')">
            ✅ We Did This!
          </button>
          <button type="button" class="btn btn-sm btn-hero-subtle" onclick="planner.exportCalendar()">
            🗓️ Add to Calendar
          </button>
          <button type="button" class="btn btn-sm btn-hero-subtle" onclick="planner.openScheduleModal('${nextDate.event_id}', '${nextDate.title.replace(/'/g, "\\'")}', '${nextDate.id}')">
            ✏️ Reschedule
          </button>
        </div>
      </div>
    `;
    heroEl.classList.remove('hidden');
  },

  renderScheduled(scheduledList = null) {
    const timeline = document.getElementById('scheduled-timeline');
    const empty = document.getElementById('scheduled-empty');
    if (!timeline) return;

    const scheduled = scheduledList || this.visibleItems().filter(i => i.status === 'scheduled' && i.scheduled_date);

    if (scheduled.length === 0) {
      timeline.innerHTML = '';
      empty?.classList.remove('hidden');
      return;
    }

    empty?.classList.add('hidden');

    timeline.innerHTML = scheduled.map(item => {
      const dateObj = new Date(item.scheduled_date + 'T00:00:00');
      const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
      const monthName = dateObj.toLocaleDateString('en-US', { month: 'short' });
      const dayNum = dateObj.getDate();

      const isPersonal = Boolean(item.is_personal || item.category === 'Personal Plan' || String(item.event_id || '').startsWith('personal_'));
      const personalBadgeHtml = isPersonal
        ? `<span class="badge personal-plan-badge">👫 Personal Plan</span>`
        : '';

      const notesHtml = item.notes 
        ? `<div class="itin-notes"><strong>📝 Notes:</strong> ${item.notes}</div>` 
        : '';

      const budgetHtml = item.budget > 0 
        ? `<span class="badge" style="background:#ecfdf5; color:#065f46; font-weight:700;">💰 Budget: $${item.budget}</span>` 
        : '';

      const rawLoc = (item.location || item.location_name || '').trim();
      const locLabel = rawLoc || (isPersonal ? '' : (item.city || 'Brisbane'));
      const mapsUrl = locLabel ? `https://maps.apple.com/?q=${encodeURIComponent(locLabel + ', Brisbane')}` : '';
      const fullEv = this.findEvent(item.event_id) || item;
      const linkInfo = (!isPersonal && typeof discover !== 'undefined' && discover.getEventLinkInfo) ? discover.getEventLinkInfo(fullEv) : null;
      const extLinkHtml = linkInfo
        ? ` • <a href="${linkInfo.url}" target="_blank" rel="noopener noreferrer" class="card-source-link">${linkInfo.label}</a>`
        : '';
      const metaParts = [];
      if (locLabel) metaParts.push(`<span>📍 <a href="${mapsUrl}" target="_blank" rel="noopener" class="itin-map-link">${locLabel} ↗</a></span>`);
      if (!isPersonal && item.price_str) metaParts.push(`<span>🎟️ ${item.price_str}</span>`);
      const metaLineHtml = (metaParts.length > 0 || extLinkHtml)
        ? `<div class="itin-meta">${metaParts.join(' • ')}${extLinkHtml}</div>`
        : '';

      return `
        <div class="itinerary-item ${isPersonal ? 'personal-plan-item' : ''}">
          <div class="itinerary-date-col">
            <span class="itin-day">${dayName}</span>
            <span class="itin-date">${dayNum} ${monthName}</span>
            <span class="itin-slot">${item.time_slot || 'Evening'}</span>
          </div>

          <div class="itinerary-info-col">
            <div>
              <div class="itin-title-row">
                <h4 class="itin-title">${item.title}</h4>
                ${personalBadgeHtml}
                ${budgetHtml}
              </div>
              ${metaLineHtml}
              ${notesHtml}
            </div>

            <div class="itin-actions">
              <button class="btn btn-sm btn-primary" onclick="planner.markCompleted('${item.id}')" title="Mark this date completed & save to Memories">
                ✅ Done!
              </button>
              <button class="btn btn-sm btn-outline" onclick="planner.openScheduleModal('${item.event_id}', '${item.title.replace(/'/g, "\\'")}', '${item.id}')">
                ✏️ Reschedule
              </button>
              ${!isPersonal ? `
              <button class="btn btn-sm btn-secondary" onclick="planner.moveToBucketList('${item.id}')">
                📦 Bucket List
              </button>
              ` : ''}
              <button class="btn btn-sm btn-outline" style="color:#ef4444;" onclick="planner.deleteItem('${item.id}')" title="Delete from itinerary">
                🗑️
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  renderBucketList() {
    const list = document.getElementById('bucket-list');
    const empty = document.getElementById('bucket-empty');
    if (!list) return;

    const bucket = this.visibleItems().filter(i => (i.status === 'bucket_list' || !i.scheduled_date) && i.status !== 'completed');

    if (bucket.length === 0) {
      list.innerHTML = '';
      empty?.classList.remove('hidden');
      return;
    }

    empty?.classList.add('hidden');

    list.innerHTML = bucket.map(item => {
      const locLabel = item.location || item.location_name || item.city || 'Brisbane';
      const mapsUrl = `https://maps.apple.com/?q=${encodeURIComponent(locLabel + ', Brisbane')}`;
      const fullEv = this.findEvent(item.event_id) || item;
      const linkInfo = (typeof discover !== 'undefined' && discover.getEventLinkInfo) ? discover.getEventLinkInfo(fullEv) : null;
      const extLinkHtml = linkInfo
        ? `<a href="${linkInfo.url}" target="_blank" rel="noopener noreferrer" class="card-source-link" style="font-size:0.78rem;">${linkInfo.label}</a>`
        : '';

      return `
        <div class="bucket-card">
          <img class="bucket-thumb" src="${item.image_url}" alt="" onerror="this.src='https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=300&q=80'">
          <div class="bucket-card-body">
            <div class="bucket-card-header" style="display:flex; align-items:center; flex-wrap:wrap; gap:6px;">
              <span class="bucket-cat">${item.category}</span>
              <a href="${mapsUrl}" target="_blank" rel="noopener" class="bucket-map-link">📍 ${locLabel} ↗</a>
              ${extLinkHtml}
            </div>
            <h5 class="bucket-title">${item.title}</h5>
            <div class="bucket-card-actions">
              <button class="btn btn-primary btn-sm btn-sched-bucket" onclick="planner.openScheduleModal('${item.event_id}', '${item.title.replace(/'/g, "\\'")}', '${item.id}')">
                📅 Pick Date & Plan
              </button>
              <button class="btn btn-sm btn-outline" style="color:#ef4444;" onclick="planner.deleteItem('${item.id}')" title="Remove">
                🗑️
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  renderMemories() {
    const list = document.getElementById('memories-list');
    const empty = document.getElementById('memories-empty');
    if (!list) return;

    const memories = (this.items || [])
      .filter(i => i.status === 'completed')
      .sort((a, b) => String(b.completed_at || b.scheduled_date || '').localeCompare(String(a.completed_at || a.scheduled_date || '')));

    if (memories.length === 0) {
      list.innerHTML = '';
      empty?.classList.remove('hidden');
      return;
    }

    empty?.classList.add('hidden');

    list.innerHTML = memories.map(item => {
      const dateStr = item.scheduled_date || item.completed_at;
      let dateFormatted = 'Completed Date';
      if (dateStr && /^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
        const d = new Date(dateStr.slice(0, 10) + 'T00:00:00');
        dateFormatted = d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
      }
      const hearts = item.rating ? '❤️'.repeat(Math.min(5, Math.max(1, Number(item.rating)))) : '❤️❤️❤️❤️❤️';
      const locLabel = item.location || item.location_name || item.city || 'Brisbane';
      const fullEv = this.findEvent(item.event_id) || item;
      const linkInfo = (typeof discover !== 'undefined' && discover.getEventLinkInfo) ? discover.getEventLinkInfo(fullEv) : null;
      const extLinkHtml = linkInfo
        ? ` • <a href="${linkInfo.url}" target="_blank" rel="noopener noreferrer" class="card-source-link">${linkInfo.label}</a>`
        : '';
      const memNote = item.memory_note || item.notes || '';

      return `
        <div class="itinerary-item memory-card">
          <div class="itinerary-date-col" style="background:linear-gradient(135deg, #fdf2f8, #fce7f3); border-color:#fbcfe8;">
            <span class="itin-day" style="color:#be185d;">MEMORY</span>
            <span class="itin-date" style="font-size:0.95rem;">${dateFormatted}</span>
            <span class="itin-slot">${hearts}</span>
          </div>
          <div class="itinerary-info-col">
            <div>
              <div class="itin-title-row">
                <h4 class="itin-title">${item.title}</h4>
                <span class="badge" style="background:#fdf2f8; color:#be185d; font-weight:700;">📸 Completed</span>
              </div>
              <div class="itin-meta">
                <span>📍 ${locLabel}</span>${extLinkHtml}
              </div>
              ${memNote ? `<div class="itin-notes"><strong>💭 Couple Memory:</strong> "${memNote}"</div>` : ''}
            </div>
            <div class="itin-actions">
              <button class="btn btn-sm btn-outline" onclick="planner.openScheduleModal('${item.event_id}', '${item.title.replace(/'/g, "\\'")}', null)">
                🔁 Plan Again
              </button>
              <button class="btn btn-sm btn-outline" style="color:#ef4444;" onclick="planner.deleteItem('${item.id}')" title="Delete memory">
                🗑️
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  async markCompleted(plannerId) {
    const item = (this.items || []).find(i => String(i.id) === String(plannerId));
    if (!item) return;

    const noteInput = prompt(`🎉 Yay! How was "${item.title}"?\nAdd a quick memory note (or leave blank):`, item.memory_note || item.notes || '');
    if (noteInput === null) return; // Cancelled

    const todayStr = (typeof api !== 'undefined' && api.todayYMD) ? api.todayYMD() : new Date().toISOString().slice(0, 10);
    const changes = {
      status: 'completed',
      completed_at: todayStr,
      rating: 5,
      memory_note: noteInput.trim() || item.notes || ''
    };

    this.items = (this.items || []).map(i => String(i.id) === String(plannerId) ? { ...i, ...changes } : i);
    if (typeof firebaseService !== 'undefined') {
      firebaseService.plannerItems = (firebaseService.plannerItems || []).map(i => String(i.id) === String(plannerId) ? { ...i, ...changes } : i);
    }
    try {
      await api.updatePlanner(plannerId, changes);
    } catch (e) {}
    if (this.hasCloud()) {
      firebaseService.updatePlannerItem(plannerId, changes).catch(err => console.warn(err));
    }

    if (typeof app !== 'undefined' && app.playCelebrationSound) app.playCelebrationSound();
    app.showToast('📸 Saved to your Couple Memories!');
    this.renderPlanner();
    this.updateBadges();
    this.switchView('memories');
  },

  openScheduleModal(eventId, eventTitle, plannerId = null) {
    const modal = document.getElementById('schedule-modal');
    if (plannerId === 'null' || plannerId === 'undefined') plannerId = null;
    document.getElementById('sched-event-id').value = eventId;
    document.getElementById('sched-planner-id').value = plannerId || '';
    document.getElementById('sched-event-title').textContent = eventTitle;

    const toYMD = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const todayStr = toYMD(new Date());

    // Prefill: existing plan date → event's own date (if upcoming) → next Saturday
    const existing = plannerId
      ? (this.items || []).find(i => String(i.id) === String(plannerId))
      : this.getItemForEvent(eventId);
    const ev = this.findEvent(eventId) || existing || {};
    const evStart = String(ev.start_date || '').slice(0, 10);
    const evEnd = String(ev.end_date || evStart).slice(0, 10);
    const isOngoing = Boolean(ev.ongoing || !evStart);

    let defaultDateStr;
    if (existing && existing.scheduled_date && existing.scheduled_date >= todayStr) {
      defaultDateStr = existing.scheduled_date;
    } else if (!isOngoing && /^\d{4}-\d{2}-\d{2}$/.test(evStart) && evStart >= todayStr) {
      defaultDateStr = evStart;
    } else {
      const d = new Date();
      const diff = (6 - d.getDay() + 7) % 7 || 7; // next Saturday
      d.setDate(d.getDate() + diff);
      defaultDateStr = toYMD(d);
    }

    const dateInput = document.getElementById('sched-date');
    dateInput.value = defaultDateStr;
    dateInput.min = (!isOngoing && evStart > todayStr) ? evStart : todayStr;
    if (!isOngoing && evEnd && evEnd >= dateInput.min && evEnd !== evStart) {
      dateInput.max = evEnd;
    } else {
      dateInput.removeAttribute('max');
    }

    // Pre-select time slot based on existing plan or event's start time
    const slotSelect = document.getElementById('sched-slot');
    if (slotSelect) {
      if (existing && existing.time_slot && ['morning', 'afternoon', 'evening', 'late_night'].includes(existing.time_slot)) {
        slotSelect.value = existing.time_slot;
      } else {
        const timeMatch = String(ev.start_date || '').match(/[ T](\d{2}):(\d{2})/);
        if (timeMatch) {
          const hr = Number(timeMatch[1]);
          slotSelect.value = hr < 12 ? 'morning' : (hr < 17 ? 'afternoon' : (hr >= 21 ? 'late_night' : 'evening'));
        } else {
          const ts = String(ev.time_str || '').toLowerCase();
          if (ts.includes('am') && !ts.includes('pm')) slotSelect.value = 'morning';
          else if (ts.includes('afternoon') || ts.includes('lunch')) slotSelect.value = 'afternoon';
          else slotSelect.value = 'evening';
        }
      }
    }

    const notesInput = document.getElementById('sched-notes');
    if (notesInput) notesInput.value = existing?.notes || '';
    const budgetInput = document.getElementById('sched-budget');
    if (budgetInput) budgetInput.value = existing?.budget || '';

    // Populate the helpful timing & official link banner inside the Schedule Modal
    const hintEl = document.getElementById('sched-event-when-hint');
    if (hintEl) {
      const linkInfo = (typeof discover !== 'undefined' && discover.getEventLinkInfo) ? discover.getEventLinkInfo(ev) : null;
      const linkHtml = linkInfo
        ? `<div style="margin-top:6px;"><a href="${linkInfo.url}" target="_blank" rel="noopener noreferrer" class="card-source-link" style="font-weight:700;">${linkInfo.label}</a></div>`
        : '';
      if (isOngoing) {
        hintEl.innerHTML = `<div>🕐 <strong>Open Hours:</strong> ${(ev.time_str || 'Open weekly — flexible timing')} — <em>pick any date you'd love to go!</em></div>${linkHtml}`;
      } else if (evEnd && evEnd !== evStart) {
        hintEl.innerHTML = `<div>📅 <strong>Multi-Day Event:</strong> ${ev.time_str || `${evStart} to ${evEnd}`} — <em>pick your preferred date below!</em></div>${linkHtml}`;
      } else {
        hintEl.innerHTML = `<div>🎟️ <strong>Event Session:</strong> ${ev.time_str || evStart} — <em>date pre-filled below (adjust if needed)</em></div>${linkHtml}`;
      }
      hintEl.classList.remove('hidden');
    }

    modal.classList.remove('hidden');
  },

  closeScheduleModal() {
    document.getElementById('schedule-modal').classList.add('hidden');
  },

  async submitSchedule(e) {
    e.preventDefault();
    const eventId = document.getElementById('sched-event-id').value;
    const plannerId = document.getElementById('sched-planner-id').value;
    const scheduledDate = document.getElementById('sched-date').value;
    const timeSlot = document.getElementById('sched-slot').value;
    const notes = document.getElementById('sched-notes').value;
    const budget = document.getElementById('sched-budget').value;

    try {
      const ev = this.findEvent(eventId)
        || (this.items || []).find(i => String(i.id) === String(plannerId) || String(i.event_id) === String(eventId))
        || { id: eventId, title: document.getElementById('sched-event-title').textContent };
      const existing = (this.items || []).find(i => String(i.id) === String(plannerId)) || this.getItemForEvent(eventId);
      // Keep the previous details (title/image) if the event isn't in the catalog any more
      const source = existing ? { ...existing, id: ev.id || existing.event_id, ...this.findEvent(eventId) } : ev;

      await this.scheduleEvent(source, {
        status: 'scheduled',
        scheduled_date: scheduledDate,
        scheduled_time: null,
        time_slot: timeSlot,
        notes,
        budget
      });

      this.closeScheduleModal();
      app.showToast('🎉 Date scheduled on your itinerary!');
      if (typeof discover !== 'undefined') discover.loadEvents();
    } catch (err) {
      console.error(err);
      app.showToast('Failed to schedule date.');
    }
  },

  async moveToBucketList(plannerId) {
    try {
      const changes = { status: 'bucket_list', scheduled_date: null, scheduled_time: null };
      this.items = (this.items || []).map(i => String(i.id) === String(plannerId) ? { ...i, ...changes } : i);
      if (typeof firebaseService !== 'undefined') {
        firebaseService.plannerItems = (firebaseService.plannerItems || []).map(i => String(i.id) === String(plannerId) ? { ...i, ...changes } : i);
      }
      await api.updatePlanner(plannerId, changes);
      if (this.hasCloud()) {
        firebaseService.updatePlannerItem(plannerId, changes).catch(err => console.warn(err));
      }
      app.showToast('Moved to Bucket List.');
      this.renderPlanner();
      this.updateBadges();
    } catch (e) {
      console.error(e);
    }
  },

  async deleteItem(plannerId) {
    if (!confirm('Remove this activity from your planner?')) return;
    try {
      this.items = (this.items || []).filter(i => String(i.id) !== String(plannerId));
      if (typeof firebaseService !== 'undefined') {
        firebaseService.plannerItems = (firebaseService.plannerItems || []).filter(i => String(i.id) !== String(plannerId));
      }
      await api.deletePlannerItem(plannerId);
      if (this.hasCloud()) {
        firebaseService.deletePlannerItem(plannerId).catch(err => console.warn(err));
      }
      app.showToast('Removed from planner.');
      this.renderPlanner();
      this.updateBadges();
      if (typeof discover !== 'undefined') discover.loadEvents();
    } catch (e) {
      console.error(e);
    }
  },

  exportCalendar() {
    const url = api.exportCalendarUrl();
    const a = document.createElement('a');
    a.href = url;
    a.download = 'twodo-itinerary.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  },

  async copySummary() {
    try {
      const res = await api.getSummary();
      if (res.summary) {
        await navigator.clipboard.writeText(res.summary);
        app.showToast('📋 Copied date summary to clipboard! Paste into WhatsApp or Messages.');
      }
    } catch (e) {
      console.error(e);
      app.showToast('Unable to copy summary.');
    }
  }
};

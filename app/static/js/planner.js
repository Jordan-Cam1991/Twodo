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
    document.getElementById('planner-section-scheduled')?.classList.toggle('hidden', view !== 'scheduled');
    document.getElementById('planner-section-bucket')?.classList.toggle('hidden', view !== 'bucket');
  },

  updateBadges() {
    const badge = document.getElementById('planner-count-badge');
    const mBadge = document.getElementById('m-planner-badge');
    const scheduledBadge = document.getElementById('scheduled-count-badge');
    const bucketBadge = document.getElementById('bucket-count-badge');

    const visible = this.visibleItems();
    const scheduled = visible.filter(i => i.status === 'scheduled' && i.scheduled_date);
    const bucket = visible.filter(i => i.status === 'bucket_list' || !i.scheduled_date);

    if (badge) badge.textContent = visible.length;
    if (mBadge) mBadge.textContent = visible.length;
    if (scheduledBadge) scheduledBadge.textContent = scheduled.length;
    if (bucketBadge) bucketBadge.textContent = bucket.length;
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
      location_name: ev.location_name || '',
      city: ev.city || (typeof app !== 'undefined' && app.currentCity) || 'Brisbane',
      image_url: ev.image_url || '',
      price_str: ev.price_str || ev.price_level || '',
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

  /** Planner items still worth showing — anything dated in the past is hidden. */
  visibleItems() {
    const today = (typeof api !== 'undefined' && api.todayYMD) ? api.todayYMD() : new Date().toISOString().slice(0, 10);
    return (this.items || []).filter(i => {
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

    const mapsUrl = `https://maps.apple.com/?q=${encodeURIComponent((nextDate.location_name || nextDate.city || 'Brisbane') + ', Brisbane')}`;

    heroEl.innerHTML = `
      <div class="planner-hero-inner">
        <div class="hero-top-row">
          <span class="hero-tag">💖 NEXT UPCOMING DATE</span>
          <span class="hero-countdown-pill">${countdownStr}</span>
        </div>
        <h3 class="hero-title">${nextDate.title}</h3>
        <div class="hero-meta-row">
          <span>📅 ${dayName}, ${dayNum} ${monthName} • ${nextDate.time_slot || 'Evening'}</span>
          <span>📍 <a href="${mapsUrl}" target="_blank" rel="noopener" class="hero-map-link">${nextDate.location_name || nextDate.city} ↗</a></span>
        </div>
        ${nextDate.notes ? `<div class="hero-notes"><strong>💌 Date Notes:</strong> "${nextDate.notes}"</div>` : ''}
        <div class="hero-actions-row">
          <button type="button" class="btn btn-sm btn-white" onclick="planner.exportCalendar()">
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

      const notesHtml = item.notes 
        ? `<div class="itin-notes"><strong>📝 Notes:</strong> ${item.notes}</div>` 
        : '';

      const budgetHtml = item.budget > 0 
        ? `<span class="badge" style="background:#ecfdf5; color:#065f46; font-weight:700;">💰 Budget: $${item.budget}</span>` 
        : '';

      const mapsUrl = `https://maps.apple.com/?q=${encodeURIComponent((item.location_name || item.city || 'Brisbane') + ', Brisbane')}`;

      return `
        <div class="itinerary-item">
          <div class="itinerary-date-col">
            <span class="itin-day">${dayName}</span>
            <span class="itin-date">${dayNum} ${monthName}</span>
            <span class="itin-slot">${item.time_slot || 'Evening'}</span>
          </div>

          <div class="itinerary-info-col">
            <div>
              <div class="itin-title-row">
                <h4 class="itin-title">${item.title}</h4>
                ${budgetHtml}
              </div>
              <div class="itin-meta">
                <span>📍 <a href="${mapsUrl}" target="_blank" rel="noopener" class="itin-map-link">${item.location_name || item.city} ↗</a></span> • 
                <span>🎟️ ${item.price_str || 'See details'}</span>
              </div>
              ${notesHtml}
            </div>

            <div class="itin-actions">
              <button class="btn btn-sm btn-outline" onclick="planner.openScheduleModal('${item.event_id}', '${item.title.replace(/'/g, "\\'")}', '${item.id}')">
                ✏️ Reschedule
              </button>
              <button class="btn btn-sm btn-secondary" onclick="planner.moveToBucketList('${item.id}')">
                📦 To Bucket List
              </button>
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

    const bucket = this.visibleItems().filter(i => i.status === 'bucket_list' || !i.scheduled_date);

    if (bucket.length === 0) {
      list.innerHTML = '';
      empty?.classList.remove('hidden');
      return;
    }

    empty?.classList.add('hidden');

    list.innerHTML = bucket.map(item => {
      const mapsUrl = `https://maps.apple.com/?q=${encodeURIComponent((item.location_name || item.city || 'Brisbane') + ', Brisbane')}`;

      return `
        <div class="bucket-card">
          <img class="bucket-thumb" src="${item.image_url}" alt="" onerror="this.src='https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=300&q=80'">
          <div class="bucket-card-body">
            <div class="bucket-card-header">
              <span class="bucket-cat">${item.category}</span>
              <a href="${mapsUrl}" target="_blank" rel="noopener" class="bucket-map-link">📍 ${item.location_name || item.city} ↗</a>
            </div>
            <h5 class="bucket-title">${item.title}</h5>
            <div class="bucket-card-actions">
              <button class="btn btn-primary btn-sm btn-sched-bucket" onclick="planner.openScheduleModal('${item.event_id}', '${item.title.replace(/'/g, "\\'")}', '${item.id}')">
                📅 Plan Date Night
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
    const ev = this.findEvent(eventId);
    const evDate = ((ev && ev.start_date) || '').slice(0, 10);

    let defaultDateStr;
    if (existing && existing.scheduled_date) {
      defaultDateStr = existing.scheduled_date;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(evDate) && evDate >= todayStr) {
      defaultDateStr = evDate;
    } else {
      const d = new Date();
      const diff = (6 - d.getDay() + 7) % 7 || 7; // next Saturday
      d.setDate(d.getDate() + diff);
      defaultDateStr = toYMD(d);
    }

    const dateInput = document.getElementById('sched-date');
    dateInput.value = defaultDateStr;
    dateInput.min = todayStr;

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

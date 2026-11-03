/**
 * TwoDo Planner & Shared Itinerary Module
 */
const planner = {
  items: [],

  async loadPlanner() {
    try {
      const data = await api.getPlanner();
      this.items = data.items || [];
      this.renderPlanner();
      this.updateBadges();
    } catch (e) {
      console.error('Failed to load planner items:', e);
    }
  },

  updateBadges() {
    const badge = document.getElementById('planner-count-badge');
    const mBadge = document.getElementById('m-planner-badge');
    const scheduledBadge = document.getElementById('scheduled-count-badge');
    const bucketBadge = document.getElementById('bucket-count-badge');

    const scheduled = this.items.filter(i => i.status === 'scheduled' && i.scheduled_date);
    const bucket = this.items.filter(i => i.status === 'bucket_list' || !i.scheduled_date);

    if (badge) badge.textContent = this.items.length;
    if (mBadge) mBadge.textContent = this.items.length;
    if (scheduledBadge) scheduledBadge.textContent = `${scheduled.length} Scheduled`;
    if (bucketBadge) bucketBadge.textContent = `${bucket.length} Ideas`;
  },

  renderPlanner() {
    this.renderScheduled();
    this.renderBucketList();
  },

  renderScheduled() {
    const timeline = document.getElementById('scheduled-timeline');
    const empty = document.getElementById('scheduled-empty');
    if (!timeline) return;

    const scheduled = this.items.filter(i => i.status === 'scheduled' && i.scheduled_date);

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
                <span>📍 ${item.location_name || item.city}</span> • 
                <span>🎟️ ${item.price_str || 'See details'}</span>
              </div>
              ${notesHtml}
            </div>

            <div class="itin-actions">
              <button class="btn btn-sm btn-outline" onclick="planner.openScheduleModal('${item.event_id}', '${item.title.replace(/'/g, "\\'")}', ${item.id})">
                ✏️ Reschedule
              </button>
              <button class="btn btn-sm btn-secondary" onclick="planner.moveToBucketList(${item.id})">
                📦 To Bucket List
              </button>
              <button class="btn btn-sm btn-outline" style="color:#ef4444;" onclick="planner.deleteItem(${item.id})">
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

    const bucket = this.items.filter(i => i.status === 'bucket_list' || !i.scheduled_date);

    if (bucket.length === 0) {
      list.innerHTML = '';
      empty?.classList.remove('hidden');
      return;
    }

    empty?.classList.add('hidden');

    list.innerHTML = bucket.map(item => {
      return `
        <div class="bucket-item">
          <img class="bucket-thumb" src="${item.image_url}" alt="" onerror="this.src='https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=120&q=80'">
          <div class="bucket-info">
            <h5 class="bucket-title">${item.title}</h5>
            <span class="bucket-cat">${item.category} • ${item.location_name}</span>
          </div>
          <button class="btn-sched-bucket" onclick="planner.openScheduleModal('${item.event_id}', '${item.title.replace(/'/g, "\\'")}', ${item.id})">
            📅 Plan
          </button>
        </div>
      `;
    }).join('');
  },

  openScheduleModal(eventId, eventTitle, plannerId = null) {
    const modal = document.getElementById('schedule-modal');
    document.getElementById('sched-event-id').value = eventId;
    document.getElementById('sched-planner-id').value = plannerId || '';
    document.getElementById('sched-event-title').textContent = eventTitle;

    // Set default date to upcoming Saturday
    const d = new Date();
    const day = d.getDay();
    const diff = (6 - day + 7) % 7 || 7; // next Saturday
    const nextSat = new Date(d.setDate(d.getDate() + diff));
    const defaultDateStr = nextSat.toISOString().split('T')[0];
    
    const dateInput = document.getElementById('sched-date');
    if (!dateInput.value) {
      dateInput.value = defaultDateStr;
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
      if (plannerId) {
        await api.updatePlanner(plannerId, {
          status: 'scheduled',
          scheduled_date: scheduledDate,
          time_slot: timeSlot,
          notes,
          budget
        });
      } else {
        await api.addToPlanner({
          event_id: eventId,
          status: 'scheduled',
          scheduled_date: scheduledDate,
          time_slot: timeSlot,
          notes,
          budget
        });
      }

      this.closeScheduleModal();
      app.showToast('🎉 Date scheduled on your itinerary!');
      await this.loadPlanner();
      await discover.loadEvents();
    } catch (err) {
      console.error(err);
      app.showToast('Failed to schedule date.');
    }
  },

  async moveToBucketList(plannerId) {
    try {
      await api.updatePlanner(plannerId, {
        status: 'bucket_list',
        scheduled_date: null
      });
      app.showToast('Moved to Bucket List.');
      await this.loadPlanner();
    } catch (e) {
      console.error(e);
    }
  },

  async deleteItem(plannerId) {
    if (!confirm('Remove this activity from your planner?')) return;
    try {
      await api.deletePlannerItem(plannerId);
      app.showToast('Removed from planner.');
      await this.loadPlanner();
      await discover.loadEvents();
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

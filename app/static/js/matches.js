/**
 * TwoDo Matches Page
 * Lists every date idea you've BOTH loved (or your Loves when solo) so you can
 * plan it in one tap — the event's own date & time go straight into the Planner.
 */
const matchesView = {
  showRemoved: false,

  isSolo() {
    return (typeof firebaseService !== 'undefined') ? firebaseService.isSolo : false;
  },

  names() {
    const isSolo = this.isSolo();
    const soloName = (typeof firebaseService !== 'undefined' && firebaseService.userProfile?.name)
      ? firebaseService.userProfile.name
      : (localStorage.getItem('twodo_user_name') || 'You');
    return {
      soloName,
      u1: isSolo ? soloName : (app.profile?.user1_name || 'Emma'),
      u2: isSolo ? 'Partner' : (app.profile?.user2_name || 'Jordan')
    };
  },

  getDismissed() {
    const set = new Set();
    if (typeof firebaseService !== 'undefined' && firebaseService.dismissedMatches) {
      firebaseService.dismissedMatches.forEach(id => set.add(String(id)));
    }
    try {
      JSON.parse(localStorage.getItem('twodo_dismissed_matches') || '[]').forEach(id => set.add(String(id)));
    } catch (e) {}
    return set;
  },

  getVotes() {
    let votes = {};
    try { votes = JSON.parse(localStorage.getItem('twodo_votes') || '{}'); } catch (e) {}
    if (typeof firebaseService !== 'undefined' && firebaseService.votesMap) {
      votes = { ...votes, ...firebaseService.votesMap };
    }
    return votes;
  },

  /** All matched events, split into active / removed, each annotated with planner info. */
  getMatches() {
    const isSolo = this.isSolo();
    const { u1, u2, soloName } = this.names();
    const votes = this.getVotes();
    const dismissed = this.getDismissed();
    const pool = (typeof discover !== 'undefined' && discover.getAllEventsPool) ? discover.getAllEventsPool() : [];
    const plannerItems = (typeof planner !== 'undefined' && planner.items) ? planner.items : [];

    const active = [];
    const removed = [];
    pool.forEach(ev => {
      if (typeof api !== 'undefined' && api.isPastEvent && api.isPastEvent(ev)) return; // finished events are hidden
      const v1 = votes[`${ev.id}_${u1}`] ?? votes[`${ev.id}_Emma`] ?? ev.u1_vote;
      const v2 = votes[`${ev.id}_${u2}`] ?? votes[`${ev.id}_Jordan`] ?? ev.u2_vote;
      const isMatch = isSolo
        ? (votes[`${ev.id}_${soloName}`] || v1) === 'love'
        : (v1 === 'love' && v2 === 'love');
      if (!isMatch) return;

      const plan = plannerItems.find(p => String(p.event_id) === String(ev.id)) || null;
      const entry = { ev, plan, when: this.getEventWhen(ev) };
      (dismissed.has(String(ev.id)) ? removed : active).push(entry);
    });

    // Not-yet-planned first (soonest date first), planned ones after
    const sortKey = (m) => `${m.plan ? 1 : 0}_${m.when.date || '9999-99-99'}_${m.when.time || ''}`;
    active.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    return { active, removed };
  },

  /** Reads the event's own date & time from start_date ("YYYY-MM-DD HH:MM"). */
  getEventWhen(ev) {
    const raw = ev.ongoing ? '' : String(ev.start_date || '');
    const m = raw.match(/(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
    if (!m) return { date: null, time: null, label: ev.time_str || 'Flexible timing', isPast: false };

    const date = `${m[1]}-${m[2]}-${m[3]}`;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const isPast = d < today;

    let time = null;
    let timeLabel = '';
    if (m[4]) {
      time = `${m[4]}:${m[5]}`;
      const h = Number(m[4]);
      timeLabel = `${((h + 11) % 12) + 1}:${m[5]} ${h >= 12 ? 'PM' : 'AM'}`;
    }
    const dayLabel = d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
    return { date, time, timeLabel, dayLabel, isPast, label: timeLabel ? `${dayLabel} · ${timeLabel}` : dayLabel };
  },

  formatPlan(plan) {
    if (!plan || !plan.scheduled_date) return 'In your Bucket List';
    const d = new Date(plan.scheduled_date + 'T00:00:00');
    const day = d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
    const slot = plan.time_slot ? ` · ${plan.time_slot.charAt(0).toUpperCase()}${plan.time_slot.slice(1)}` : '';
    return `${day}${slot}`;
  },

  escape(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  updateBadge() {
    const { active } = this.getMatches();
    const toPlan = active.filter(m => !m.plan).length;
    ['m-matches-badge', 'matches-tab-badge'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = toPlan;
      el.classList.toggle('hidden', toPlan === 0);
    });
  },

  isVisible() {
    return document.getElementById('view-matches')?.classList.contains('active');
  },

  /** Cheap refresh hook called whenever votes / planner change. */
  refresh() {
    this.updateBadge();
    if (this.isVisible()) this.render();
  },

  render() {
    const grid = document.getElementById('matches-grid');
    const empty = document.getElementById('matches-empty');
    const title = document.getElementById('matches-page-title');
    const sub = document.getElementById('matches-page-sub');
    const removedWrap = document.getElementById('matches-removed-wrap');
    if (!grid) return;

    const isSolo = this.isSolo();
    const { u1, u2 } = this.names();
    const { active, removed } = this.getMatches();
    const toPlan = active.filter(m => !m.plan).length;

    if (title) title.textContent = isSolo ? '❤️ My Loves' : '💖 Your Matches';
    if (sub) {
      sub.textContent = isSolo
        ? `${active.length} saved ${active.length === 1 ? 'idea' : 'ideas'} · Tap Plan Date to pick when you want to go`
        : `${active.length} ${active.length === 1 ? 'idea' : 'ideas'} you both love · ${toPlan} ready to pick a date`;
    }

    const pickBtn = document.getElementById('btn-pick-random-match');
    if (pickBtn) {
      pickBtn.classList.toggle('hidden', active.length < 2);
      pickBtn.innerHTML = isSolo ? '🎲 Pick One For Me' : '🎲 Pick For Us';
    }

    if (removedWrap) {
      removedWrap.classList.toggle('hidden', removed.length === 0);
      const btn = document.getElementById('matches-removed-toggle');
      if (btn) btn.textContent = this.showRemoved ? `Hide removed (${removed.length})` : `Show removed (${removed.length})`;
    }

    const list = this.showRemoved ? [...active, ...removed.map(r => ({ ...r, isRemoved: true }))] : active;

    if (list.length === 0) {
      grid.innerHTML = '';
      if (empty) {
        empty.classList.remove('hidden');
        const msg = document.getElementById('matches-empty-msg');
        if (msg) {
          msg.textContent = isSolo
            ? 'Tap ❤️ Love on Discover or swipe right in Swiper and your favourites will appear here.'
            : `When ${u1} and ${u2} both ❤️ Love the same idea, it shows up here ready to plan.`;
        }
      }
      this.updateBadge();
      return;
    }
    empty?.classList.add('hidden');

    grid.innerHTML = list.map(({ ev, plan, when, isRemoved }) => {
      const id = this.escape(ev.id);
      const jsId = String(ev.id).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const locLabel = ev.location || ev.location_name || ev.city || 'Brisbane';
      const priceLabel = ev.price || ev.price_str || ev.price_level || '$$';
      const mapsUrl = `https://maps.apple.com/?q=${encodeURIComponent(locLabel + ', Brisbane')}`;
      const linkInfo = (typeof discover !== 'undefined' && discover.getEventLinkInfo) ? discover.getEventLinkInfo(ev) : null;
      const externalLinkHtml = linkInfo
        ? `<span class="meta-dot">•</span><a href="${this.escape(linkInfo.url)}" target="_blank" rel="noopener noreferrer" class="card-source-link" title="Open ${this.escape(ev.source || 'official website')}">${linkInfo.label}</a>`
        : '';
      const sourceBadgeHtml = linkInfo
        ? `<a href="${this.escape(linkInfo.url)}" target="_blank" rel="noopener noreferrer" class="card-source-badge card-source-badge-link" onclick="event.stopPropagation()" title="Open ${this.escape(ev.source || 'official website')}">${this.escape(ev.source || 'Official')} ↗</a>`
        : `<span class="card-source-badge">${this.escape(ev.source || '')}</span>`;

      const tipHtml = ev.insider_tip
        ? `<div class="card-tip"><strong>💡 Tip:</strong> ${this.escape(ev.insider_tip)}</div>` : '';

      const whenHtml = when.date
        ? `<span class="match-when ${when.isPast ? 'is-past' : ''}">📅 ${this.escape(when.label)}${when.isPast ? ' (date passed)' : ''}</span>`
        : `<span class="match-when">⏰ ${this.escape(when.label)}</span>`;

      const planStatus = plan
        ? `<div class="match-plan-status">✅ ${plan.status === 'completed' ? 'Completed Memory ❤️' : `Planned for ${this.escape(this.formatPlan(plan))}`}</div>`
        : '';

      const primaryBtn = plan
        ? `<button type="button" class="btn-match-primary is-planned" onclick="matchesView.viewInPlanner()">📅 View in Planner</button>`
        : `<button type="button" class="btn-match-primary" onclick="matchesView.planDate('${jsId}')">📅 Pick Date & Plan</button>`;

      const secondaryBtn = isRemoved
        ? `<button type="button" class="btn-match-secondary" onclick="matchesView.restoreMatch('${jsId}')">↩️ Restore</button>`
        : (plan
          ? `<button type="button" class="btn-match-secondary" onclick="planner.openScheduleModal('${jsId}', '${String(ev.title).replace(/'/g, "\\'")}', '${plan.id}')">✏️ Change Date</button>`
          : `<button type="button" class="btn-match-secondary" onclick="matchesView.removeMatch('${jsId}')">✕ Remove</button>`);

      return `
        <article class="event-card match-card ${plan ? 'is-planned' : ''} ${isRemoved ? 'is-removed' : ''}" data-event-id="${id}">
          <div class="card-media">
            <img class="card-img" src="${this.escape(ev.image_url)}" alt="${this.escape(ev.title)}" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80'">
            ${sourceBadgeHtml}
            <span class="card-price-badge">${this.escape(priceLabel)}</span>
            ${!isSolo ? `<div class="card-match-banner">🎉 You both love this!</div>` : ''}
          </div>
          <div class="card-body">
            <div class="card-category">${this.escape(ev.category || '')}</div>
            <h3 class="card-title">${this.escape(ev.title)}</h3>
            <div class="card-meta-line">
              <a href="${mapsUrl}" target="_blank" rel="noopener" class="card-map-link">📍 ${this.escape(locLabel)} <span class="map-link-arrow">↗</span></a>
              ${externalLinkHtml}
            </div>
            <div class="match-when-row">${whenHtml}</div>
            ${tipHtml}
            ${planStatus}
            <div class="match-actions">
              ${primaryBtn}
              ${secondaryBtn}
            </div>
          </div>
        </article>
      `;
    }).join('');

    this.updateBadge();
  },

  /** Opens the date & time picker modal so couples can choose when they want to go. */
  async planDate(eventId) {
    const ev = planner.findEvent(eventId);
    if (!ev) return;
    const existing = planner.getItemForEvent(ev.id);
    planner.openScheduleModal(ev.id, ev.title, existing ? existing.id : null);
  },

  /** 🎲 Decision Roulette: randomly picks an un-planned match and opens its date picker! */
  pickRandomMatch() {
    const { active } = this.getMatches();
    const unplanned = active.filter(m => !m.plan);
    const pool = unplanned.length > 0 ? unplanned : active;
    if (pool.length === 0) {
      app.showToast('Love a few date ideas first so we can pick one for you! ❤️');
      return;
    }
    const winner = pool[Math.floor(Math.random() * pool.length)];
    const card = document.querySelector(`.match-card[data-event-id="${CSS.escape(String(winner.ev.id))}"]`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('card-highlight-pulse');
      setTimeout(() => card.classList.remove('card-highlight-pulse'), 2600);
    }
    app.showToast(`🎲 Fate picked: "${winner.ev.title}"! Pick your date night 📅`);
    setTimeout(() => {
      this.planDate(winner.ev.id);
    }, 650);
  },

  async removeMatch(eventId) {
    if (typeof firebaseService !== 'undefined' && firebaseService.setMatchDismissed) {
      await firebaseService.setMatchDismissed(eventId, true);
    } else {
      const set = this.getDismissed(); set.add(String(eventId));
      localStorage.setItem('twodo_dismissed_matches', JSON.stringify(Array.from(set)));
    }
    app.showToast('Removed from Matches (tap "Show removed" to undo)');
    this.render();
  },

  async restoreMatch(eventId) {
    if (typeof firebaseService !== 'undefined' && firebaseService.setMatchDismissed) {
      await firebaseService.setMatchDismissed(eventId, false);
    }
    try {
      const list = JSON.parse(localStorage.getItem('twodo_dismissed_matches') || '[]').filter(id => String(id) !== String(eventId));
      localStorage.setItem('twodo_dismissed_matches', JSON.stringify(list));
    } catch (e) {}
    app.showToast('↩️ Back in your Matches');
    this.render();
  },

  toggleRemoved() {
    this.showRemoved = !this.showRemoved;
    this.render();
  },

  viewInPlanner() {
    app.navigate('planner');
    if (planner.switchView) planner.switchView('scheduled');
  }
};

window.matchesView = matchesView;

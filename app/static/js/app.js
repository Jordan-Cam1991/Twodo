/**
 * TwoDo Main Application Controller
 */
const app = {
  currentCity: 'Brisbane',
  currentVoter: 1, // Always 1: the logged-in person (user1) — you can't act as your partner
  profile: null,
  events: [],

  async init() {
    console.log('Initializing TwoDo Couple App...');
    try {
      // Initialize Firebase Multi-Couple Service
      if (typeof firebaseService !== 'undefined') {
        firebaseService.init();
      }

      this.profile = await api.getProfile();
      this.currentCity = this.profile.default_city || 'Brisbane';
      this.updateProfileUI();

      // Load initial events and planner
      await discover.loadEvents(false);
      await planner.loadPlanner();

      // Automatic once-a-day multi-area background event pull
      if (typeof api !== 'undefined' && api.autoDailyPull) {
        api.autoDailyPull(false).then(res => {
          if (res && !res.skipped && res.newly_discovered_count > 0 && window.discover) {
            discover.loadEvents(false);
          }
          this.updateThisWeekBadges();
        }).catch(() => {});
      }

      this.updateThisWeekBadges();

      console.log('TwoDo ready!');
    } catch (e) {
      console.error('App init error:', e);
    }
  },

  updateProfileUI() {
    if (!this.profile) return;
    const isSolo = (typeof firebaseService !== 'undefined') ? firebaseService.isSolo : false;
    const activeSoloName = (typeof firebaseService !== 'undefined' && firebaseService.userProfile?.name)
      ? firebaseService.userProfile.name
      : (localStorage.getItem('twodo_user_name') || 'You');
    const u1 = activeSoloName || this.profile.user1_name || 'You';
    const u2 = isSolo ? 'Partner' : (this.profile.user2_name || 'Partner');

    // 1. Header voter switch vs. solo bar
    const voterSwitch = document.getElementById('voter-switch-container');
    const soloBar = document.getElementById('solo-bar-container');
    const soloUserDisplay = document.getElementById('solo-user-display');

    if (isSolo) {
      if (voterSwitch) voterSwitch.classList.add('hidden');
      if (soloBar) soloBar.classList.remove('hidden');
      if (soloUserDisplay) soloUserDisplay.textContent = activeSoloName;
    } else {
      if (voterSwitch) voterSwitch.classList.remove('hidden');
      if (soloBar) soloBar.classList.add('hidden');
    }

    const v1Disp = document.getElementById('voter1-display');
    const v2Disp = document.getElementById('voter2-display');
    if (v1Disp) v1Disp.textContent = u1;
    if (v2Disp) v2Disp.textContent = u2;

    // 2. Mood filter chips: Solo vs. Couple
    const matchesChip = document.getElementById('mood-chip-matches');
    const emmaChip = document.getElementById('mood-chip-emma');
    const emmaPassChip = document.getElementById('mood-chip-emma-passed');
    const jordanChip = document.getElementById('mood-chip-jordan');
    const jordanPassChip = document.getElementById('mood-chip-jordan-passed');

    const emmaLabel = document.getElementById('mood-chip-emma-label');
    const emmaPassLabel = document.getElementById('mood-chip-emma-passed-label');
    const jordanLabel = document.getElementById('mood-chip-jordan-label');
    const jordanPassLabel = document.getElementById('mood-chip-jordan-passed-label');

    if (isSolo) {
      if (matchesChip) matchesChip.classList.add('hidden');
      if (jordanChip) jordanChip.classList.add('hidden');
      if (jordanPassChip) jordanPassChip.classList.add('hidden');

      if (emmaChip) emmaChip.classList.remove('hidden');
      if (emmaPassChip) emmaPassChip.classList.remove('hidden');
      if (emmaLabel) emmaLabel.textContent = 'My Loves';
      if (emmaPassLabel) emmaPassLabel.textContent = 'My Passed';
    } else {
      if (matchesChip) matchesChip.classList.remove('hidden');
      if (emmaChip) emmaChip.classList.remove('hidden');
      if (emmaPassChip) emmaPassChip.classList.remove('hidden');
      if (jordanChip) jordanChip.classList.remove('hidden');
      if (jordanPassChip) jordanPassChip.classList.remove('hidden');

      if (emmaLabel) emmaLabel.textContent = 'My Loves';
      if (emmaPassLabel) emmaPassLabel.textContent = 'My Passed';
      if (jordanLabel) jordanLabel.textContent = `${u2}'s Loves`;
      if (jordanPassLabel) jordanPassLabel.textContent = `${u2}'s Passed`;
    }

    const chatTitle = document.getElementById('chat-header-title');
    if (chatTitle) chatTitle.textContent = isSolo ? 'Couple Chat' : `${u1} & ${u2}'s Chat`;

    // 3. Chat View: Locked state for solo users
    const chatActive = document.getElementById('chat-active-container');
    const chatLocked = document.getElementById('chat-solo-locked');
    if (chatActive && chatLocked) {
      chatActive.classList.toggle('hidden', isSolo);
      chatLocked.classList.toggle('hidden', !isSolo);
    }

    const locDisp = document.getElementById('current-location-display');
    if (locDisp) {
      locDisp.textContent = this.currentCity;
      if (locDisp.parentElement) locDisp.parentElement.title = `Current City: ${this.currentCity} (Tap to change)`;
    }

    const setU1 = document.getElementById('set-user1-name');
    const setCity = document.getElementById('set-default-city');
    const setU1Label = document.getElementById('settings-user1-label');

    if (setU1) setU1.value = isSolo ? activeSoloName : u1;
    if (setCity) setCity.value = this.currentCity;
    if (setU1Label) setU1Label.textContent = 'Name';

    this.updateCreatorButton();

    if (window.authUI && authUI.updateSettingsAccountUI) {
      const email = (typeof firebaseService !== 'undefined' && firebaseService.currentUser) 
        ? firebaseService.currentUser.email 
        : localStorage.getItem('twodo_user_email');
      const partnerName = (typeof firebaseService !== 'undefined' && firebaseService.userProfile?.partner_name);
      authUI.updateSettingsAccountUI(email, this.profile, isSolo, partnerName);
    }

    try {
      const keys = JSON.parse(this.profile.api_keys_json || '{}');
      if (document.getElementById('set-tm-key')) document.getElementById('set-tm-key').value = keys.ticketmaster || '';
      if (document.getElementById('set-eb-key')) document.getElementById('set-eb-key').value = keys.eventbrite || '';
    } catch (e) {}
  },

  getActiveVoterName() {
    // You only ever act as yourself — the person logged in on this device
    return (typeof firebaseService !== 'undefined' && firebaseService.userProfile?.name)
      ? firebaseService.userProfile.name
      : (this.profile?.user1_name || localStorage.getItem('twodo_user_name') || 'You');
  },

  async quickEditName() {
    const currentName = (typeof firebaseService !== 'undefined' && firebaseService.userProfile?.name) 
      || localStorage.getItem('twodo_user_name')
      || this.profile?.user1_name 
      || 'Jordan';
    const newName = prompt('Update your name:', currentName);
    if (!newName || !newName.trim() || newName.trim() === currentName) return;
    
    const clean = newName.trim();
    if (this.profile) this.profile.user1_name = clean;
    localStorage.setItem('twodo_user_name', clean);
    if (this.profile) localStorage.setItem('twodo_profile', JSON.stringify(this.profile));

    // Migrate votes from currentName to clean so likes stay intact
    if (currentName && currentName !== clean) {
      try {
        const votes = JSON.parse(localStorage.getItem('twodo_votes') || '{}');
        let migrated = false;
        Object.keys(votes).forEach(k => {
          if (k.endsWith(`_${currentName}`)) {
            const newKey = k.slice(0, -currentName.length) + clean;
            votes[newKey] = votes[k];
            if (typeof firebaseService !== 'undefined' && firebaseService.votesMap) {
              firebaseService.votesMap[newKey] = votes[k];
            }
            migrated = true;
          }
        });
        if (migrated) {
          localStorage.setItem('twodo_votes', JSON.stringify(votes));
        }
      } catch (err) {}
    }
    
    if (typeof firebaseService !== 'undefined') {
      // Updates my user record, my slot on the couple record and re-shares my votes under the new name
      await firebaseService.updateMyProfile({ name: clean });
    }
    this.updateProfileUI();
    this.showToast(`Updated name to ${clean}! ✨`);
    if (window.discover && discover.renderEvents) {
      discover.renderEvents();
      discover.updateMatchBanner();
    }
    if (window.swiper && swiper.renderDeck) {
      swiper.renderDeck();
    }
  },

  // Legacy: switching who you vote as is no longer possible — you always act as yourself.
  setVoter() {
    this.currentVoter = 1;
    discover.loadEvents(false);
    swiper.initDeck();
  },

  navigate(tabName) {
    this.activeTab = tabName;
    document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.mobile-nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));

    const targetView = document.getElementById(`view-${tabName}`);
    const targetBtn = document.querySelector(`.nav-btn[data-tab="${tabName}"]`);

    if (targetView) targetView.classList.add('active');
    if (targetBtn) targetBtn.classList.add('active');

    // Scroll back to top on navigation to make mobile vertical browsing natural
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Clear "new this week" badge when user explores discover or swiper
    if (tabName === 'discover' || tabName === 'swiper') {
      this.clearThisWeekBadges();
    }

    if (tabName === 'swiper') {
      swiper.initDeck();
    } else if (tabName === 'chat') {
      if (window.chatView) chatView.init();
    } else if (tabName === 'planner') {
      planner.loadPlanner();
    } else if (tabName === 'matches') {
      if (window.matchesView) matchesView.render();
    }
  },

  updateThisWeekBadges() {
    let count = 0;
    try {
      const raw = parseInt(localStorage.getItem('twodo_new_this_week_count') || '0', 10);
      count = isNaN(raw) || raw < 0 ? 0 : raw;
    } catch (e) {
      count = 0;
    }
    ['m-discover-badge', 'm-swiper-badge', 'discover-tab-badge', 'swiper-badge'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = count;
      el.classList.toggle('hidden', count === 0);
    });
  },

  clearThisWeekBadges() {
    try {
      localStorage.removeItem('twodo_new_this_week_count');
    } catch (e) {}
    this.updateThisWeekBadges();
  },

  // Modals
  openLocationModal() {
    document.getElementById('loc-input').value = this.currentCity;
    document.getElementById('location-modal').classList.remove('hidden');
  },

  closeLocationModal() {
    document.getElementById('location-modal').classList.add('hidden');
  },

  selectQuickCity(cityName) {
    document.getElementById('loc-input').value = cityName;
    this.applyLocation();
  },

  async applyLocation() {
    const input = document.getElementById('loc-input').value.trim();
    if (!input) return;

    this.currentCity = input;
    const locDisp = document.getElementById('current-location-display');
    if (locDisp) {
      locDisp.textContent = this.currentCity;
      if (locDisp.parentElement) locDisp.parentElement.title = `Current City: ${this.currentCity} (Tap to change)`;
    }
    this.closeLocationModal();

    this.showToast(`🔍 Pulling internet events for ${this.currentCity}...`);
    await discover.loadEvents(true);
  },

  openAddModal() {
    const dateInput = document.getElementById('cust-date');
    if (dateInput) {
      const todayStr = (typeof api !== 'undefined' && api.todayYMD) ? api.todayYMD() : new Date().toISOString().slice(0, 10);
      dateInput.min = todayStr;
      if (!dateInput.value || dateInput.value < todayStr) {
        dateInput.value = todayStr;
      }
    }
    document.getElementById('add-modal').classList.remove('hidden');
  },

  closeAddModal() {
    document.getElementById('add-modal').classList.add('hidden');
  },

  openSettingsModal() {
    try {
      this.updateProfileUI();
    } catch (err) {
      console.warn('updateProfileUI note in openSettingsModal:', err);
    }
    if (typeof notifications !== 'undefined' && notifications.updateUI) {
      notifications.updateUI();
    }
    const modal = document.getElementById('settings-modal');
    if (modal) {
      modal.classList.remove('hidden');
    }
  },

  closeSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
  },

  /* ==========================================================================
     CREATOR DASHBOARD (Exclusive to j.camilleri91@hotmail.com)
     ========================================================================== */
  isCreator() {
    const email = (typeof firebaseService !== 'undefined' && firebaseService.currentUser?.email)
      || localStorage.getItem('twodo_user_email') || '';
    return email.toLowerCase().trim() === 'j.camilleri91@hotmail.com';
  },

  updateCreatorButton() {
    const btn = document.getElementById('btn-creator-dashboard');
    if (!btn) return;
    const isOwner = this.isCreator();
    btn.classList.toggle('hidden', !isOwner);
  },

  openCreatorModal() {
    if (!this.isCreator()) {
      if (this.showToast) this.showToast('Creator dashboard restricted to j.camilleri91@hotmail.com');
      return;
    }
    const modal = document.getElementById('creator-modal');
    if (modal) {
      modal.classList.remove('hidden');
    }
    if (typeof notifications !== 'undefined' && notifications.updateUI) {
      notifications.updateUI();
    }
    try {
      const keys = JSON.parse(this.profile?.api_keys_json || '{}');
      if (document.getElementById('set-tm-key')) document.getElementById('set-tm-key').value = keys.ticketmaster || '';
      if (document.getElementById('set-eb-key')) document.getElementById('set-eb-key').value = keys.eventbrite || '5TTFX4W5VV3Q374CKAZ2';
    } catch (e) {}
    this.loadCreatorAnalytics();
  },

  closeCreatorModal() {
    const modal = document.getElementById('creator-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
  },

  async loadCreatorAnalytics() {
    const usersCountEl = document.getElementById('creator-stat-users');
    const couplesCountEl = document.getElementById('creator-stat-couples');
    const eventsCountEl = document.getElementById('creator-stat-events');
    const liveCountEl = document.getElementById('creator-stat-live');
    const usersListEl = document.getElementById('creator-users-list');

    if (eventsCountEl) {
      const totalEvents = (typeof app !== 'undefined' && app.events ? app.events.length : 0)
        || ((typeof PRELOADED_EVENTS !== 'undefined' ? PRELOADED_EVENTS.length : 0));
      eventsCountEl.textContent = totalEvents;
    }

    if (liveCountEl) {
      let livePool = [];
      try { livePool = JSON.parse(localStorage.getItem('twodo_daily_live_events') || '[]'); } catch (e) {}
      liveCountEl.textContent = livePool.length;
    }

    if (typeof firebaseService !== 'undefined' && firebaseService.db) {
      try {
        const [usersSnap, couplesSnap] = await Promise.all([
          firebaseService.db.collection('users').get().catch(() => ({ size: 0, docs: [] })),
          firebaseService.db.collection('couples').get().catch(() => ({ size: 0, docs: [] }))
        ]);
        if (usersCountEl) usersCountEl.textContent = usersSnap.size || 0;
        if (couplesCountEl) couplesCountEl.textContent = couplesSnap.size || 0;

        if (usersListEl && usersSnap.docs) {
          const rows = usersSnap.docs.map(doc => {
            const d = doc.data();
            const email = d.email || 'No email';
            const name = d.name || 'Anonymous';
            const partner = d.partner_name ? `💞 ${d.partner_name}` : 'Solo';
            const city = d.city || 'Brisbane';
            return `
              <div style="display:flex; justify-content:space-between; align-items:center; background:white; padding:0.4rem 0.6rem; border-radius:8px; border:1px solid var(--border); font-size:0.78rem;">
                <div>
                  <strong style="color:var(--text-main); font-size:0.8rem;">${name}</strong>
                  <span style="display:block; font-size:0.7rem; color:#64748b;">${email}</span>
                </div>
                <div style="text-align:right;">
                  <span style="font-size:0.72rem; color:var(--primary); font-weight:700;">${partner}</span>
                  <span style="display:block; font-size:0.68rem; color:#94a3b8;">${city}</span>
                </div>
              </div>
            `;
          }).join('');
          usersListEl.innerHTML = rows || '<p style="color:#64748b; font-size:0.75rem;">No registered users yet.</p>';
        }
      } catch (err) {
        console.warn('Creator analytics load error:', err);
      }
    }
  },

  async saveCreatorApiKeys() {
    const tmKey = document.getElementById('set-tm-key')?.value.trim() || '';
    const ebKey = document.getElementById('set-eb-key')?.value.trim() || '';
    try {
      const existing = JSON.parse(this.profile?.api_keys_json || '{}');
      existing.ticketmaster = tmKey;
      existing.eventbrite = ebKey;
      if (!this.profile) this.profile = {};
      this.profile.api_keys_json = JSON.stringify(existing);
      localStorage.setItem('twodo_profile', JSON.stringify(this.profile));
      if (this.showToast) this.showToast('API keys saved ✨');
    } catch (e) {
      console.warn('API key save error:', e);
    }
  },

  async saveSettings(e) {
    if (e && e.preventDefault) e.preventDefault();
    const isSolo = (typeof firebaseService !== 'undefined') ? firebaseService.isSolo : false;
    const u1 = document.getElementById('set-user1-name').value.trim() || 'You';
    const u2 = isSolo ? 'Partner' : (this.profile?.user2_name || 'Partner');
    const city = document.getElementById('set-default-city').value.trim() || 'Brisbane';

    const oldName = this.profile?.user1_name || (typeof firebaseService !== 'undefined' && firebaseService.userProfile?.name) || 'Emma';

    try {
      const updateData = {
        user1_name: u1,
        user2_name: u2,
        default_city: city
      };

      // 1. Immediately store new name in local storage
      localStorage.setItem('twodo_user_name', u1);
      localStorage.setItem('twodo_profile', JSON.stringify(updateData));

      // 2. Update Firebase Service
      if (typeof firebaseService !== 'undefined') {
        // Only ever updates YOUR details (never your partner's)
        await firebaseService.updateMyProfile({ name: u1, city: city });
      }

      // 3. Migrate votes from old name to new name so user doesn't lose likes!
      if (oldName && oldName !== u1) {
        try {
          const votes = JSON.parse(localStorage.getItem('twodo_votes') || '{}');
          let migrated = false;
          Object.keys(votes).forEach(k => {
            if (k.endsWith(`_${oldName}`)) {
              const newKey = k.slice(0, -oldName.length) + u1;
              votes[newKey] = votes[k];
              if (typeof firebaseService !== 'undefined' && firebaseService.votesMap) {
                firebaseService.votesMap[newKey] = votes[k];
              }
              migrated = true;
            }
          });
          if (migrated) {
            localStorage.setItem('twodo_votes', JSON.stringify(votes));
          }
        } catch (err) {}
      }

      // 4. Update memory profile
      this.profile = updateData;
      this.currentCity = city;

      // 5. Update UI across the entire app
      this.updateProfileUI();
      this.closeSettingsModal();
      this.showToast(isSolo ? `Saved! Exploring as ${u1} ✨` : 'Couple settings saved! ✨');

      if (window.discover && discover.renderEvents) {
        discover.renderEvents();
        discover.updateMatchBanner();
      }
      if (window.swiper && swiper.renderDeck) {
        swiper.renderDeck();
      }
    } catch (err) {
      console.error(err);
      this.showToast('Failed to save settings.');
    }
  },

  showToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span>✨</span> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, 2800);
  },

  playCelebrationSound() {
    // Synthesize a joyful chime using Web Audio API
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();

      const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6 chord
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.08);

        gain.gain.setValueAtTime(0, ctx.currentTime + idx * 0.08);
        gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + idx * 0.08 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.08 + 0.6);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime + idx * 0.08);
        osc.stop(ctx.currentTime + idx * 0.08 + 0.6);
      });
    } catch (e) {
      // Audio not permitted or supported
    }
  }
};

// Expose every module on `window`. Top-level `const` objects are NOT automatically
// window properties, so checks like `if (window.discover)` were silently false —
// which stopped live refreshes (votes, planner, swiper, chat) from running.
(function exposeModules() {
  const mods = {
    api: typeof api !== 'undefined' ? api : undefined,
    app,
    authUI: typeof authUI !== 'undefined' ? authUI : undefined,
    chatView: typeof chatView !== 'undefined' ? chatView : undefined,
    collaborative: typeof collaborative !== 'undefined' ? collaborative : undefined,
    discover: typeof discover !== 'undefined' ? discover : undefined,
    firebaseService: typeof firebaseService !== 'undefined' ? firebaseService : undefined,
    planner: typeof planner !== 'undefined' ? planner : undefined,
    swiper: typeof swiper !== 'undefined' ? swiper : undefined,
    matchesView: typeof matchesView !== 'undefined' ? matchesView : undefined
  };
  Object.keys(mods).forEach(k => { if (mods[k]) window[k] = mods[k]; });
})();

// Start application when DOM is loaded
window.addEventListener('DOMContentLoaded', () => {
  app.init();
});

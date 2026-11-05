/**
 * TwoDo Main Application Controller
 */
const app = {
  currentCity: 'Brisbane',
  currentVoter: 1, // 1 = User 1, 2 = User 2, 'both' = Together Mode
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
      await discover.loadEvents(true);
      await planner.loadPlanner();

      console.log('TwoDo ready!');
    } catch (e) {
      console.error('App init error:', e);
    }
  },

  updateProfileUI() {
    if (!this.profile) return;
    const isSolo = (typeof firebaseService !== 'undefined') ? firebaseService.isSolo : false;
    const u1 = this.profile.user1_name || 'Emma';
    const u2 = this.profile.user2_name || 'Jordan';

    // 1. Header voter switch vs. solo bar
    const voterSwitch = document.getElementById('voter-switch-container');
    const soloBar = document.getElementById('solo-bar-container');
    const soloUserDisplay = document.getElementById('solo-user-display');

    if (isSolo) {
      if (voterSwitch) voterSwitch.classList.add('hidden');
      if (soloBar) soloBar.classList.remove('hidden');
      const activeSoloName = (typeof firebaseService !== 'undefined' && firebaseService.userProfile?.name)
        ? firebaseService.userProfile.name
        : (localStorage.getItem('twodo_user_name') || u1 || 'You');
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

      if (emmaLabel) emmaLabel.textContent = `${u1}'s Loves`;
      if (emmaPassLabel) emmaPassLabel.textContent = `${u1}'s Passed`;
      if (jordanLabel) jordanLabel.textContent = `${u2}'s Loves`;
      if (jordanPassLabel) jordanPassLabel.textContent = `${u2}'s Passed`;
    }

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
    const setU2 = document.getElementById('set-user2-name');
    const setCity = document.getElementById('set-default-city');
    const setU1Label = document.getElementById('settings-user1-label');
    const setU2Group = document.getElementById('settings-user2-group');

    if (setU1) setU1.value = isSolo ? activeSoloName : u1;
    if (setU2) setU2.value = isSolo ? '' : u2;
    if (setCity) setCity.value = this.currentCity;
    if (setU1Label) setU1Label.textContent = isSolo ? 'Your Name' : 'Partner 1 Name';
    if (setU2Group) setU2Group.classList.toggle('hidden', isSolo);

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
    const isSolo = (typeof firebaseService !== 'undefined') ? firebaseService.isSolo : false;
    if (isSolo) {
      return (typeof firebaseService !== 'undefined' && firebaseService.userProfile?.name)
        ? firebaseService.userProfile.name
        : (localStorage.getItem('twodo_user_name') || this.profile?.user1_name || 'You');
    }
    if (this.currentVoter === 2) {
      return this.profile?.user2_name || 'Jordan';
    }
    return this.profile?.user1_name || 'Emma';
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
    localStorage.setItem('twodo_pending_name', clean);
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
      if (firebaseService.userProfile) {
        firebaseService.userProfile.name = clean;
        localStorage.setItem('twodo_user_profile', JSON.stringify(firebaseService.userProfile));
      }
      await firebaseService.updateSoloProfile({ name: clean });
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

  setVoter(voterIndex) {
    this.currentVoter = voterIndex;
    
    document.getElementById('btn-voter-1')?.classList.toggle('active', voterIndex === 1);
    document.getElementById('btn-voter-2')?.classList.toggle('active', voterIndex === 2);
    document.getElementById('btn-voter-both')?.classList.toggle('active', voterIndex === 'both');

    const name = this.getActiveVoterName();
    this.showToast(voterIndex === 'both' ? '👥 Together Mode active!' : `Voting as ${name}`);

    // Reorder mood chips so active voter's chips come first (immediately visible without scrolling)
    const scrollEl = document.getElementById('mood-chips-scroll');
    const emmaChip = document.getElementById('mood-chip-emma');
    const emmaPassChip = document.getElementById('mood-chip-emma-passed');
    const jordanChip = document.getElementById('mood-chip-jordan');
    const jordanPassChip = document.getElementById('mood-chip-jordan-passed');

    if (scrollEl && emmaChip && jordanChip && emmaPassChip && jordanPassChip) {
      if (voterIndex === 2) {
        // Jordan's Loves and Passed first
        scrollEl.insertBefore(jordanChip, emmaChip);
        scrollEl.insertBefore(jordanPassChip, emmaChip);
      } else {
        // Emma's Loves and Passed first (default / Together)
        scrollEl.insertBefore(emmaChip, jordanChip);
        scrollEl.insertBefore(emmaPassChip, jordanChip);
      }
      scrollEl.scrollTo({ left: 0, behavior: 'smooth' });
    }

    discover.loadEvents(false);
    swiper.initDeck();
    if (window.chatView && chatView.updateVoterToggleUI) {
      chatView.updateVoterToggleUI();
    }
  },

  navigate(tabName) {
    document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.mobile-nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));

    const targetView = document.getElementById(`view-${tabName}`);
    const targetBtn = document.querySelector(`.nav-btn[data-tab="${tabName}"]`);

    if (targetView) targetView.classList.add('active');
    if (targetBtn) targetBtn.classList.add('active');

    // Scroll back to top on navigation to make mobile vertical browsing natural
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (tabName === 'swiper') {
      swiper.initDeck();
    } else if (tabName === 'chat') {
      if (window.chatView) chatView.init();
    } else if (tabName === 'planner') {
      planner.loadPlanner();
    }
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
    document.getElementById('add-modal').classList.remove('hidden');
  },

  closeAddModal() {
    document.getElementById('add-modal').classList.add('hidden');
  },

  openSettingsModal() {
    this.updateProfileUI();
    document.getElementById('settings-modal').classList.remove('hidden');
  },

  closeSettingsModal() {
    document.getElementById('settings-modal').classList.add('hidden');
  },

  async saveSettings(e) {
    if (e && e.preventDefault) e.preventDefault();
    const isSolo = (typeof firebaseService !== 'undefined') ? firebaseService.isSolo : false;
    const u1 = document.getElementById('set-user1-name').value.trim() || 'You';
    const rawU2 = document.getElementById('set-user2-name') ? document.getElementById('set-user2-name').value.trim() : '';
    const u2 = isSolo ? 'Partner' : (rawU2 || 'Partner');
    const city = document.getElementById('set-default-city').value.trim() || 'Brisbane';
    const tmKey = document.getElementById('set-tm-key')?.value.trim();
    const ebKey = document.getElementById('set-eb-key')?.value.trim();

    const oldName = this.profile?.user1_name || (typeof firebaseService !== 'undefined' && firebaseService.userProfile?.name) || 'Emma';

    try {
      const updateData = {
        user1_name: u1,
        user2_name: u2,
        default_city: city,
        api_keys: {
          ticketmaster: tmKey,
          eventbrite: ebKey
        }
      };

      // 1. Immediately store new name in local storage
      localStorage.setItem('twodo_user_name', u1);
      localStorage.setItem('twodo_pending_name', u1);
      localStorage.setItem('twodo_profile', JSON.stringify(updateData));

      // 2. Update Firebase Service
      if (typeof firebaseService !== 'undefined') {
        if (firebaseService.userProfile) {
          firebaseService.userProfile.name = u1;
          firebaseService.userProfile.city = city;
          localStorage.setItem('twodo_user_profile', JSON.stringify(firebaseService.userProfile));
        }

        if (firebaseService.coupleId) {
          await firebaseService.updateCoupleProfile(updateData);
        } else if (firebaseService.currentUser) {
          await firebaseService.updateSoloProfile({ name: u1, city: city });
        }
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

// Start application when DOM is loaded
window.addEventListener('DOMContentLoaded', () => {
  app.init();
});

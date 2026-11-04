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
    const u1 = this.profile.user1_name || 'Emma';
    const u2 = this.profile.user2_name || 'Jordan';

    const v1Disp = document.getElementById('voter1-display');
    const v2Disp = document.getElementById('voter2-display');
    if (v1Disp) v1Disp.textContent = u1;
    if (v2Disp) v2Disp.textContent = u2;

    const emmaLabel = document.getElementById('mood-chip-emma-label');
    const jordanLabel = document.getElementById('mood-chip-jordan-label');
    if (emmaLabel) emmaLabel.textContent = `${u1}'s Loves`;
    if (jordanLabel) jordanLabel.textContent = `${u2}'s Loves`;

    const locDisp = document.getElementById('current-location-display');
    if (locDisp) {
      locDisp.textContent = this.currentCity;
      if (locDisp.parentElement) locDisp.parentElement.title = `Current City: ${this.currentCity} (Tap to change)`;
    }

    const setU1 = document.getElementById('set-user1-name');
    const setU2 = document.getElementById('set-user2-name');
    const setCity = document.getElementById('set-default-city');
    if (setU1) setU1.value = u1;
    if (setU2) setU2.value = u2;
    if (setCity) setCity.value = this.currentCity;

    try {
      const keys = JSON.parse(this.profile.api_keys_json || '{}');
      if (document.getElementById('set-tm-key')) document.getElementById('set-tm-key').value = keys.ticketmaster || '';
      if (document.getElementById('set-eb-key')) document.getElementById('set-eb-key').value = keys.eventbrite || '';
    } catch (e) {}
  },

  getActiveVoterName() {
    if (this.currentVoter === 2) {
      return this.profile?.user2_name || 'Jordan';
    }
    return this.profile?.user1_name || 'Emma';
  },

  setVoter(voterIndex) {
    this.currentVoter = voterIndex;
    
    document.getElementById('btn-voter-1')?.classList.toggle('active', voterIndex === 1);
    document.getElementById('btn-voter-2')?.classList.toggle('active', voterIndex === 2);
    document.getElementById('btn-voter-both')?.classList.toggle('active', voterIndex === 'both');

    const name = this.getActiveVoterName();
    this.showToast(voterIndex === 'both' ? '👥 Together Mode active!' : `Voting as ${name}`);

    discover.renderEvents();
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
    e.preventDefault();
    const u1 = document.getElementById('set-user1-name').value.trim();
    const u2 = document.getElementById('set-user2-name').value.trim();
    const city = document.getElementById('set-default-city').value.trim();
    const tmKey = document.getElementById('set-tm-key')?.value.trim();
    const ebKey = document.getElementById('set-eb-key')?.value.trim();

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

      if (typeof firebaseService !== 'undefined' && firebaseService.coupleId) {
        await firebaseService.updateCoupleProfile(updateData);
      }

      this.profile = await api.updateProfile(updateData);

      this.currentCity = city;
      this.updateProfileUI();
      this.closeSettingsModal();
      this.showToast('Couple settings saved!');
      await discover.loadEvents();
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

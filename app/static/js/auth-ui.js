/**
 * TwoDo Authentication UI Controller
 * Manages the Centsauble-style Login & Sign Up screen, Splash check, and Logout flow
 */
const authUI = {
  currentTab: 'login', // 'login' | 'register' | 'forgot'

  setDeviceSession(uid, email, password = null) {
    try {
      localStorage.setItem('twodo_session_active', '1');
      if (uid) localStorage.setItem('twodo_user_uid', uid);
      if (email) localStorage.setItem('twodo_user_email', email);
      if (email && password) {
        localStorage.setItem('twodo_auth_cache', btoa(JSON.stringify({ e: email, p: password, uid: uid })));
      }
      document.cookie = "twodo_session_active=1; path=/; max-age=31536000; SameSite=Lax";
      if (uid) document.cookie = `twodo_user_uid=${uid}; path=/; max-age=31536000; SameSite=Lax`;
    } catch (e) {}
    document.documentElement.classList.add('device-authenticated');
  },

  clearDeviceSession() {
    try {
      localStorage.removeItem('twodo_session_active');
      localStorage.removeItem('twodo_user_uid');
      localStorage.removeItem('twodo_user_email');
      localStorage.removeItem('twodo_auth_cache');
      document.cookie = "twodo_session_active=; path=/; max-age=0; SameSite=Lax";
      document.cookie = "twodo_user_uid=; path=/; max-age=0; SameSite=Lax";
    } catch (e) {}
    document.documentElement.classList.remove('device-authenticated');
  },

  hasDeviceSession() {
    try {
      if (localStorage.getItem('twodo_session_active') === '1') return true;
      if (document.cookie.indexOf('twodo_session_active=1') !== -1) return true;
    } catch (e) {}
    return false;
  },

  init() {
    this.bindEvents();

    // Check device session persistence: remember user across visits
    const hasSession = this.hasDeviceSession();
    const splash = document.getElementById('auth-loading-splash');

    if (hasSession) {
      // Device is already logged in: immediately reveal app, no login prompt!
      this.showApp();
    } else {
      // New visitor / logged out device: show auth screen immediately
      this.showAuthScreen();
    }
  },

  bindEvents() {
    const loginForm = document.getElementById('auth-login-form');
    const registerForm = document.getElementById('auth-register-form');
    const forgotForm = document.getElementById('auth-forgot-form');

    if (loginForm) {
      loginForm.addEventListener('submit', (e) => this.handleLogin(e));
    }
    if (registerForm) {
      registerForm.addEventListener('submit', (e) => this.handleRegister(e));
    }
    if (forgotForm) {
      forgotForm.addEventListener('submit', (e) => this.handleForgotPassword(e));
    }
  },

  showAuthScreen() {
    const splash = document.getElementById('auth-loading-splash');
    const authScreen = document.getElementById('auth-screen');
    const appContainer = document.getElementById('app-container');

    if (splash) splash.classList.add('hidden');
    if (appContainer) appContainer.classList.add('hidden');
    if (authScreen) authScreen.classList.remove('hidden');

    this.switchTab('login');
  },

  showApp() {
    const splash = document.getElementById('auth-loading-splash');
    const authScreen = document.getElementById('auth-screen');
    const appContainer = document.getElementById('app-container');

    if (splash) splash.classList.add('hidden');
    if (authScreen) authScreen.classList.add('hidden');
    if (appContainer) appContainer.classList.remove('hidden');

    this.clearErrors();
  },

  switchTab(tab) {
    this.currentTab = tab;
    this.clearErrors();

    const loginSection = document.getElementById('auth-section-login');
    const registerSection = document.getElementById('auth-section-register');
    const forgotSection = document.getElementById('auth-section-forgot');

    const tabBtnLogin = document.getElementById('auth-tab-btn-login');
    const tabBtnRegister = document.getElementById('auth-tab-btn-register');

    if (loginSection) loginSection.classList.toggle('hidden', tab !== 'login');
    if (registerSection) registerSection.classList.toggle('hidden', tab !== 'register');
    if (forgotSection) forgotSection.classList.toggle('hidden', tab !== 'forgot');

    if (tabBtnLogin) tabBtnLogin.classList.toggle('active', tab === 'login');
    if (tabBtnRegister) tabBtnRegister.classList.toggle('active', tab === 'register');
  },

  showError(message) {
    const errBox = document.getElementById(`auth-${this.currentTab}-error`);
    if (errBox) {
      errBox.textContent = message;
      errBox.classList.remove('hidden');
    }
  },

  clearErrors() {
    ['login', 'register', 'forgot'].forEach(tab => {
      const errBox = document.getElementById(`auth-${tab}-error`);
      if (errBox) {
        errBox.textContent = '';
        errBox.classList.add('hidden');
      }
    });
  },

  setLoading(btnId, isLoading, defaultText) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = isLoading;
    btn.innerHTML = isLoading 
      ? `<span class="auth-spinner"></span> Loading...` 
      : defaultText;
  },

  async handleLogin(e) {
    e.preventDefault();
    this.clearErrors();

    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;

    if (!email || !pass) {
      this.showError('Please enter both email and password.');
      return;
    }

    this.setLoading('btn-auth-login-submit', true, 'Login');
    const result = await firebaseService.login(email, pass);
    this.setLoading('btn-auth-login-submit', false, 'Login');

    if (!result.success) {
      this.showError(result.error);
    } else {
      this.setDeviceSession(result.user?.uid, email, pass);
      this.showApp();
      if (window.app && app.showToast) {
        app.showToast('Welcome back! 💕');
      }
    }
  },

  async handleRegister(e) {
    e.preventDefault();
    this.clearErrors();

    const name = document.getElementById('reg-name').value;
    const email = document.getElementById('reg-email').value;
    const pass = document.getElementById('reg-password').value;
    const city = document.getElementById('reg-city')?.value || 'Brisbane';
    const pairCode = document.getElementById('reg-pair-code')?.value || null;

    if (!name || !email || !pass) {
      this.showError('Please enter your name, email, and password.');
      return;
    }

    if (pass.length < 6) {
      this.showError('Password must be at least 6 characters.');
      return;
    }

    this.setLoading('btn-auth-register-submit', true, 'Sign Up');
    const result = await firebaseService.register(email, pass, name, city, pairCode);
    this.setLoading('btn-auth-register-submit', false, 'Sign Up');

    if (!result.success) {
      if (result.error && (result.error.includes('already registered') || result.error.includes('already in use'))) {
        const loginEmail = document.getElementById('login-email');
        if (loginEmail) loginEmail.value = email;
        this.showError('This email is already registered! Please switch to Login above to sign in.');
      } else {
        this.showError(result.error);
      }
    } else {
      this.setDeviceSession(result.user?.uid, email, pass);
      this.showApp();
      if (window.app && app.showToast) {
        if (pairCode && !firebaseService.isSolo) {
          app.showToast('🎉 Accounts linked! Welcome to your shared space 💕');
        } else {
          app.showToast(`🎉 Welcome to TwoDo, ${name}!`);
        }
      }
    }
  },

  async handleForgotPassword(e) {
    e.preventDefault();
    this.clearErrors();

    const email = document.getElementById('forgot-email').value;
    if (!email) {
      this.showError('Please enter your account email.');
      return;
    }

    this.setLoading('btn-auth-forgot-submit', true, 'Sending...');
    const result = await firebaseService.sendPasswordReset(email);
    this.setLoading('btn-auth-forgot-submit', false, 'Send Reset Link');

    if (!result.success) {
      this.showError(result.error);
    } else {
      if (window.app && app.showToast) {
        app.showToast('Password reset email sent! Check your inbox 📬');
      }
      this.switchTab('login');
    }
  },

  // ---------------------------------------------------------------------------
  // PAIR WITH PARTNER MODAL & CODE SHARING
  // ---------------------------------------------------------------------------
  openPairModal() {
    const modal = document.getElementById('pair-partner-modal');
    const codeDisplay = document.getElementById('my-pair-code-display');
    const errorBox = document.getElementById('pair-error-box');
    const input = document.getElementById('input-partner-code');

    if (codeDisplay) {
      codeDisplay.textContent = firebaseService.pairCode || 'TD-••••';
    }
    if (errorBox) {
      errorBox.textContent = '';
      errorBox.classList.add('hidden');
    }
    if (input) input.value = '';

    if (modal) {
      modal.classList.remove('hidden');
      document.body.style.overflow = 'hidden';
    }
  },

  closePairModal() {
    const modal = document.getElementById('pair-partner-modal');
    if (modal) {
      modal.classList.add('hidden');
      document.body.style.overflow = '';
    }
  },

  handlePairModalOverlayClick(e) {
    if (e.target.id === 'pair-partner-modal') {
      this.closePairModal();
    }
  },

  copyMyPairCode() {
    const code = firebaseService.pairCode;
    if (!code) return;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(() => {
        const btn = document.getElementById('btn-copy-code');
        if (btn) {
          const prev = btn.textContent;
          btn.textContent = '✓ Copied!';
          setTimeout(() => { btn.textContent = prev; }, 1800);
        }
        if (window.app && app.showToast) {
          app.showToast(`📋 Code "${code}" copied to clipboard! Text it to your partner.`);
        }
      }).catch(() => {
        prompt('Copy your invite code:', code);
      });
    } else {
      prompt('Copy your invite code:', code);
    }
  },

  async handlePairSubmit(e) {
    e.preventDefault();
    const input = document.getElementById('input-partner-code');
    const errBox = document.getElementById('pair-error-box');
    const btn = document.getElementById('btn-pair-submit');

    const code = input?.value?.trim() || '';
    if (!code) return;

    if (errBox) {
      errBox.textContent = '';
      errBox.classList.add('hidden');
    }

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="auth-spinner"></span> Linking...`;
    }

    const res = await firebaseService.pairWithPartner(code);

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `🔗 Link Together`;
    }

    if (!res.success) {
      if (errBox) {
        errBox.textContent = res.error;
        errBox.classList.remove('hidden');
      }
    } else {
      this.closePairModal();
      if (window.app && app.showToast) {
        app.showToast(`🎉 Linked with ${res.partnerName}! Spaces combined 💕`);
      }
      if (window.app && app.playCelebrationSound) {
        app.playCelebrationSound();
      }
    }
  },

  updatePairCodeUI(code) {
    const disp1 = document.getElementById('my-pair-code-display');
    const disp2 = document.getElementById('settings-my-code');
    if (disp1 && code) disp1.textContent = code;
    if (disp2 && code) disp2.textContent = code;
  },

  updateSettingsAccountUI(email, profile, isSolo = false, partnerName = null) {
    const accEmail = document.getElementById('settings-account-email');
    const accNames = document.getElementById('settings-account-names');
    const badge = document.getElementById('settings-account-badge');
    const pairSection = document.getElementById('settings-pair-section');
    const pairTitle = document.getElementById('settings-pair-title');
    const pairStatus = document.getElementById('settings-pair-status');
    const pairBtn = document.getElementById('btn-settings-pair-action');

    if (accEmail) accEmail.textContent = email || 'Signed In';

    if (isSolo) {
      if (badge) {
        badge.textContent = '👤 Solo Explorer';
        badge.style.background = '#f1f5f9';
        badge.style.color = '#475569';
      }
      if (accNames) accNames.textContent = profile?.user1_name || 'You';
      if (pairTitle) pairTitle.textContent = 'Partner Connection';
      if (pairStatus) pairStatus.textContent = 'Link with your partner to combine spaces';
      if (pairBtn) {
        pairBtn.textContent = 'Pair Code ✨';
        pairBtn.onclick = () => { app.closeSettingsModal(); authUI.openPairModal(); };
      }
    } else {
      if (badge) {
        badge.textContent = '💑 Active Couple';
        badge.style.background = '#ffe4e6';
        badge.style.color = '#e11d48';
      }
      if (accNames) accNames.textContent = `${profile?.user1_name || 'Emma'} & ${profile?.user2_name || 'Jordan'}`;
      if (pairTitle) pairTitle.textContent = `Linked with ${partnerName || profile?.user2_name || 'Partner'}`;
      if (pairStatus) pairStatus.textContent = 'Spaces combined • Sharing likes, notes & chat';
      if (pairBtn) {
        pairBtn.textContent = 'Unlink';
        pairBtn.onclick = async () => {
          if (confirm('Are you sure you want to unlink partner? You will return to solo explorer mode.')) {
            await firebaseService.unpairPartner();
            app.closeSettingsModal();
            app.showToast('Unlinked from partner space.');
          }
        };
      }
    }

    this.updatePairCodeUI(firebaseService.pairCode);
  },

  async handleLogout() {
    if (confirm('Are you sure you want to log out of TwoDo?')) {
      this.clearDeviceSession();
      if (window.app && app.closeSettingsModal) {
        app.closeSettingsModal();
      }
      await firebaseService.logout();
      this.showAuthScreen();
      if (window.app && app.showToast) {
        app.showToast('Logged out of TwoDo.');
      }
    }
  }
};

window.addEventListener('DOMContentLoaded', () => {
  authUI.init();
});

/**
 * TwoDo Authentication UI Controller
 * Manages the Centsauble-style Login & Sign Up screen, Splash check, and Logout flow
 */
const authUI = {
  currentTab: 'login', // 'login' | 'register' | 'forgot'

  init() {
    this.bindEvents();

    // Check device session persistence: remember user across visits
    const hasSession = localStorage.getItem('twodo_session_active') === '1';
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
      localStorage.setItem('twodo_session_active', '1');
      if (result.user && result.user.uid) {
        localStorage.setItem('twodo_user_uid', result.user.uid);
      }
      this.showApp();
      if (window.app && app.showToast) {
        app.showToast('Welcome back! 💕');
      }
    }
  },

  async handleRegister(e) {
    e.preventDefault();
    this.clearErrors();

    const email = document.getElementById('reg-email').value;
    const pass = document.getElementById('reg-password').value;
    const u1 = document.getElementById('reg-user1').value;
    const u2 = document.getElementById('reg-user2').value;
    const city = document.getElementById('reg-city')?.value || 'Brisbane';

    if (!email || !pass || !u1 || !u2) {
      this.showError('Please fill in all couple details.');
      return;
    }

    if (pass.length < 6) {
      this.showError('Password must be at least 6 characters.');
      return;
    }

    this.setLoading('btn-auth-register-submit', true, 'Sign Up');
    const result = await firebaseService.register(email, pass, u1, u2, city);
    this.setLoading('btn-auth-register-submit', false, 'Sign Up');

    if (!result.success) {
      if (result.error && (result.error.includes('already registered') || result.error.includes('already in use'))) {
        const loginEmail = document.getElementById('login-email');
        if (loginEmail) loginEmail.value = email;
        this.showError('This couple email is already registered! Please switch to Login above to sign in.');
      } else {
        this.showError(result.error);
      }
    } else {
      localStorage.setItem('twodo_session_active', '1');
      if (result.user && result.user.uid) {
        localStorage.setItem('twodo_user_uid', result.user.uid);
      }
      this.showApp();
      if (window.app && app.showToast) {
        app.showToast(`🎉 TwoDo space created for ${u1} & ${u2}!`);
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

  updateSettingsAccountUI(email, profile) {
    const accEmail = document.getElementById('settings-account-email');
    const accNames = document.getElementById('settings-account-names');
    if (accEmail) accEmail.textContent = email || 'Signed In';
    if (accNames) accNames.textContent = `${profile?.user1_name || 'Partner 1'} & ${profile?.user2_name || 'Partner 2'}`;
  },

  async handleLogout() {
    if (confirm('Are you sure you want to log out of TwoDo?')) {
      localStorage.removeItem('twodo_session_active');
      localStorage.removeItem('twodo_user_uid');
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

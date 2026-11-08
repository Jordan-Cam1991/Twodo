/**
 * TwoDo Notification Manager
 * Handles OneSignal Web Push, Service Worker lock-screen notifications,
 * sound alerts, and partner remote push dispatch for Apple iOS (PWA) & Android.
 */
const notifications = {
  swRegistration: null,
  isSupported: false,
  permission: 'default',
  oneSignalInitialized: false,

  getOneSignalConfig() {
    const hardcoded = (typeof window !== 'undefined' && window.TWODO_ONESIGNAL_CONFIG) || {};
    const localAppId = localStorage.getItem('twodo_onesignal_app_id');
    const localRestKey = localStorage.getItem('twodo_onesignal_rest_key');
    const firestoreAppId = (typeof firebaseService !== 'undefined' && firebaseService.coupleData?.onesignal_app_id);
    const firestoreRestKey = (typeof firebaseService !== 'undefined' && firebaseService.coupleData?.onesignal_rest_key);

    return {
      appId: localAppId || firestoreAppId || hardcoded.appId || '',
      restKey: localRestKey || firestoreRestKey || hardcoded.restKey || ''
    };
  },

  async init() {
    this.isSupported = ('Notification' in window) && ('serviceWorker' in navigator);
    if (!this.isSupported) {
      console.log('Notifications not supported in this browser environment.');
      return;
    }

    this.permission = Notification.permission;
    this.updateUI();

    // 1. Register Service Worker (OneSignal worker handles background wake-ups)
    try {
      this.swRegistration = await navigator.serviceWorker.register('/OneSignalSDKWorker.js');
      console.log('TwoDo Service Worker registered for lock-screen alerts.');

      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.action === 'navigate' && event.data.tab) {
          if (window.app && app.navigate) {
            app.navigate(event.data.tab);
          }
        }
      });
    } catch (err) {
      console.warn('Worker registration note:', err);
    }

    // 2. Initialize OneSignal Web SDK if configured
    this.initOneSignal();

    // 3. Check if opened via notification url param (?tab=chat / ?tab=matches / ?tab=planner)
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const tabParam = urlParams.get('tab');
      if (tabParam && ['discover', 'swiper', 'matches', 'chat', 'planner'].includes(tabParam)) {
        setTimeout(() => {
          if (window.app && app.navigate) app.navigate(tabParam);
        }, 300);
      }
    } catch (e) {}
  },

  initOneSignal() {
    const cfg = this.getOneSignalConfig();
    if (!cfg.appId) return;

    window.OneSignalDeferred = window.OneSignalDeferred || [];
    const self = this;
    window.OneSignalDeferred.push(async function(OneSignal) {
      try {
        await OneSignal.init({
          appId: cfg.appId,
          notifyButton: { enable: false },
          allowLocalhostAsSecureOrigin: true
        });

        self.oneSignalInitialized = true;
        console.log('OneSignal initialized successfully.');

        // Identify this specific user so partner can push directly to their lock screen
        self.syncOneSignalUser();

        OneSignal.Notifications.addEventListener('permissionChange', (permission) => {
          self.permission = permission ? 'granted' : 'denied';
          self.updateUI();
          if (permission) self.syncOneSignalUser();
        });
      } catch (err) {
        console.warn('OneSignal init error:', err);
      }
    });
  },

  syncOneSignalUser() {
    if (typeof window === 'undefined' || !window.OneSignalDeferred) return;
    const coupleId = (typeof firebaseService !== 'undefined') ? firebaseService.coupleId : null;
    const myName = (typeof app !== 'undefined' && app.getActiveVoterName) ? app.getActiveVoterName() : (localStorage.getItem('twodo_user_name') || 'Emma');
    if (!coupleId || !myName) return;

    const externalId = `twodo_${coupleId}_${myName.toLowerCase().trim()}`;
    window.OneSignalDeferred.push(async function(OneSignal) {
      try {
        await OneSignal.login(externalId);
        await OneSignal.User.addTags({
          couple_id: coupleId,
          user_name: myName
        });
        console.log('OneSignal user alias registered:', externalId);
      } catch (e) {
        console.warn('OneSignal login error:', e);
      }
    });
  },

  async requestPermission() {
    if (!('Notification' in window)) {
      alert('Notifications are not supported in this browser.');
      return false;
    }

    try {
      let result = 'default';
      if (window.OneSignalDeferred && this.getOneSignalConfig().appId) {
        window.OneSignalDeferred.push(async function(OneSignal) {
          await OneSignal.Notifications.requestPermission();
        });
        result = Notification.permission;
      } else {
        result = await Notification.requestPermission();
      }

      this.permission = result;
      this.updateUI();

      if (result === 'granted') {
        this.syncOneSignalUser();
        if (window.app && app.showToast) {
          app.showToast('🔔 Lock-screen notifications enabled!');
        }
        this.sendNotification('🎉 Notifications Enabled!', {
          body: 'You\'ll be alerted whenever a match occurs, chat is sent, or date is planned!',
          tag: 'twodo-welcome',
          data: { tab: 'discover' }
        });
        return true;
      } else if (result === 'denied') {
        if (window.app && app.showToast) {
          app.showToast('Notifications blocked in browser settings.');
        }
        return false;
      }
    } catch (err) {
      console.warn('Permission request error:', err);
      return false;
    }
  },

  updateUI() {
    const statusEl = document.getElementById('notif-status-badge');
    const btnEl = document.getElementById('btn-toggle-notifs');
    const isGranted = (this.permission === 'granted');
    const cfg = this.getOneSignalConfig();

    if (statusEl) {
      if (isGranted) {
        statusEl.textContent = cfg.appId ? 'Active on Lock Screen 🟢' : 'In-App Only 🟡';
        statusEl.className = 'settings-notif-badge enabled';
      } else if (this.permission === 'denied') {
        statusEl.textContent = 'Blocked in Browser ❌';
        statusEl.className = 'settings-notif-badge';
      } else {
        statusEl.textContent = 'Tap to Enable ⚪';
        statusEl.className = 'settings-notif-badge';
      }
    }

    if (btnEl) {
      btnEl.textContent = isGranted ? 'Test Alert ✨' : 'Enable 🔔';
    }

    const appInput = document.getElementById('set-onesignal-appid');
    const restInput = document.getElementById('set-onesignal-restkey');
    if (appInput && !appInput.value && cfg.appId) appInput.value = cfg.appId;
    if (restInput && !restInput.value && cfg.restKey) restInput.value = cfg.restKey;
  },

  async saveOneSignalKeys() {
    const appInput = document.getElementById('set-onesignal-appid');
    const restInput = document.getElementById('set-onesignal-restkey');
    const appId = appInput ? appInput.value.trim() : '';
    const restKey = restInput ? restInput.value.trim() : '';

    if (!appId || !restKey) {
      if (window.app && app.showToast) app.showToast('Please enter both App ID and REST Key');
      return;
    }

    localStorage.setItem('twodo_onesignal_app_id', appId);
    localStorage.setItem('twodo_onesignal_rest_key', restKey);

    // Sync to Firestore couple doc so partner's device gets it automatically!
    if (typeof firebaseService !== 'undefined' && firebaseService.coupleId) {
      try {
        await firebaseService.db.collection('couples').doc(firebaseService.coupleId).set({
          onesignal_app_id: appId,
          onesignal_rest_key: restKey
        }, { merge: true });
      } catch (e) {}
    }

    this.initOneSignal();
    this.updateUI();

    if (window.app && app.showToast) {
      app.showToast('🎉 OneSignal Push connected! Both phones now receive lock screen alerts.');
    }
  },

  /** Dispatches an actual lock-screen push directly to your partner's sleeping phone via OneSignal REST API */
  async sendRemotePush({ targetPartnerName, title, message, tab = 'chat' }) {
    const cfg = this.getOneSignalConfig();
    const coupleId = (typeof firebaseService !== 'undefined') ? firebaseService.coupleId : null;
    if (!cfg.appId || !cfg.restKey || !coupleId) {
      console.log('OneSignal push skipped (not configured or no couple linked).');
      return;
    }

    const partnerName = (targetPartnerName || '').toLowerCase().trim();
    if (!partnerName) return;

    // Send to partner's specific alias, plus lowercase and canonical fallback aliases
    const targetAlias = `twodo_${coupleId}_${partnerName}`;
    const fallbackAlias = (partnerName === 'emma') ? `twodo_${coupleId}_emma` : `twodo_${coupleId}_jordan`;
    const aliases = Array.from(new Set([targetAlias, fallbackAlias]));

    const payload = {
      app_id: cfg.appId,
      include_aliases: {
        external_id: aliases
      },
      target_channel: "push",
      headings: { en: title },
      contents: { en: message },
      data: { tab: tab },
      web_url: `https://twodoapp.web.app/?tab=${tab}`
    };

    try {
      const res = await fetch('https://api.onesignal.com/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Key ${cfg.restKey}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      console.log('OneSignal push result:', data);
    } catch (err) {
      console.warn('OneSignal push network error:', err);
    }
  },

  // Fallback foreground notification (when active)
  async sendNotification(title, options = {}) {
    if (this.permission !== 'granted') return;

    const notifOptions = {
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [200, 100, 200],
      renotify: true,
      ...options
    };

    try {
      if (window.app && app.playCelebrationSound) app.playCelebrationSound();
    } catch (e) {}

    if (this.swRegistration && this.swRegistration.showNotification) {
      try {
        await this.swRegistration.showNotification(title, notifOptions);
        return;
      } catch (err) {}
    }

    try {
      new Notification(title, notifOptions);
    } catch (e) {}
  },

  // 1. Notify Mutual Match
  notifyMatch(eventTitle, partnerName = 'Your Partner') {
    const cleanTitle = (eventTitle || 'Date Idea').trim();
    this.sendNotification('💖 It\'s a Match!', {
      body: `You and ${partnerName} both love "${cleanTitle}"! Tap to pick a date & plan it.`,
      tag: `match_${cleanTitle}`,
      data: { tab: 'matches' }
    });

    if (window.app && app.showToast) {
      app.showToast(`💖 Match! You and ${partnerName} both love "${cleanTitle}"`);
    }
  },

  // 2. Notify Couple Chat Message
  notifyChat(senderName, messageText) {
    const cleanSender = (senderName || 'Partner').trim();
    const cleanText = (messageText || 'Sent a message').trim();
    this.sendNotification(`💬 ${cleanSender}`, {
      body: cleanText.length > 80 ? cleanText.slice(0, 77) + '...' : cleanText,
      tag: 'twodo_chat_msg',
      data: { tab: 'chat' }
    });
  },

  // 3. Notify Event / Plan Added to Planner
  notifyPlanner(eventTitle, dateStr, partnerName = 'Your Partner') {
    const cleanTitle = (eventTitle || 'Date Plan').trim();
    const dateDesc = dateStr ? ` for ${dateStr}` : '';
    this.sendNotification('📅 New Date in Planner!', {
      body: `${partnerName} added "${cleanTitle}"${dateDesc} to your shared planner.`,
      tag: `plan_${cleanTitle}`,
      data: { tab: 'planner' }
    });

    if (window.app && app.showToast) {
      app.showToast(`📅 ${partnerName} scheduled "${cleanTitle}"${dateDesc}`);
    }
  }
};

// Auto-initialize when script loads
if (typeof window !== 'undefined') {
  window.notifications = notifications;
  window.addEventListener('DOMContentLoaded', () => {
    notifications.init();
  });
}

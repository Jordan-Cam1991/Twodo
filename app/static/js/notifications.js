/**
 * TwoDo Notification Manager
 * Handles Web Push, Service Worker lock-screen notifications, sound alerts,
 * and permission management across Apple iOS (PWA/Home Screen) and Android.
 */
const notifications = {
  swRegistration: null,
  isSupported: false,
  permission: 'default',

  async init() {
    this.isSupported = ('Notification' in window) && ('serviceWorker' in navigator);
    if (!this.isSupported) {
      console.log('Notifications or Service Worker not supported on this browser/environment.');
      return;
    }

    this.permission = Notification.permission;
    this.updateUI();

    // Register Service Worker
    try {
      this.swRegistration = await navigator.serviceWorker.register('/sw.js');
      console.log('TwoDo Service Worker registered for notifications.');

      // Listen for messages from SW (e.g. click navigation)
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.action === 'navigate' && event.data.tab) {
          if (window.app && app.navigate) {
            app.navigate(event.data.tab);
          }
        }
      });
    } catch (err) {
      console.warn('Service Worker registration note:', err);
    }

    // Check if opened via notification url param (?tab=chat / ?tab=matches / ?tab=planner)
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

  async requestPermission() {
    if (!('Notification' in window)) {
      alert('Notifications are not supported in this browser.');
      return false;
    }

    try {
      const result = await Notification.requestPermission();
      this.permission = result;
      this.updateUI();

      if (result === 'granted') {
        if (window.app && app.showToast) {
          app.showToast('🔔 Lock-screen notifications enabled!');
        }
        // Send a celebratory test notification so user can see it works right away
        this.sendNotification('🎉 Notifications Enabled!', {
          body: 'You\'ll be alerted whenever a match occurs, chat message is sent, or date is planned!',
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
    const promptBanner = document.getElementById('notif-prompt-banner');

    const isGranted = (this.permission === 'granted');

    if (statusEl) {
      statusEl.textContent = isGranted ? 'Enabled 🟢' : (this.permission === 'denied' ? 'Blocked ❌' : 'Off ⚪');
      statusEl.className = isGranted ? 'settings-notif-badge enabled' : 'settings-notif-badge';
    }

    if (btnEl) {
      btnEl.textContent = isGranted ? 'Test Alert ✨' : 'Enable 🔔';
    }

    if (promptBanner) {
      promptBanner.classList.toggle('hidden', isGranted);
    }
  },

  async sendNotification(title, options = {}) {
    if (this.permission !== 'granted') return;

    const notifOptions = {
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [200, 100, 200],
      renotify: true,
      ...options
    };

    // Play subtle alert tone if app in foreground
    try {
      if (window.app && app.playCelebrationSound) {
        app.playCelebrationSound();
      }
    } catch (e) {}

    // Use Service Worker showNotification if active (essential for lock-screen display on mobile & PWA)
    if (this.swRegistration && this.swRegistration.showNotification) {
      try {
        await this.swRegistration.showNotification(title, notifOptions);
        return;
      } catch (err) {
        console.warn('SW showNotification fallback:', err);
      }
    }

    // Direct Notification fallback
    try {
      new Notification(title, notifOptions);
    } catch (e) {
      console.warn('Direct notification error:', e);
    }
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

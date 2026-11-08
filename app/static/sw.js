// TwoDo Service Worker for Push Notifications & Lock Screen Alerts
const CACHE_NAME = 'twodo-cache-v4.5';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

// Handle incoming Web Push notifications (if sent from backend or cloud function)
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'TwoDo Alert', body: event.data ? event.data.text() : 'You have a new update!' };
  }

  const title = data.title || 'TwoDo Alert 💖';
  const options = {
    body: data.body || 'New couple activity in TwoDo!',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200],
    data: data.data || { tab: 'discover' },
    tag: data.tag || 'twodo-notification',
    renotify: true
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Handle Notification Click (Opens or focuses the app, then navigates to Matches, Chat, or Planner)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetTab = event.notification.data?.tab || 'discover';
  const urlToOpen = new URL('/?tab=' + targetTab, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({ action: 'navigate', tab: targetTab });
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

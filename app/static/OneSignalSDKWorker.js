// OneSignal Service Worker for True Background Lock-Screen Push Notifications
importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
try {
  importScripts('/sw.js');
} catch (e) {
  console.warn('Fallback sw.js import note:', e);
}

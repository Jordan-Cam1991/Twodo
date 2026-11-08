/**
 * TwoDo Firebase Configuration & Initialization
 */
const firebaseConfig = {
  apiKey: "AIzaSyBJN9it4YzLSdItz0ccddeM9Ld2EoJPOuw",
  authDomain: "twodo-c07a8.firebaseapp.com",
  databaseURL: "https://twodo-c07a8-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "twodo-c07a8",
  storageBucket: "twodo-c07a8.firebasestorage.app",
  messagingSenderId: "623137975538",
  appId: "1:623137975538:web:a73938aa41ed004c74346b",
  measurementId: "G-DSCSPW6SSS"
};

// Initialize Firebase
if (typeof firebase !== 'undefined') {
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
}

// Global OneSignal Web Push Configuration (Optional default fallback)
window.TWODO_ONESIGNAL_CONFIG = {
  appId: "",
  restKey: ""
};

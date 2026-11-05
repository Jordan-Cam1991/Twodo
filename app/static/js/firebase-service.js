/**
 * TwoDo Firebase Real-Time Service
 * Manages Multi-Couple Authentication & Cloud Firestore Synchronization
 */
const firebaseService = {
  auth: null,
  db: null,
  currentUser: null,
  coupleId: null,
  profile: null,
  
  // Real-time unsubscription handles
  unsubVotes: null,
  unsubPlanner: null,
  unsubMessages: null,
  unsubCustomEvents: null,

  // In-memory data store for the active couple
  votesMap: {},
  notesMap: {},
  plannerItems: [],
  messages: [],
  customEvents: [],

  init() {
    if (typeof firebase === 'undefined') {
      console.warn('Firebase SDK not loaded.');
      return;
    }
    this.auth = firebase.auth();
    this.db = firebase.firestore();

    // Enable offline persistence if supported (safe non-blocking)
    try {
      this.db.enablePersistence().catch(err => {
        // Multi-tab or unsupported - silent catch
      });
    } catch (e) {}

    // Listen for authentication state changes
    this.auth.onAuthStateChanged(async (user) => {
      if (user) {
        this.currentUser = user;
        this.coupleId = user.uid;
        await this.handleUserSignedIn(user);
      } else {
        this.handleUserSignedOut();
      }
    });
  },

  // ---------------------------------------------------------------------------
  // AUTHENTICATION
  // ---------------------------------------------------------------------------
  async login(email, password) {
    try {
      const cred = await this.auth.signInWithEmailAndPassword(email.trim(), password);
      this.currentUser = cred.user;
      this.coupleId = cred.user.uid;
      return { success: true, user: cred.user };
    } catch (err) {
      return { success: false, error: this.formatAuthError(err) };
    }
  },

  async register(email, password, user1Name, user2Name, defaultCity = 'Brisbane') {
    try {
      const u1 = (user1Name || '').trim() || 'Partner 1';
      const u2 = (user2Name || '').trim() || 'Partner 2';
      const city = (defaultCity || '').trim() || 'Brisbane';

      // Set profile immediately in memory & localStorage so UI is instant
      const coupleDoc = {
        user1_name: u1,
        user1_color: '#ec4899',
        user2_name: u2,
        user2_color: '#8b5cf6',
        default_city: city,
        email: email.trim(),
        created_at: new Date().toISOString()
      };
      this.profile = coupleDoc;
      try {
        localStorage.setItem('twodo_profile', JSON.stringify(coupleDoc));
      } catch (e) {}

      // Create Firebase Auth user
      const cred = await this.auth.createUserWithEmailAndPassword(email.trim(), password);
      const uid = cred.user.uid;
      this.currentUser = cred.user;
      this.coupleId = uid;

      // Update app state immediately so UI opens with registered couple names
      if (window.app) {
        app.profile = coupleDoc;
        app.currentCity = city;
        app.updateProfileUI();
        if (window.discover && discover.loadEvents) {
          discover.loadEvents(true);
        }
      }

      // Background Firestore persistence (non-blocking)
      this.db.collection('couples').doc(uid).set({
        ...coupleDoc,
        created_at: firebase.firestore.FieldValue.serverTimestamp()
      }).catch(err => console.warn('Background Firestore profile save note:', err));

      // Background welcome chat message (non-blocking)
      this.db.collection('couples').doc(uid).collection('messages').add({
        sender_name: u1,
        text: `Hey ${u2}! Welcome to our TwoDo app 💕 Ready to find some fun dates?`,
        activity_id: null,
        activity_title: null,
        activity_image: null,
        created_at: firebase.firestore.FieldValue.serverTimestamp()
      }).catch(err => console.warn('Background Firestore message note:', err));

      // Attach Firestore listeners
      this.attachListeners(uid);

      return { success: true, user: cred.user };
    } catch (err) {
      return { success: false, error: this.formatAuthError(err) };
    }
  },

  async logout() {
    this.detachListeners();
    try {
      await this.auth.signOut();
    } catch (err) {
      console.error('Logout error:', err);
    }
    this.handleUserSignedOut();
  },

  async sendPasswordReset(email) {
    try {
      await this.auth.sendPasswordResetEmail(email.trim());
      return { success: true };
    } catch (err) {
      return { success: false, error: this.formatAuthError(err) };
    }
  },

  formatAuthError(err) {
    const code = err.code || '';
    if (code.includes('invalid-email')) return 'Please enter a valid email address.';
    if (code.includes('user-not-found')) return 'No couple account found with this email.';
    if (code.includes('wrong-password') || code.includes('invalid-credential')) return 'Incorrect email or password.';
    if (code.includes('email-already-in-use')) return 'This email is already registered. Try signing in.';
    if (code.includes('weak-password')) return 'Password should be at least 6 characters.';
    return err.message || 'Authentication error. Please try again.';
  },

  // ---------------------------------------------------------------------------
  // AUTH STATE HANDLERS
  // ---------------------------------------------------------------------------
  async handleUserSignedIn(user) {
    console.log('Couple signed in:', user.email, 'UID:', user.uid);
    this.currentUser = user;
    this.coupleId = user.uid;

    // If profile is not in memory yet (e.g. reload or fresh login), check cache and Firestore
    if (!this.profile) {
      try {
        const cached = localStorage.getItem('twodo_profile');
        if (cached) {
          this.profile = JSON.parse(cached);
        }
      } catch (e) {}

      // Fetch fresh profile from Firestore with 2s timeout so we never hang
      try {
        const fetchPromise = this.db.collection('couples').doc(user.uid).get();
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject('timeout'), 2000));
        const doc = await Promise.race([fetchPromise, timeoutPromise]);
        if (doc && doc.exists) {
          this.profile = doc.data();
          try {
            localStorage.setItem('twodo_profile', JSON.stringify(this.profile));
          } catch (e) {}
        }
      } catch (e) {
        console.warn('Profile fetch note:', e);
      }
    }

    if (!this.profile) {
      this.profile = {
        user1_name: 'Emma',
        user1_color: '#ec4899',
        user2_name: 'Jordan',
        user2_color: '#8b5cf6',
        default_city: 'Brisbane',
        email: user.email
      };
    }

    // Update global app state with couple profile
    if (window.app) {
      app.profile = this.profile;
      app.currentCity = this.profile.default_city || 'Brisbane';
      app.updateProfileUI();
      if (window.discover && discover.loadEvents) {
        discover.loadEvents(true);
      }
      if (window.planner && planner.loadPlanner) {
        planner.loadPlanner();
      }
    }

    // Reveal Main App & update account details in settings immediately
    if (window.authUI) {
      authUI.showApp();
      authUI.updateSettingsAccountUI(user.email, this.profile);
    }

    // Attach real-time listeners for this couple's data
    this.attachListeners(user.uid);
  },

  handleUserSignedOut() {
    console.log('Couple signed out');
    this.currentUser = null;
    this.coupleId = null;
    this.profile = null;
    this.detachListeners();

    // Reset in-memory data
    this.votesMap = {};
    this.notesMap = {};
    this.plannerItems = [];
    this.messages = [];
    this.customEvents = [];

    // Show Centsauble-style Auth Screen
    if (window.authUI) {
      authUI.showAuthScreen();
    }
  },

  // ---------------------------------------------------------------------------
  // REAL-TIME FIRESTORE LISTENERS (SCOPED TO COUPLE UID)
  // ---------------------------------------------------------------------------
  attachListeners(uid) {
    this.detachListeners();

    const coupleRef = this.db.collection('couples').doc(uid);

    // 1. Live Votes & Notes Listener
    this.unsubVotes = coupleRef.collection('votes').onSnapshot((snapshot) => {
      const newVotes = {};
      const newNotes = {};

      snapshot.forEach((doc) => {
        const data = doc.data();
        const evId = doc.id;
        const votes = data.votes || {};
        const notes = data.notes || {};

        Object.keys(votes).forEach(userName => {
          newVotes[`${evId}_${userName}`] = votes[userName];
        });
        Object.keys(notes).forEach(userName => {
          if (notes[userName]) newNotes[`${evId}_${userName}`] = notes[userName];
        });
      });

      this.votesMap = newVotes;
      this.notesMap = newNotes;

      // Trigger Discover & Swiper UI refresh with fresh votes
      if (window.discover && app.events) {
        discover.refreshWithLatestVotes();
      }
    }, (err) => console.error('Votes listener error:', err));

    // 2. Live Planner Items Listener
    this.unsubPlanner = coupleRef.collection('planner').onSnapshot((snapshot) => {
      const items = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        items.push({
          id: doc.id,
          event_id: data.event_id,
          status: data.status || 'bucket_list',
          scheduled_date: data.scheduled_date || null,
          time_slot: data.time_slot || 'evening',
          notes: data.notes || '',
          budget: data.budget || 0,
          reservation_info: data.reservation_info || '',
          title: data.title || '',
          category: data.category || '',
          location_name: data.location_name || '',
          city: data.city || '',
          image_url: data.image_url || '',
          price_str: data.price_str || '',
          created_at: data.created_at ? data.created_at.toDate?.()?.toISOString?.() : new Date().toISOString()
        });
      });

      this.plannerItems = items;
      if (window.planner) {
        planner.items = items;
        planner.renderPlanner();
        planner.updatePlannerCountBadge();
      }
    }, (err) => console.error('Planner listener error:', err));

    // 3. Live Couple Chat Messages Listener
    this.unsubMessages = coupleRef.collection('messages')
      .orderBy('created_at', 'asc')
      .onSnapshot((snapshot) => {
        const msgs = [];
        snapshot.forEach((doc) => {
          const d = doc.data();
          msgs.push({
            id: doc.id,
            sender_name: d.sender_name || 'Partner',
            text: d.text || '',
            activity_id: d.activity_id || null,
            activity_title: d.activity_title || null,
            activity_image: d.activity_image || null,
            created_at: d.created_at ? (d.created_at.toDate?.()?.toISOString?.() || new Date().toISOString()) : new Date().toISOString()
          });
        });

        this.messages = msgs;
        if (window.chatView) {
          chatView.messages = msgs;
          chatView.renderMessages();
        }
      }, (err) => console.error('Messages listener error:', err));

    // 4. Live Custom Events Listener
    this.unsubCustomEvents = coupleRef.collection('custom_events').onSnapshot((snapshot) => {
      const custom = [];
      snapshot.forEach((doc) => {
        custom.push({ id: doc.id, ...doc.data() });
      });
      this.customEvents = custom;
      if (window.discover) {
        discover.loadEvents(true);
      }
    }, (err) => console.error('Custom events error:', err));
  },

  detachListeners() {
    if (this.unsubVotes) { this.unsubVotes(); this.unsubVotes = null; }
    if (this.unsubPlanner) { this.unsubPlanner(); this.unsubPlanner = null; }
    if (this.unsubMessages) { this.unsubMessages(); this.unsubMessages = null; }
    if (this.unsubCustomEvents) { this.unsubCustomEvents(); this.unsubCustomEvents = null; }
  },

  // ---------------------------------------------------------------------------
  // COUPLE DATA MUTATIONS
  // ---------------------------------------------------------------------------
  async saveVote(eventId, userName, voteType, note = null) {
    if (!this.coupleId) return;

    const docRef = this.db.collection('couples').doc(this.coupleId).collection('votes').doc(eventId);
    const updatePayload = {
      event_id: eventId,
      [`votes.${userName}`]: voteType,
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (note !== null) {
      updatePayload[`notes.${userName}`] = note;
    }

    try {
      await docRef.set(updatePayload, { merge: true });
      return { success: true };
    } catch (e) {
      console.error('Failed to save vote to Firestore:', e);
      throw e;
    }
  },

  async addPlannerItem(item) {
    if (!this.coupleId) return;

    const coll = this.db.collection('couples').doc(this.coupleId).collection('planner');
    const docData = {
      event_id: item.event_id,
      status: item.status || 'bucket_list',
      scheduled_date: item.scheduled_date || null,
      time_slot: item.time_slot || 'evening',
      notes: item.notes || '',
      budget: item.budget || 0,
      title: item.title || '',
      category: item.category || '',
      location_name: item.location_name || '',
      city: item.city || '',
      image_url: item.image_url || '',
      price_str: item.price_str || '',
      created_at: firebase.firestore.FieldValue.serverTimestamp()
    };

    const docRef = await coll.add(docData);
    return { success: true, id: docRef.id };
  },

  async updatePlannerItem(id, updates) {
    if (!this.coupleId || !id) return;
    const docRef = this.db.collection('couples').doc(this.coupleId).collection('planner').doc(String(id));
    await docRef.update(updates);
    return { success: true };
  },

  async deletePlannerItem(id) {
    if (!this.coupleId || !id) return;
    const docRef = this.db.collection('couples').doc(this.coupleId).collection('planner').doc(String(id));
    await docRef.delete();
    return { success: true };
  },

  async sendChatMessage(senderName, text, activity = null) {
    if (!this.coupleId) return;

    const msgData = {
      sender_name: senderName,
      text: text,
      activity_id: activity?.id || null,
      activity_title: activity?.title || null,
      activity_image: activity?.image_url || null,
      created_at: firebase.firestore.FieldValue.serverTimestamp()
    };

    const docRef = await this.db.collection('couples').doc(this.coupleId).collection('messages').add(msgData);
    return { success: true, id: docRef.id };
  },

  async addCustomActivity(data) {
    if (!this.coupleId) return;

    const slug = 'cust-' + Date.now();
    const docData = {
      id: slug,
      title: data.title,
      category: data.category || 'General',
      price_level: data.price_level || '$$',
      price_str: data.price_level || '$$',
      location_name: data.location_name || 'Brisbane',
      city: data.city || 'Brisbane',
      description: data.description || '',
      insider_tip: data.insider_tip || '',
      source_url: data.source_url || '',
      source: `${this.profile?.user1_name || 'Couple'} & ${this.profile?.user2_name || ''} Custom`,
      image_url: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80',
      tags: ['Custom Date', data.category || 'Activity'],
      is_custom: 1,
      created_at: firebase.firestore.FieldValue.serverTimestamp()
    };

    await this.db.collection('couples').doc(this.coupleId).collection('custom_events').doc(slug).set(docData);
    return { success: true, event: docData };
  },

  async updateCoupleProfile(profileData) {
    if (!this.coupleId) return;
    await this.db.collection('couples').doc(this.coupleId).set(profileData, { merge: true });
    this.profile = { ...this.profile, ...profileData };
    return { success: true, profile: this.profile };
  }
};

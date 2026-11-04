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

    // Enable offline persistence if supported
    try {
      this.db.enablePersistence({ synchronizeTabs: true }).catch(err => {
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

      const cred = await this.auth.createUserWithEmailAndPassword(email.trim(), password);
      const uid = cred.user.uid;

      // Create couple profile in Firestore
      const coupleDoc = {
        user1_name: u1,
        user1_color: '#ec4899',
        user2_name: u2,
        user2_color: '#8b5cf6',
        default_city: city,
        email: email.trim(),
        created_at: firebase.firestore.FieldValue.serverTimestamp()
      };

      await this.db.collection('couples').doc(uid).set(coupleDoc);

      // Seed a cute welcome chat message
      await this.db.collection('couples').doc(uid).collection('messages').add({
        sender_name: u1,
        text: `Hey ${u2}! Welcome to our TwoDo app 💕 Ready to find some fun dates?`,
        activity_id: null,
        activity_title: null,
        activity_image: null,
        created_at: firebase.firestore.FieldValue.serverTimestamp()
      });

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

    // Fetch couple profile doc
    try {
      const doc = await this.db.collection('couples').doc(user.uid).get();
      if (doc.exists) {
        this.profile = doc.data();
      } else {
        // Fallback default profile if doc missing
        this.profile = {
          user1_name: 'Emma',
          user1_color: '#ec4899',
          user2_name: 'Jordan',
          user2_color: '#8b5cf6',
          default_city: 'Brisbane',
          email: user.email
        };
        await this.db.collection('couples').doc(user.uid).set(this.profile);
      }
    } catch (e) {
      console.error('Error fetching profile:', e);
      this.profile = { user1_name: 'Emma', user2_name: 'Jordan', default_city: 'Brisbane' };
    }

    // Update global app state with couple profile
    if (window.app) {
      app.profile = this.profile;
      app.currentCity = this.profile.default_city || 'Brisbane';
      app.updateProfileUI();
    }

    // Hide Auth Modal
    if (window.authUI) {
      authUI.hideAuthModal();
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

    // Show Auth Modal
    if (window.authUI) {
      authUI.showAuthModal();
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

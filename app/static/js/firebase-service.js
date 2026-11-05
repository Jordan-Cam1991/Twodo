/**
 * TwoDo Firebase Real-Time Service
 * Manages Individual Authentication, Solo Explorer Mode, Partner Pairing & Cloud Firestore Sync
 */
const firebaseService = {
  auth: null,
  db: null,
  currentUser: null,
  userProfile: null, // Individual user record { uid, name, email, pair_code, status, couple_id, partner_uid, partner_name }
  isSolo: true,      // true when single / not paired yet, false when linked in a couple
  coupleId: null,    // coupled document ID (or null when solo)
  profile: null,     // active display profile { user1_name, user2_name, default_city }
  pairCode: null,    // user's 6-character partner invite code (e.g. TD-4892)

  // Real-time unsubscription handles
  unsubVotes: null,
  unsubPlanner: null,
  unsubMessages: null,
  unsubCustomEvents: null,

  // In-memory data store
  votesMap: {},
  notesMap: {},
  dismissedMatches: new Set(), // event ids removed from the Matches page
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

    // Ensure session persistence is explicitly LOCAL
    try {
      this.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
    } catch (e) {}

    // Enable offline persistence if supported (safe non-blocking)
    try {
      this.db.enablePersistence().catch(() => {});
    } catch (e) {}

    // Restore cached session identity immediately so UI is 0ms responsive
    const hasSession = (window.authUI && authUI.hasDeviceSession) ? authUI.hasDeviceSession() : (localStorage.getItem('twodo_session_active') === '1');
    const cachedUid = localStorage.getItem('twodo_user_uid');
    const cachedProfile = localStorage.getItem('twodo_user_profile');

    if (hasSession && cachedProfile) {
      try {
        this.userProfile = JSON.parse(cachedProfile);
        this.pairCode = this.userProfile?.pair_code;
        if (this.userProfile?.couple_id) {
          this.isSolo = false;
          this.coupleId = this.userProfile.couple_id;
          this.attachListeners(this.coupleId);
        } else if (cachedUid) {
          this.isSolo = true;
          this.coupleId = null;
          this.attachSoloListeners(cachedUid);
        }
      } catch (e) {}
    }

    // Listen for authentication state changes
    this.auth.onAuthStateChanged(async (user) => {
      if (user) {
        this.currentUser = user;
        await this.handleUserSignedIn(user);
      } else {
        const stillActive = (window.authUI && authUI.hasDeviceSession) ? authUI.hasDeviceSession() : (localStorage.getItem('twodo_session_active') === '1');
        if (stillActive) {
          // Silent background re-auth for mobile WebKit restarts
          let cachedAuth = null;
          try {
            const raw = localStorage.getItem('twodo_auth_cache');
            if (raw) cachedAuth = JSON.parse(atob(raw));
          } catch (e) {}

          if (cachedAuth && cachedAuth.e && cachedAuth.p) {
            this.auth.signInWithEmailAndPassword(cachedAuth.e, cachedAuth.p)
              .then(cred => this.handleUserSignedIn(cred.user))
              .catch(err => console.warn('Background re-auth note (keeping offline space):', err));
          }
        } else {
          this.handleUserSignedOut();
        }
      }
    });
  },

  generatePairCode(name = '') {
    const letters = (name || '').replace(/[^a-zA-Z]/g, '').slice(0, 2).toUpperCase() || 'TD';
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `${letters}-${rand}`;
  },

  // ---------------------------------------------------------------------------
  // AUTHENTICATION: LOGIN & REGISTER
  // ---------------------------------------------------------------------------
  async login(email, password) {
    try {
      try {
        await this.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      } catch (e) {}

      const cleanEmail = email.trim().toLowerCase();
      const cred = await this.auth.signInWithEmailAndPassword(cleanEmail, password);
      this.currentUser = cred.user;

      if (window.authUI && authUI.setDeviceSession) {
        authUI.setDeviceSession(cred.user.uid, cleanEmail, password);
      }

      // Optimistically reveal app immediately so user never waits on spinner
      if (window.authUI && authUI.showApp) {
        authUI.showApp();
      }

      // Restore cached profile immediately for instant UI response
      const cached = localStorage.getItem('twodo_user_profile');
      if (cached) {
        try {
          this.userProfile = JSON.parse(cached);
          if (this.userProfile.couple_id) {
            this.isSolo = false;
            this.coupleId = this.userProfile.couple_id;
          }
        } catch (e) {}
      }

      // Sync Firestore user profile & listeners in background
      this.handleUserSignedIn(cred.user).catch(err => console.warn('Background login sync note:', err));

      return { success: true, user: cred.user };
    } catch (err) {
      return { success: false, error: this.formatAuthError(err) };
    }
  },

  async register(email, password, name, defaultCity = 'Brisbane', partnerCode = null) {
    try {
      const cleanName = (name || '').trim() || 'Explorer';
      const city = (defaultCity || '').trim() || 'Brisbane';
      const cleanEmail = email.trim().toLowerCase();

      // Persist chosen name immediately so concurrent onAuthStateChanged has it
      localStorage.setItem('twodo_pending_name', cleanName);
      localStorage.setItem('twodo_user_name', cleanName);
      localStorage.setItem('twodo_profile', JSON.stringify({
        user1_name: cleanName,
        user2_name: 'Partner',
        default_city: city
      }));

      try {
        await this.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      } catch (e) {}

      // Create individual Firebase Auth user
      const cred = await this.auth.createUserWithEmailAndPassword(cleanEmail, password);
      const uid = cred.user.uid;
      this.currentUser = cred.user;

      if (window.authUI && authUI.setDeviceSession) {
        authUI.setDeviceSession(uid, cleanEmail, password);
      }

      // Generate unique pairing code
      const pairCode = this.generatePairCode(cleanName);
      this.pairCode = pairCode;

      // Individual user document
      const userDoc = {
        uid: uid,
        name: cleanName,
        email: cleanEmail,
        city: city,
        pair_code: pairCode,
        status: 'single',
        couple_id: null,
        partner_uid: null,
        partner_name: null,
        created_at: new Date().toISOString()
      };
      this.userProfile = userDoc;
      localStorage.setItem('twodo_user_profile', JSON.stringify(userDoc));

      // Save user doc & pair code index to Firestore (non-blocking in background)
      this.db.collection('users').doc(uid).set(userDoc).catch(e => console.warn('User doc save note:', e));
      this.db.collection('pair_codes').doc(pairCode).set({
        code: pairCode,
        user_uid: uid,
        user_name: cleanName,
        created_at: new Date().toISOString()
      }).catch(e => console.warn('Pair code index save note:', e));

      if (window.authUI && authUI.setDeviceSession) {
        authUI.setDeviceSession(uid, cleanEmail, password);
      }

      // Default to Solo Mode
      this.isSolo = true;
      this.coupleId = null;
      this.profile = {
        user1_name: cleanName,
        user2_name: 'Partner',
        default_city: city
      };
      localStorage.setItem('twodo_profile', JSON.stringify(this.profile));
      this.attachSoloListeners(uid);

      // If user supplied a partner invite code during registration, link immediately!
      if (partnerCode && partnerCode.trim()) {
        const pairRes = await this.pairWithPartner(partnerCode.trim());
        if (!pairRes.success) {
          console.warn('Initial partner pairing notice:', pairRes.error);
        }
      }

      // Update global UI state
      if (window.app) {
        app.profile = this.profile;
        app.currentCity = city;
        app.updateProfileUI();
        if (window.discover && discover.loadEvents) discover.loadEvents(true);
        if (window.planner && planner.loadPlanner) planner.loadPlanner();
      }

      if (window.authUI) {
        authUI.updatePairCodeUI(this.pairCode);
        authUI.updateSettingsAccountUI(cleanEmail, this.profile, this.isSolo, this.userProfile?.partner_name);
      }

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
    if (code.includes('user-not-found')) return 'No account found with this email.';
    if (code.includes('wrong-password') || code.includes('invalid-credential')) return 'Incorrect email or password.';
    if (code.includes('email-already-in-use')) return 'This email is already registered. Try signing in.';
    if (code.includes('weak-password')) return 'Password should be at least 6 characters.';
    return err.message || 'Authentication error. Please try again.';
  },

  // ---------------------------------------------------------------------------
  // PARTNER PAIRING ENGINE (CONNECTING SPACES VIA CODE)
  // ---------------------------------------------------------------------------
  async pairWithPartner(inputCode) {
    if (!this.currentUser) return { success: false, error: 'Please log in to link accounts.' };

    const cleanCode = (inputCode || '').trim().toUpperCase();
    if (!cleanCode) return { success: false, error: 'Please enter a valid invite code.' };

    try {
      // 1. Look up code in pair_codes index
      const codeSnap = await this.db.collection('pair_codes').doc(cleanCode).get();
      if (!codeSnap.exists) {
        return { success: false, error: `Invite code "${cleanCode}" was not found. Please verify with your partner!` };
      }

      const pairData = codeSnap.data();
      const partnerUid = pairData.user_uid;
      const partnerName = pairData.user_name || 'Partner';
      const myUid = this.currentUser.uid;
      const myName = this.userProfile?.name || app.profile?.user1_name || 'Partner 1';

      if (partnerUid === myUid) {
        return { success: false, error: "That's your own invite code! Send it to your partner to enter on their phone." };
      }

      // 2. Check if partner is already coupled with someone else
      try {
        const partnerUserSnap = await this.db.collection('users').doc(partnerUid).get();
        if (partnerUserSnap.exists) {
          const pUserData = partnerUserSnap.data();
          if (pUserData.couple_id && pUserData.couple_id !== this.coupleId) {
            return { success: false, error: `${partnerName} is already linked with another partner.` };
          }
        }
      } catch (e) {}

      // 3. Create or establish canonical couple ID (deterministic sort avoids duplicates)
      const canonicalCoupleId = 'couple_' + [myUid, partnerUid].sort().join('_');
      const coupleDoc = {
        couple_id: canonicalCoupleId,
        user1_uid: myUid,
        user1_name: myName,
        user2_uid: partnerUid,
        user2_name: partnerName,
        default_city: this.userProfile?.city || 'Brisbane',
        paired_at: new Date().toISOString()
      };

      await this.db.collection('couples').doc(canonicalCoupleId).set(coupleDoc, { merge: true });

      // 4. Update both user records to "coupled" status
      await this.db.collection('users').doc(myUid).set({
        status: 'coupled',
        couple_id: canonicalCoupleId,
        partner_uid: partnerUid,
        partner_name: partnerName
      }, { merge: true });

      await this.db.collection('users').doc(partnerUid).set({
        status: 'coupled',
        couple_id: canonicalCoupleId,
        partner_uid: myUid,
        partner_name: myName
      }, { merge: true });

      // 5. Merge existing solo votes from both users into the shared couple space!
      try {
        const mySoloVotes = await this.db.collection('users').doc(myUid).collection('votes').get();
        mySoloVotes.forEach(doc => {
          this.db.collection('couples').doc(canonicalCoupleId).collection('votes').doc(doc.id).set({
            event_id: doc.id,
            votes: { [myName]: doc.data().vote },
            notes: { [myName]: doc.data().note || '' },
            updated_at: firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        });
      } catch (e) {}

      // 6. Switch to Coupled Mode
      this.isSolo = false;
      this.coupleId = canonicalCoupleId;
      if (this.userProfile) {
        this.userProfile.status = 'coupled';
        this.userProfile.couple_id = canonicalCoupleId;
        this.userProfile.partner_uid = partnerUid;
        this.userProfile.partner_name = partnerName;
      }
      this.profile = {
        user1_name: myName,
        user2_name: partnerName,
        default_city: coupleDoc.default_city
      };

      localStorage.setItem('twodo_user_profile', JSON.stringify(this.userProfile));
      localStorage.setItem('twodo_profile', JSON.stringify(this.profile));

      this.detachListeners();
      this.attachListeners(canonicalCoupleId);

      // Add welcoming chat message
      this.db.collection('couples').doc(canonicalCoupleId).collection('messages').add({
        sender_name: myName,
        text: `Hey ${partnerName}! 💕 We're officially linked on TwoDo! Let's find some date ideas!`,
        activity_id: null,
        created_at: firebase.firestore.FieldValue.serverTimestamp()
      }).catch(() => {});

      if (window.app) {
        app.profile = this.profile;
        app.updateProfileUI();
        if (window.discover && discover.loadEvents) discover.loadEvents(true);
        if (window.planner && planner.loadPlanner) planner.loadPlanner();
      }

      if (window.authUI) {
        authUI.updatePairCodeUI(this.pairCode);
        authUI.updateSettingsAccountUI(this.currentUser.email, this.profile, false, partnerName);
      }

      return { success: true, partnerName };
    } catch (err) {
      console.error('Pairing error:', err);
      return { success: false, error: err.message || 'Could not link accounts. Check connection.' };
    }
  },

  async unpairPartner() {
    if (!this.currentUser || !this.userProfile) return { success: false };
    const myUid = this.currentUser.uid;
    const partnerUid = this.userProfile.partner_uid;

    try {
      await this.db.collection('users').doc(myUid).set({
        status: 'single',
        couple_id: null,
        partner_uid: null,
        partner_name: null
      }, { merge: true });

      if (partnerUid) {
        await this.db.collection('users').doc(partnerUid).set({
          status: 'single',
          couple_id: null,
          partner_uid: null,
          partner_name: null
        }, { merge: true });
      }

      this.isSolo = true;
      this.coupleId = null;
      this.userProfile.status = 'single';
      this.userProfile.couple_id = null;
      this.userProfile.partner_uid = null;
      this.userProfile.partner_name = null;
      this.profile = {
        user1_name: this.userProfile.name || 'You',
        user2_name: 'Partner',
        default_city: this.userProfile.city || 'Brisbane'
      };

      localStorage.setItem('twodo_user_profile', JSON.stringify(this.userProfile));
      localStorage.setItem('twodo_profile', JSON.stringify(this.profile));

      this.detachListeners();
      this.attachSoloListeners(myUid);

      if (window.app) {
        app.profile = this.profile;
        app.updateProfileUI();
        if (window.discover && discover.loadEvents) discover.loadEvents(true);
      }

      if (window.authUI) {
        authUI.updatePairCodeUI(this.pairCode);
        authUI.updateSettingsAccountUI(this.currentUser.email, this.profile, true, null);
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  // ---------------------------------------------------------------------------
  // AUTH STATE HANDLERS
  // ---------------------------------------------------------------------------
  _syncingUid: null,
  async handleUserSignedIn(user) {
    if (!user) return;
    if (this._syncingUid === user.uid) {
      return;
    }
    this._syncingUid = user.uid;

    try {
      console.log('User signed in:', user.email, 'UID:', user.uid);
      this.currentUser = user;
      const uid = user.uid;

      if (window.authUI && authUI.setDeviceSession) {
        authUI.setDeviceSession(uid, user.email);
      }

      // Check cached user profile first for instant 0ms render
      let userDoc = null;
      try {
        const cached = localStorage.getItem('twodo_user_profile');
        if (cached) userDoc = JSON.parse(cached);
      } catch (e) {}

      if (userDoc && userDoc.uid === uid) {
        this.userProfile = userDoc;
        this.pairCode = userDoc.pair_code;
        if (userDoc.couple_id) {
          this.isSolo = false;
          this.coupleId = userDoc.couple_id;
        } else {
          this.isSolo = true;
          this.coupleId = null;
        }
      }

      // 1. Fetch individual user record from Firestore / cache
      try {
        const uDocSnap = await this.db.collection('users').doc(uid).get();
        if (uDocSnap.exists) {
          userDoc = uDocSnap.data();
        }
      } catch (e) {
        console.warn('User doc fetch note:', e);
      }

      const pendingName = localStorage.getItem('twodo_pending_name') || localStorage.getItem('twodo_user_name');

      if (!userDoc) {
        const resolvedName = pendingName || (user.email || '').split('@')[0] || 'Explorer';
        const code = this.generatePairCode(resolvedName);
        userDoc = {
          uid: uid,
          name: resolvedName,
          email: user.email,
          city: 'Brisbane',
          pair_code: code,
          status: 'single',
          couple_id: null,
          partner_uid: null,
          partner_name: null,
          created_at: new Date().toISOString()
        };
        this.db.collection('users').doc(uid).set(userDoc).catch(() => {});
        this.db.collection('pair_codes').doc(code).set({ code, user_uid: uid, user_name: resolvedName }).catch(() => {});
      } else if (pendingName && userDoc.name !== pendingName) {
        userDoc.name = pendingName;
        this.db.collection('users').doc(uid).set({ name: pendingName }, { merge: true }).catch(() => {});
        if (userDoc.pair_code) {
          this.db.collection('pair_codes').doc(userDoc.pair_code).set({ user_name: pendingName }, { merge: true }).catch(() => {});
        }
      }

      this.userProfile = userDoc;
      this.pairCode = userDoc.pair_code;
      localStorage.setItem('twodo_user_profile', JSON.stringify(userDoc));

      // 2. Check if coupled or solo
      if (userDoc.couple_id) {
        // COUPLED MODE
        this.isSolo = false;
        this.coupleId = userDoc.couple_id;

        try {
          const cSnap = await this.db.collection('couples').doc(userDoc.couple_id).get();
          if (cSnap.exists) {
            const cData = cSnap.data();
            this.profile = {
              user1_name: cData.user1_name || 'Emma',
              user2_name: cData.user2_name || 'Jordan',
              default_city: cData.default_city || userDoc.city || 'Brisbane'
            };
            localStorage.setItem('twodo_profile', JSON.stringify(this.profile));
          }
        } catch (e) {
          console.warn('Couple doc fetch note:', e);
        }

        if (!this.profile) {
          this.profile = {
            user1_name: userDoc.name || 'Partner 1',
            user2_name: userDoc.partner_name || 'Partner 2',
            default_city: userDoc.city || 'Brisbane'
          };
        }

        this.attachListeners(this.coupleId);
      } else {
        // SOLO MODE
        this.isSolo = true;
        this.coupleId = null;
        this.profile = {
          user1_name: userDoc.name || 'You',
          user2_name: 'Partner',
          default_city: userDoc.city || 'Brisbane'
        };
        localStorage.setItem('twodo_profile', JSON.stringify(this.profile));
        this.attachSoloListeners(uid);
      }

      // 3. Update Global UI & App State
      if (window.app) {
        app.profile = this.profile;
        app.currentCity = this.profile.default_city || 'Brisbane';
        app.updateProfileUI();
        if (window.discover && discover.loadEvents) discover.loadEvents(false);
        if (window.planner && planner.loadPlanner) planner.loadPlanner();
      }

      if (window.authUI) {
        authUI.showApp();
        authUI.updatePairCodeUI(this.pairCode);
        authUI.updateSettingsAccountUI(user.email, this.profile, this.isSolo, userDoc.partner_name);
      }
    } finally {
      this._syncingUid = null;
    }
  },

  handleUserSignedOut() {
    const hasSession = (window.authUI && authUI.hasDeviceSession) ? authUI.hasDeviceSession() : (localStorage.getItem('twodo_session_active') === '1');
    if (hasSession) {
      console.log('User signed out event ignored: device session is active.');
      return;
    }

    console.log('User signed out');
    this.currentUser = null;
    this.userProfile = null;
    this.coupleId = null;
    this.profile = null;
    this.pairCode = null;
    this.isSolo = true;
    this.detachListeners();

    // Reset in-memory data
    this.votesMap = {};
    this.notesMap = {};
    this.plannerItems = [];
    this.messages = [];
    this.customEvents = [];

    if (window.authUI && authUI.showAuthScreen) {
      authUI.showAuthScreen();
    }
  },

  // ---------------------------------------------------------------------------
  // REAL-TIME FIRESTORE LISTENERS
  // ---------------------------------------------------------------------------
  attachListeners(coupleId) {
    this.detachListeners();
    if (!coupleId) return;

    const coupleRef = this.db.collection('couples').doc(coupleId);

    // 1. Live Votes & Notes Listener
    this.unsubVotes = coupleRef.collection('votes').onSnapshot((snapshot) => {
      const newVotes = {};
      const newNotes = {};
      const dismissed = new Set();

      snapshot.forEach((doc) => {
        const data = doc.data();
        const ids = Array.from(new Set([doc.id, data.event_id].filter(Boolean)));
        const put = (map, userName, val) => ids.forEach(id => { map[`${id}_${userName}`] = val; });

        if (data.votes) {
          Object.keys(data.votes).forEach((userName) => put(newVotes, userName, data.votes[userName]));
        }
        if (data.notes) {
          Object.keys(data.notes).forEach((userName) => put(newNotes, userName, data.notes[userName]));
        }
        // Legacy docs saved with literal "votes.Name" / "notes.Name" field names
        Object.keys(data).forEach((key) => {
          if (key.startsWith('votes.')) put(newVotes, key.slice(6), data[key]);
          else if (key.startsWith('notes.')) put(newNotes, key.slice(6), data[key]);
        });
        if (data.match_dismissed) ids.forEach(id => dismissed.add(id));
      });

      this.votesMap = newVotes;
      this.notesMap = newNotes;
      this.dismissedMatches = dismissed;

      try {
        localStorage.setItem('twodo_votes', JSON.stringify(newVotes));
        localStorage.setItem('twodo_notes', JSON.stringify(newNotes));
        localStorage.setItem('twodo_dismissed_matches', JSON.stringify(Array.from(dismissed)));
      } catch (e) {}

      if (window.discover && discover.refreshWithLatestVotes) {
        discover.refreshWithLatestVotes();
      }
      if (window.matchesView) matchesView.refresh();
    }, (err) => console.warn('Votes listener note:', err));

    // 2. Live Planner Listener
    this.unsubPlanner = coupleRef.collection('planner').onSnapshot((snapshot) => {
      const items = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        items.push({
          id: doc.id,
          event_id: data.event_id,
          status: data.status || 'bucket_list',
          scheduled_date: data.scheduled_date || null,
          scheduled_time: data.scheduled_time || null,
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
      try { localStorage.setItem('twodo_planner', JSON.stringify(items)); } catch (e) {}
      if (window.planner) {
        planner.items = items;
        planner.renderPlanner();
        planner.updateBadges();
      }
    }, (err) => console.warn('Planner listener note:', err));

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
      }, (err) => console.warn('Messages listener note:', err));

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
    }, (err) => console.warn('Custom events error:', err));

    // Ensure any offline local votes or planner items are backed up to cloud
    if (this.currentUser) {
      this.syncLocalDataToCloud(this.currentUser.uid);
    }
  },

  attachSoloListeners(uid) {
    this.detachListeners();
    if (!uid) return;

    // 1. Live Solo Votes Listener (Cloud Firestore -> Local Storage & Memory)
    this.unsubVotes = this.db.collection('users').doc(uid).collection('votes').onSnapshot((snapshot) => {
      const myName = this.userProfile?.name || 'You';
      const u1Name = this.profile?.user1_name || myName;
      const newVotes = {};
      const newNotes = {};
      const dismissed = new Set();

      snapshot.forEach(doc => {
        const d = doc.data();
        const evId = d.event_id || doc.id;
        const vote = d.vote;
        const note = d.note || '';
        if (d.match_dismissed) { dismissed.add(doc.id); dismissed.add(evId); }
        if (!vote) return;

        // Store under canonical ID and safeDocId with all voter aliases
        newVotes[`${doc.id}_${myName}`] = vote;
        newVotes[`${evId}_${myName}`] = vote;
        newVotes[`${doc.id}_${u1Name}`] = vote;
        newVotes[`${evId}_${u1Name}`] = vote;
        newVotes[`${doc.id}_You`] = vote;
        newVotes[`${evId}_You`] = vote;

        if (note) {
          newNotes[`${doc.id}_${myName}`] = note;
          newNotes[`${evId}_${myName}`] = note;
        }
      });

      this.votesMap = { ...this.votesMap, ...newVotes };
      this.notesMap = { ...this.notesMap, ...newNotes };
      this.dismissedMatches = dismissed;

      // Safe permanent write to LocalStorage
      try {
        localStorage.setItem('twodo_dismissed_matches', JSON.stringify(Array.from(dismissed)));
        let existingVotes = {};
        try { existingVotes = JSON.parse(localStorage.getItem('twodo_votes') || '{}'); } catch (e) {}
        localStorage.setItem('twodo_votes', JSON.stringify({ ...existingVotes, ...newVotes }));

        let existingNotes = {};
        try { existingNotes = JSON.parse(localStorage.getItem('twodo_notes') || '{}'); } catch (e) {}
        localStorage.setItem('twodo_notes', JSON.stringify({ ...existingNotes, ...newNotes }));
      } catch (e) {}

      if (window.discover && discover.refreshWithLatestVotes) {
        discover.refreshWithLatestVotes();
      }
      if (window.matchesView) matchesView.refresh();
    }, err => console.warn('Solo votes listener note:', err));

    // 2. Live Solo Planner Listener (Cloud Firestore -> Local Storage & Memory)
    this.unsubPlanner = this.db.collection('users').doc(uid).collection('planner').onSnapshot((snapshot) => {
      const items = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        items.push({
          id: doc.id,
          event_id: data.event_id,
          status: data.status || 'bucket_list',
          scheduled_date: data.scheduled_date || null,
          scheduled_time: data.scheduled_time || null,
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
          created_at: data.created_at ? (data.created_at.toDate?.()?.toISOString?.() || new Date().toISOString()) : new Date().toISOString()
        });
      });

      this.plannerItems = items;
      try {
        localStorage.setItem('twodo_planner', JSON.stringify(items));
      } catch (e) {}

      if (window.planner) {
        planner.items = items;
        planner.renderPlanner();
        if (planner.updateBadges) planner.updateBadges();
        if (planner.updateBadges) planner.updateBadges();
      }
    }, err => console.warn('Solo planner listener note:', err));

    // 3. Automatically sync any unsynced local data to Cloud Firestore in background
    this.syncLocalDataToCloud(uid);
  },

  async syncLocalDataToCloud(uid) {
    if (!uid || !this.db) return;
    try {
      // 1. Sync any local votes to Firestore
      let localVotes = {};
      let localNotes = {};
      try {
        localVotes = JSON.parse(localStorage.getItem('twodo_votes') || '{}');
        localNotes = JSON.parse(localStorage.getItem('twodo_notes') || '{}');
      } catch (e) {}

      const myName = this.userProfile?.name || 'You';
      const isSolo = this.isSolo;
      const coupleId = this.coupleId;

      for (const key of Object.keys(localVotes)) {
        const parts = key.split('_');
        const eventId = parts.slice(0, -1).join('_');
        const voterName = parts[parts.length - 1];
        const vote = localVotes[key];
        const note = localNotes[key] || '';

        if (!eventId || !vote) continue;
        const safeDocId = String(eventId).replace(/[\/\.]/g, '_');

        if (isSolo) {
          this.db.collection('users').doc(uid).collection('votes').doc(safeDocId).set({
            event_id: eventId,
            vote: vote,
            note: note,
            updated_at: firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true }).catch(() => {});
        } else if (coupleId) {
          this.db.collection('couples').doc(coupleId).collection('votes').doc(safeDocId).set({
            event_id: eventId,
            votes: { [voterName]: vote },
            notes: { [voterName]: note },
            updated_at: firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true }).catch(() => {});
        }
      }

      // 2. Sync any local planner items to Firestore
      let localPlanner = [];
      try {
        localPlanner = JSON.parse(localStorage.getItem('twodo_planner') || '[]');
      } catch (e) {}

      for (const item of localPlanner) {
        if (!item || !item.event_id) continue;
        const targetColl = coupleId 
          ? this.db.collection('couples').doc(coupleId).collection('planner')
          : this.db.collection('users').doc(uid).collection('planner');
        const planDocId = String(item.id || item.event_id);
        targetColl.doc(planDocId).set({
          event_id: item.event_id,
          title: item.title || 'Date Activity',
          status: item.status || 'bucket_list',
          scheduled_date: item.scheduled_date || null,
          scheduled_time: item.scheduled_time || null,
          time_slot: item.time_slot || 'evening',
          notes: item.notes || '',
          budget: item.budget || '',
          category: item.category || '',
          location_name: item.location_name || '',
          image_url: item.image_url || '',
          updated_at: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).catch(() => {});
      }
    } catch (e) {
      console.warn('Local data to cloud backup note:', e);
    }
  },

  detachListeners() {
    if (this.unsubVotes) { this.unsubVotes(); this.unsubVotes = null; }
    if (this.unsubPlanner) { this.unsubPlanner(); this.unsubPlanner = null; }
    if (this.unsubMessages) { this.unsubMessages(); this.unsubMessages = null; }
    if (this.unsubCustomEvents) { this.unsubCustomEvents(); this.unsubCustomEvents = null; }
  },

  // ---------------------------------------------------------------------------
  // DATA MUTATIONS (VOTES, PLANNER, CHAT, CUSTOM EVENTS)
  // ---------------------------------------------------------------------------
  async saveVote(eventId, userName, voteType, note = null) {
    if (!eventId || !userName) return { success: true };

    // 1. Immediately cache in local memory
    this.votesMap[`${eventId}_${userName}`] = voteType;
    if (note !== null) {
      this.notesMap[`${eventId}_${userName}`] = note;
    }

    const safeDocId = String(eventId).replace(/[\/\.]/g, '_');

    // 2. If Coupled: save to couples/{coupleId}/votes/{safeDocId}
    if (this.coupleId) {
      const docRef = this.db.collection('couples').doc(this.coupleId).collection('votes').doc(safeDocId);
      // NOTE: set() treats "votes.Name" as a literal field name, so use nested maps
      // with merge:true — this deep-merges each partner's vote without overwriting the other's.
      const updatePayload = {
        event_id: eventId,
        votes: { [userName]: voteType },
        updated_at: firebase.firestore.FieldValue.serverTimestamp()
      };
      if (note !== null) {
        updatePayload.notes = { [userName]: note };
      }
      try {
        await docRef.set(updatePayload, { merge: true });
      } catch (e) {
        console.warn('Firestore couple vote sync note:', e);
      }
      return { success: true };
    }

    // 3. If Solo: save to users/{myUid}/votes/{safeDocId}
    if (this.currentUser) {
      const docRef = this.db.collection('users').doc(this.currentUser.uid).collection('votes').doc(safeDocId);
      try {
        await docRef.set({
          event_id: eventId,
          vote: voteType,
          note: note || '',
          updated_at: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } catch (e) {
        console.warn('Firestore solo vote sync note:', e);
      }
    }

    return { success: true };
  },

  async savePlannerItem(item) {
    const targetColl = this.coupleId 
      ? this.db.collection('couples').doc(this.coupleId).collection('planner')
      : (this.currentUser ? this.db.collection('users').doc(this.currentUser.uid).collection('planner') : null);

    if (!targetColl) return { success: true };

    const payload = {
      event_id: item.event_id,
      title: item.title,
      scheduled_date: item.scheduled_date || null,
      scheduled_time: item.scheduled_time || null,
      time_slot: item.time_slot || 'evening',
      notes: item.notes || '',
      budget: item.budget || 0,
      reservation_info: item.reservation_info || '',
      category: item.category || '',
      location_name: item.location_name || '',
      city: item.city || 'Brisbane',
      image_url: item.image_url || '',
      price_str: item.price_str || '',
      status: item.status || 'scheduled',
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    };

    const idStr = item.id != null ? String(item.id) : '';
    if (idStr && !idStr.startsWith('temp_')) {
      await targetColl.doc(idStr).set(payload, { merge: true });
      return { success: true, id: idStr };
    } else {
      payload.created_at = firebase.firestore.FieldValue.serverTimestamp();
      const ref = await targetColl.add(payload);
      return { success: true, id: ref.id };
    }
  },

  // Aliases used by the planner module
  async addPlannerItem(item) {
    return this.savePlannerItem(item);
  },

  async updatePlannerItem(id, changes) {
    const targetColl = this.coupleId
      ? this.db.collection('couples').doc(this.coupleId).collection('planner')
      : (this.currentUser ? this.db.collection('users').doc(this.currentUser.uid).collection('planner') : null);
    if (!targetColl || id == null) return { success: true };
    await targetColl.doc(String(id)).set({
      ...changes,
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return { success: true };
  },

  // Hide / restore an event on the Matches page (synced to your partner)
  async setMatchDismissed(eventId, dismissed = true) {
    if (!eventId) return { success: true };
    if (!this.dismissedMatches) this.dismissedMatches = new Set();
    if (dismissed) this.dismissedMatches.add(eventId); else this.dismissedMatches.delete(eventId);
    try {
      localStorage.setItem('twodo_dismissed_matches', JSON.stringify(Array.from(this.dismissedMatches)));
    } catch (e) {}

    const safeDocId = String(eventId).replace(/[\/\.]/g, '_');
    const coll = this.coupleId
      ? this.db.collection('couples').doc(this.coupleId).collection('votes')
      : (this.currentUser ? this.db.collection('users').doc(this.currentUser.uid).collection('votes') : null);
    if (!coll) return { success: true };
    try {
      await coll.doc(safeDocId).set({ event_id: eventId, match_dismissed: dismissed }, { merge: true });
    } catch (e) {
      console.warn('Match dismiss sync note:', e);
    }
    return { success: true };
  },

  async deletePlannerItem(id) {
    const targetColl = this.coupleId 
      ? this.db.collection('couples').doc(this.coupleId).collection('planner')
      : (this.currentUser ? this.db.collection('users').doc(this.currentUser.uid).collection('planner') : null);

    if (!targetColl || !id) return { success: true };
    await targetColl.doc(String(id)).delete();
    return { success: true };
  },

  async updatePlannerItemStatus(id, newStatus) {
    const targetColl = this.coupleId 
      ? this.db.collection('couples').doc(this.coupleId).collection('planner')
      : (this.currentUser ? this.db.collection('users').doc(this.currentUser.uid).collection('planner') : null);

    if (!targetColl || !id) return { success: true };
    await targetColl.doc(String(id)).update({
      status: newStatus,
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    });
    return { success: true };
  },

  async sendMessage(text, senderName, activity = null) {
    if (!this.coupleId) return { success: false, error: 'Link with a partner to send messages!' };

    const msgData = {
      text: text.trim(),
      sender_name: senderName || 'Partner',
      activity_id: activity?.id || null,
      activity_title: activity?.title || null,
      activity_image: activity?.image_url || null,
      created_at: firebase.firestore.FieldValue.serverTimestamp()
    };

    const docRef = await this.db.collection('couples').doc(this.coupleId).collection('messages').add(msgData);
    return { success: true, id: docRef.id };
  },

  async addCustomActivity(data) {
    const targetColl = this.coupleId
      ? this.db.collection('couples').doc(this.coupleId).collection('custom_events')
      : (this.currentUser ? this.db.collection('users').doc(this.currentUser.uid).collection('custom_events') : null);

    if (!targetColl) return;

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
      source: `${this.profile?.user1_name || 'My'} Custom Date`,
      image_url: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80',
      tags: ['Custom Date', data.category || 'Activity'],
      is_custom: 1,
      created_at: firebase.firestore.FieldValue.serverTimestamp()
    };

    await targetColl.doc(slug).set(docData);
    return { success: true, event: docData };
  },

  async updateCoupleProfile(profileData) {
    if (this.coupleId) {
      await this.db.collection('couples').doc(this.coupleId).set(profileData, { merge: true });
    }
    this.profile = { ...this.profile, ...profileData };
    return { success: true, profile: this.profile };
  },

  async updateSoloProfile(data) {
    if (!this.currentUser) return { success: true };
    const uid = this.currentUser.uid;
    const updates = {};
    if (data.name) updates.name = data.name.trim();
    if (data.city) updates.city = data.city.trim();
    try {
      await this.db.collection('users').doc(uid).set(updates, { merge: true });
      if (this.pairCode && data.name) {
        await this.db.collection('pair_codes').doc(this.pairCode).set({ user_name: data.name.trim() }, { merge: true });
      }
    } catch (e) {
      console.warn('Solo profile update note:', e);
    }
    this.userProfile = { ...this.userProfile, ...updates };
    localStorage.setItem('twodo_user_profile', JSON.stringify(this.userProfile));
    return { success: true };
  }
};

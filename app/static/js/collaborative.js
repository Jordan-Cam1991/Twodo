/**
 * Collaborative Couple Logic & Match Engine
 */
const collaborative = {
  currentMatchEvent: null,

  async handleVote(eventId, voteType, note = null, fromSwiper = false) {
    const isTogether = app.currentVoter === 'both';
    const u1 = app.profile?.user1_name || 'Emma';
    const u2 = app.profile?.user2_name || 'Jordan';
    const activeVoter = app.getActiveVoterName();
    const pool = (typeof discover !== 'undefined' && discover.getAllEventsPool) ? discover.getAllEventsPool() : [];
    const event = (app.events || []).find(e => e.id === eventId) || pool.find(e => e.id === eventId);

    // 1. OPTIMISTIC IMMEDIATE UPDATE (Instant 0ms UI response!)
    if (event) {
      if (isTogether) {
        event.u1_vote = voteType;
        event.u2_vote = voteType;
        if (note !== null) {
          event.u1_note = note;
          event.u2_note = note;
        }
      } else if (activeVoter === u1) {
        event.u1_vote = voteType;
        if (note !== null) event.u1_note = note;
      } else {
        event.u2_vote = voteType;
        if (note !== null) event.u2_note = note;
      }

      // STRICT MATCH RULE: Only double love (both partners voted 'love') is a match!
      const isStrictMatch = Boolean(event.u1_vote === 'love' && event.u2_vote === 'love');
      event.is_match = isStrictMatch;
      event.match_level = isStrictMatch ? 'double_love' : 'none';

      // Celebrate ONLY if both loved and action was love
      if (isStrictMatch && voteType === 'love') {
        this.triggerMatchCelebration(event);
      } else {
        app.showToast(voteType === 'love' ? (note ? '💬 Note & ❤️ Love saved!' : '❤️ Saved to Loves!') : (voteType === 'maybe' ? '🤔 Noted as maybe' : '❌ Passed'));
      }
    }

    // 2. PERSIST TO LOCAL STORAGE
    try {
      if (isTogether) {
        await api.vote(eventId, u1, voteType, note);
        await api.vote(eventId, u2, voteType, note);
      } else {
        await api.vote(eventId, activeVoter, voteType, note);
      }
    } catch (e) {
      console.warn('Local storage vote note:', e);
    }

    // 3. UPDATE FIREBASE IN-MEMORY CACHE
    if (typeof firebaseService !== 'undefined') {
      if (isTogether) {
        firebaseService.votesMap[`${eventId}_${u1}`] = voteType;
        firebaseService.votesMap[`${eventId}_${u2}`] = voteType;
        if (note !== null) {
          firebaseService.notesMap[`${eventId}_${u1}`] = note;
          firebaseService.notesMap[`${eventId}_${u2}`] = note;
        }
      } else {
        firebaseService.votesMap[`${eventId}_${activeVoter}`] = voteType;
        if (note !== null) {
          firebaseService.notesMap[`${eventId}_${activeVoter}`] = note;
        }
      }
    }

    // 4. RE-RENDER VIEWS IMMEDIATELY (Instantly updates cards, badge counts, and swiper!)
    discover.renderEvents();
    discover.updateMatchBanner();
    if (window.planner) planner.loadPlanner();
    if (window.swiper && !fromSwiper) swiper.initDeck();
    if (window.mapView) mapView.renderMarkers();

    // 5. ASYNC FIREBASE FIRESTORE SYNC (non-blocking in background)
    if (typeof firebaseService !== 'undefined' && (firebaseService.coupleId || firebaseService.currentUser)) {
      if (isTogether) {
        firebaseService.saveVote(eventId, u1, voteType, note).catch(e => console.warn('Vote sync u1 note:', e));
        firebaseService.saveVote(eventId, u2, voteType, note).catch(e => console.warn('Vote sync u2 note:', e));
      } else {
        firebaseService.saveVote(eventId, activeVoter, voteType, note).catch(e => console.warn('Vote sync active note:', e));
      }
    }
  },

  openNoteModal(eventId) {
    const event = app.events.find(e => e.id === eventId);
    if (!event) return;
    const voter = app.getActiveVoterName();
    const isU1 = voter === (app.profile?.user1_name || 'Emma');
    const existingNote = isU1 ? (event.u1_note || '') : (event.u2_note || '');
    const partner = isU1 ? (app.profile?.user2_name || 'Jordan') : (app.profile?.user1_name || 'Emma');

    const modal = document.getElementById('love-note-modal');
    if (!modal) return;

    document.getElementById('love-note-event-id').value = eventId;
    document.getElementById('love-note-title').textContent = event.title;
    document.getElementById('love-note-sender').textContent = voter;
    document.getElementById('love-note-partner').textContent = partner;
    
    const textarea = document.getElementById('love-note-text');
    if (textarea) {
      textarea.value = existingNote;
      textarea.placeholder = `Tell ${partner} why you love this date idea... (e.g. "Their matcha croissants look unreal!" or "Let's do this Saturday!")`;
    }

    modal.classList.remove('hidden');
    setTimeout(() => textarea?.focus(), 100);
  },

  async saveLoveNote() {
    const eventId = document.getElementById('love-note-event-id').value;
    const text = document.getElementById('love-note-text').value.trim();
    this.closeLoveNoteModal();
    if (!eventId) return;

    await this.handleVote(eventId, 'love', text);
    app.showToast('💬 Love note saved for your partner!');
  },

  closeLoveNoteModal() {
    document.getElementById('love-note-modal')?.classList.add('hidden');
  },

  triggerMatchCelebration(event) {
    this.currentMatchEvent = event;
    const modal = document.getElementById('match-modal');
    const partnerName = document.getElementById('match-partner-name');
    const preview = document.getElementById('match-preview-card');

    if (partnerName) {
      if (app.currentVoter === 'both') {
        partnerName.textContent = `${app.profile?.user1_name || 'Emma'} and ${app.profile?.user2_name || 'Jordan'}`;
      } else {
        const other = app.getActiveVoterName() === app.profile.user1_name 
          ? (app.profile.user2_name || 'Jordan')
          : (app.profile.user1_name || 'Emma');
        partnerName.textContent = other;
      }
    }

    if (preview && event) {
      preview.innerHTML = `
        <div style="display:flex; gap:12px; align-items:center;">
          <img src="${event.image_url}" style="width:70px; height:70px; border-radius:8px; object-fit:cover;">
          <div>
            <div style="font-size:0.75rem; font-weight:700; color:var(--primary); text-transform:uppercase;">${event.category}</div>
            <strong style="font-size:1rem; color:var(--text-main);">${event.title}</strong>
            <div style="font-size:0.8rem; color:var(--text-muted);">${event.location_name} • ${event.price_str || event.price_level}</div>
          </div>
        </div>
      `;
    }

    modal.classList.remove('hidden');
    app.playCelebrationSound();
  },

  closeMatchModal() {
    document.getElementById('match-modal').classList.add('hidden');
    this.currentMatchEvent = null;
  },

  scheduleMatchNow() {
    const ev = this.currentMatchEvent;
    this.closeMatchModal();
    if (ev) {
      planner.openScheduleModal(ev.id, ev.title, ev.planner_id);
    }
  }
};

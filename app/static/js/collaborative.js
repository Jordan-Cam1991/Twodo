/**
 * Collaborative Couple Logic & Match Engine
 */
const collaborative = {
  currentMatchEvent: null,

  async handleVote(eventId, voteType) {
    const isTogether = app.currentVoter === 'both';
    const u1 = app.profile?.user1_name || 'Emma';
    const u2 = app.profile?.user2_name || 'Jordan';
    const activeVoter = app.getActiveVoterName();
    const event = app.events.find(e => e.id === eventId);
    if (!event) return;

    try {
      let res;
      if (isTogether) {
        // Together Mode: record the vote for both partners
        await api.vote(eventId, u1, voteType);
        res = await api.vote(eventId, u2, voteType);
        event.u1_vote = voteType;
        event.u2_vote = voteType;
      } else {
        res = await api.vote(eventId, activeVoter, voteType);
        if (activeVoter === u1) {
          event.u1_vote = voteType;
        } else {
          event.u2_vote = voteType;
        }
      }

      // STRICT MATCH RULE: Only double love (both partners voted 'love') is a match!
      const isStrictMatch = Boolean(event.u1_vote === 'love' && event.u2_vote === 'love');
      event.is_match = isStrictMatch;
      event.match_level = isStrictMatch ? 'double_love' : 'none';

      // Celebrate ONLY if:
      // 1. Both partners loved the event (isStrictMatch is true)
      // 2. The vote action itself was 'love' (NEVER celebrate a maybe or a pass!)
      if (isStrictMatch && voteType === 'love') {
        this.triggerMatchCelebration(event);
      } else {
        app.showToast(voteType === 'love' ? '❤️ Saved to Bucket List!' : (voteType === 'maybe' ? '🤔 Noted as maybe' : 'Passed'));
      }

      // Re-render views
      discover.renderEvents();
      planner.loadPlanner();
      discover.updateMatchBanner();

      return res;
    } catch (e) {
      console.error('Failed to vote:', e);
      app.showToast('Could not save vote. Check connection.');
    }
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

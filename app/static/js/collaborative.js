/**
 * Collaborative Couple Logic & Match Engine
 */
const collaborative = {
  currentMatchEvent: null,

  async handleVote(eventId, voteType) {
    const activeVoter = app.getActiveVoterName();
    const event = app.events.find(e => e.id === eventId);
    if (!event) return;

    // If 'together' mode is active, vote for current primary or both
    try {
      const res = await api.vote(eventId, activeVoter, voteType);
      
      // Update local state
      if (activeVoter === app.profile.user1_name) {
        event.u1_vote = voteType;
      } else {
        event.u2_vote = voteType;
      }

      event.is_match = res.is_match;
      event.match_level = res.match_level;

      // Celebrate if new match!
      if (res.is_match && (voteType === 'love' || voteType === 'maybe')) {
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
      const other = app.getActiveVoterName() === app.profile.user1_name 
        ? app.profile.user2_name 
        : app.profile.user1_name;
      partnerName.textContent = other;
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

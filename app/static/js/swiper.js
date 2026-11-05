/**
 * TwoDo Date Swiper (Tinder-style card deck)
 * Supports dynamic filtering by Date Range, Suburb/Precinct, Vibe, and Activity.
 */
const swiper = {
  deckQueue: [],
  currentIndex: 0,

  initDeck() {
    const activeVoter = app.getActiveVoterName();
    const u1 = app.profile?.user1_name || 'Emma';
    const u2 = app.profile?.user2_name || 'Jordan';
    const isUser1 = activeVoter === u1;
    const isTogether = app.currentVoter === 'both';
    
    // Always draw from the master pool so Swiper has all unvoted activities
    const pool = (typeof discover !== 'undefined' && discover.getAllEventsPool) 
      ? discover.getAllEventsPool() 
      : (app.events || []);

    let votes = {};
    try { votes = JSON.parse(localStorage.getItem('twodo_votes') || '{}'); } catch (e) {}
    if (typeof firebaseService !== 'undefined' && firebaseService.votesMap) {
      votes = { ...votes, ...firebaseService.votesMap };
    }

    // Filter queue to items this voter hasn't decided (neither 'love' nor 'pass')
    this.deckQueue = (pool || []).filter(ev => {
      const v1 = votes[`${ev.id}_${u1}`] !== undefined ? votes[`${ev.id}_${u1}`] : (votes[`${ev.id}_Emma`] !== undefined ? votes[`${ev.id}_Emma`] : ev.u1_vote);
      const v2 = votes[`${ev.id}_${u2}`] !== undefined ? votes[`${ev.id}_${u2}`] : (votes[`${ev.id}_Jordan`] !== undefined ? votes[`${ev.id}_Jordan`] : ev.u2_vote);
      
      ev.u1_vote = v1;
      ev.u2_vote = v2;
      ev.is_match = Boolean(v1 === 'love' && v2 === 'love');

      if (isTogether) {
        const d1 = v1 === 'love' || v1 === 'pass';
        const d2 = v2 === 'love' || v2 === 'pass';
        return !d1 && !d2;
      }
      const myVote = isUser1 ? v1 : v2;
      // Only items with no selection or thinking ('maybe') should be in swiper!
      return !myVote || myVote === 'maybe';
    });

    this.currentIndex = 0;
    this.renderDeck();
    this.updateSwiperFilterStatus();
  },

  renderDeck() {
    const deck = document.getElementById('card-deck');
    const empty = document.getElementById('deck-empty');
    const currentNameSpan = document.getElementById('swiper-current-user');
    const otherPartnerSpan = document.getElementById('other-partner-name');

    if (currentNameSpan) {
      currentNameSpan.textContent = app.getActiveVoterName();
    }
    if (otherPartnerSpan) {
      const other = app.getActiveVoterName() === app.profile?.user1_name 
        ? app.profile?.user2_name 
        : app.profile?.user1_name;
      otherPartnerSpan.textContent = other || 'Partner';
    }

    if (!deck) return;

    const isSolo = (typeof firebaseService !== 'undefined') ? firebaseService.isSolo : false;

    if (!this.deckQueue || this.deckQueue.length === 0 || this.currentIndex >= this.deckQueue.length) {
      deck.innerHTML = '';
      empty?.classList.remove('hidden');

      const emptyMsg = document.getElementById('deck-empty-msg');
      const resetBtn = document.getElementById('deck-empty-reset-filter');
      const switchPartnerBtn = otherPartnerSpan?.closest('button');
      if (switchPartnerBtn) {
        switchPartnerBtn.classList.toggle('hidden', isSolo);
      }

      const anyActive = (typeof discover !== 'undefined') && (
        discover.activeDateRange !== 'all' ||
        discover.selectedSuburbs.length > 0 ||
        discover.selectedVibes.length > 0 ||
        discover.selectedCategories.length > 0
      );

      if (emptyMsg) {
        if (anyActive) {
          emptyMsg.textContent = 'No un-swiped activities match your current filters. Try resetting filters to review more dates!';
        } else if (isSolo) {
          emptyMsg.textContent = "You've reviewed all dates! Check your My Loves list or check your planner.";
        } else {
          emptyMsg.textContent = "Switch to your partner's profile to see what matches you unlocked, or check your planner.";
        }
      }
      if (resetBtn) {
        resetBtn.classList.toggle('hidden', !anyActive);
      }

      this.updateSwiperFilterStatus();
      return;
    }

    empty?.classList.add('hidden');

    // Render top 2 cards for depth
    const visibleCards = this.deckQueue.slice(this.currentIndex, this.currentIndex + 2);
    deck.innerHTML = visibleCards.map((ev, idx) => {
      const zIndex = 10 - idx;
      const scale = 1 - (idx * 0.04);
      const translateY = idx * 10;

      // Partner note on swiper card
      const activeVoter = app.getActiveVoterName();
      const u1 = app.profile?.user1_name || 'Emma';
      const u2 = app.profile?.user2_name || 'Jordan';
      const partnerName = (activeVoter === u1) ? u2 : u1;
      const partnerVote = (activeVoter === u1) ? ev.u2_vote : ev.u1_vote;
      const partnerNote = (activeVoter === u1) ? ev.u2_note : ev.u1_note;
      let partnerNoteHtml = '';
      if (!isSolo && partnerVote === 'love' && partnerNote) {
        partnerNoteHtml = `
          <div style="background:#fff1f2; border:1px solid #fecdd3; border-radius:10px; padding:6px 10px; margin-bottom:8px; font-size:0.82rem; color:#be123c;">
            💬 <strong>${partnerName}'s Note:</strong> "${partnerNote}"
          </div>
        `;
      }

      return `
        <div class="swipe-card" id="swipe-card-${idx}" style="z-index: ${zIndex}; transform: scale(${scale}) translateY(${translateY}px);">
          <div class="swipe-badge swipe-badge-love" style="position:absolute; top:20px; left:20px; z-index:20; border:3px solid #10b981; color:#10b981; font-size:1.35rem; font-weight:800; padding:4px 14px; border-radius:10px; transform:rotate(-15deg); opacity:0; pointer-events:none; background:rgba(255,255,255,0.85);">LOVE ❤️</div>
          <div class="swipe-badge swipe-badge-pass" style="position:absolute; top:20px; right:20px; z-index:20; border:3px solid #ef4444; color:#ef4444; font-size:1.35rem; font-weight:800; padding:4px 14px; border-radius:10px; transform:rotate(15deg); opacity:0; pointer-events:none; background:rgba(255,255,255,0.85);">PASS ❌</div>
          <div class="swipe-card-media">
            <img src="${ev.image_url}" alt="${ev.title}" onerror="this.src='https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80'">
            <span class="card-source-badge">${ev.source}</span>
            <span class="card-price-badge">${ev.price_str || ev.price_level}</span>
          </div>
          <div class="swipe-card-body">
            <div class="card-category">${ev.category}</div>
            <h3 style="font-size:1.25rem; font-weight:800; line-height:1.25; margin-bottom:6px;">${ev.title}</h3>
            <div class="card-location" style="margin-bottom:6px;">
              <span>📍</span> <span>${ev.location_name || ev.city}</span>
            </div>
            ${partnerNoteHtml}
            <p style="font-size:0.88rem; color:#475569; margin-bottom:10px; line-height:1.4;">${ev.description}</p>
            ${ev.insider_tip ? `<div class="card-tip"><strong>💡 Tip:</strong> ${ev.insider_tip}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');

    const topCardEl = document.getElementById('swipe-card-0');
    if (topCardEl) {
      this.attachTouch(topCardEl);
    }

    this.updateSwiperFilterStatus();
  },

  updateSwiperFilterStatus() {
    const statusEl = document.getElementById('sw-filter-status');
    if (!statusEl) return;
    const remaining = Math.max(0, this.deckQueue.length - this.currentIndex);
    const filterParts = [];
    if (typeof discover !== 'undefined') {
      if (discover.activeDateRange !== 'all') filterParts.push(discover.getDateRangeLabel());
      if (discover.selectedSuburbs && discover.selectedSuburbs.length > 0) {
        filterParts.push(discover.selectedSuburbs.length === 1 ? discover.selectedSuburbs[0] : `${discover.selectedSuburbs.length} Suburbs`);
      }
      if (discover.selectedVibes && discover.selectedVibes.length > 0) {
        filterParts.push(discover.selectedVibes.length === 1 ? discover.selectedVibes[0] : `${discover.selectedVibes.length} Vibes`);
      }
      if (discover.selectedCategories && discover.selectedCategories.length > 0) {
        filterParts.push(discover.selectedCategories.length === 1 ? discover.selectedCategories[0] : `${discover.selectedCategories.length} Categories`);
      }
    }

    if (filterParts.length > 0) {
      statusEl.textContent = `🎯 ${remaining} activities matching: ${filterParts.join(' • ')}`;
    } else {
      statusEl.textContent = `⚡ ${remaining} activities ready to swipe`;
    }
  },

  attachTouch(card) {
    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let currentY = 0;
    let isDragging = false;

    const onStart = (clientX, clientY) => {
      startX = clientX;
      startY = clientY;
      currentX = 0;
      currentY = 0;
      isDragging = true;
      card.style.transition = 'none';
    };

    const onMove = (clientX, clientY) => {
      if (!isDragging) return;
      currentX = clientX - startX;
      currentY = clientY - startY;
      const rotate = currentX * 0.08;
      card.style.transform = `translate(${currentX}px, ${currentY}px) rotate(${rotate}deg)`;

      const badgeLove = card.querySelector('.swipe-badge-love');
      const badgePass = card.querySelector('.swipe-badge-pass');
      if (badgeLove) badgeLove.style.opacity = Math.max(0, Math.min(1, currentX / 80));
      if (badgePass) badgePass.style.opacity = Math.max(0, Math.min(1, -currentX / 80));
    };

    const onEnd = () => {
      if (!isDragging) return;
      isDragging = false;
      card.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
      if (currentX > 85) {
        this.handleSwipe('love');
      } else if (currentX < -85) {
        this.handleSwipe('pass');
      } else if (currentY < -85) {
        this.handleSwipe('maybe');
      } else {
        card.style.transform = 'translate(0px, 0px) rotate(0deg)';
        const badgeLove = card.querySelector('.swipe-badge-love');
        const badgePass = card.querySelector('.swipe-badge-pass');
        if (badgeLove) badgeLove.style.opacity = '0';
        if (badgePass) badgePass.style.opacity = '0';
      }
    };

    // Mobile touch events (iPhone & Android)
    card.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      onStart(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    card.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      onMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    card.addEventListener('touchend', onEnd);
    card.addEventListener('touchcancel', onEnd);

    // Desktop mouse events
    card.addEventListener('mousedown', (e) => {
      onStart(e.clientX, e.clientY);
      const mouseMoveHandler = (moveEv) => onMove(moveEv.clientX, moveEv.clientY);
      const mouseUpHandler = () => {
        window.removeEventListener('mousemove', mouseMoveHandler);
        window.removeEventListener('mouseup', mouseUpHandler);
        onEnd();
      };
      window.addEventListener('mousemove', mouseMoveHandler);
      window.addEventListener('mouseup', mouseUpHandler);
    });
  },

  async handleSwipe(direction) {
    if (this.currentIndex >= this.deckQueue.length) return;
    const currentEvent = this.deckQueue[this.currentIndex];
    const topCard = document.getElementById('swipe-card-0');

    if (topCard) {
      const xTranslate = direction === 'love' ? '120%' : (direction === 'pass' ? '-120%' : '0%');
      const yTranslate = direction === 'maybe' ? '-100%' : '20px';
      const rotate = direction === 'love' ? '25deg' : (direction === 'pass' ? '-25deg' : '0deg');
      
      topCard.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
      topCard.style.transform = `translate(${xTranslate}, ${yTranslate}) rotate(${rotate})`;
      topCard.style.opacity = '0';
    }

    setTimeout(async () => {
      await collaborative.handleVote(currentEvent.id, direction, null, true);
      // Remove current swiped card from queue
      this.deckQueue = this.deckQueue.filter(e => e.id !== currentEvent.id);
      if (direction === 'maybe') {
        // Thinking / maybe: append to back of queue
        this.deckQueue.push(currentEvent);
      }
      this.currentIndex = 0;
      this.renderDeck();
      this.updateSwiperFilterStatus();
    }, 220);
  }
};

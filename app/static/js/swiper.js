/**
 * TwoDo Date Swiper (Tinder-style card deck)
 */
const swiper = {
  deckQueue: [],
  currentIndex: 0,

  initDeck() {
    const activeVoter = app.getActiveVoterName();
    const isUser1 = activeVoter === (app.profile?.user1_name || 'Emma');
    
    // Fallback to offline enriched catalog if app.events is not yet populated
    const pool = (app.events && app.events.length > 0) 
      ? app.events 
      : (typeof api !== 'undefined' && api.getLocalEnrichedEvents ? api.getLocalEnrichedEvents().events : []);

    // Filter queue to items this voter hasn't voted 'love' or 'pass' on yet
    this.deckQueue = (pool || []).filter(ev => {
      const myVote = isUser1 ? ev.u1_vote : ev.u2_vote;
      return !myVote || myVote === 'maybe';
    });

    this.currentIndex = 0;
    this.renderDeck();
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

    if (!this.deckQueue || this.deckQueue.length === 0 || this.currentIndex >= this.deckQueue.length) {
      deck.innerHTML = '';
      empty?.classList.remove('hidden');
      return;
    }

    empty?.classList.add('hidden');

    // Render top 2 cards for depth
    const visibleCards = this.deckQueue.slice(this.currentIndex, this.currentIndex + 2);
    deck.innerHTML = visibleCards.map((ev, idx) => {
      const zIndex = 10 - idx;
      const scale = 1 - (idx * 0.04);
      const translateY = idx * 10;

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
      await collaborative.handleVote(currentEvent.id, direction);
      this.currentIndex++;
      this.renderDeck();
    }, 200);
  }
};

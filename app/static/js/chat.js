/**
 * TwoDo Private Couple Chat Module
 * Real-time private date conversation & activity sharing between Emma & Jordan
 */
const chatView = {
  messages: [],
  pollTimer: null,
  activeSharingEvent: null,

  async init() {
    this.updateVoterToggleUI();
    await this.loadMessages();
    this.startPolling();
  },

  updateVoterToggleUI() {
    const current = app.getActiveVoterName();
    const u1 = app.profile?.user1_name || 'Emma';
    const u2 = app.profile?.user2_name || 'Jordan';

    const pill1 = document.getElementById('chat-voter-1');
    const pill2 = document.getElementById('chat-voter-2');
    if (pill1 && pill2) {
      pill1.textContent = u1;
      pill2.textContent = u2;
      pill1.classList.toggle('active', current === u1);
      pill2.classList.toggle('active', current === u2);
    }

    const input = document.getElementById('chat-input-text');
    if (input) {
      const partner = current === u1 ? u2 : u1;
      input.placeholder = `Message ${partner}...`;
    }
  },

  // Messages are always sent as the person logged in on this device
  setChatVoter() {
    this.updateVoterToggleUI();
  },

  async loadMessages() {
    try {
      if (typeof firebaseService !== 'undefined' && firebaseService.coupleId) {
        this.messages = firebaseService.messages || [];
      } else {
        this.messages = await api.getChatMessages();
      }
      this.renderMessages();
    } catch (e) {
      console.warn('Chat load error:', e);
    }
  },

  renderMessages() {
    const container = document.getElementById('chat-messages-container');
    if (!container) return;

    if (!this.messages || this.messages.length === 0) {
      container.innerHTML = `
        <div class="chat-empty-state">
          <span style="font-size:2.4rem;">💬</span>
          <h4>Private Couple Chat</h4>
          <p>This is your shared space to chat about upcoming date ideas, swap thoughts, and pick weekend plans!</p>
        </div>
      `;
      return;
    }

    const currentVoter = app.getActiveVoterName();

    container.innerHTML = this.messages.map(msg => {
      const myUid = (typeof firebaseService !== 'undefined' && firebaseService.currentUser) ? firebaseService.currentUser.uid : null;
      const isMine = (msg.sender_uid && myUid) ? msg.sender_uid === myUid : msg.sender_name === currentVoter;
      const isEmma = isMine;
      const senderColor = isEmma ? 'var(--primary)' : '#8b5cf6';
      
      // Time format
      let timeStr = '';
      if (msg.created_at) {
        try {
          const d = new Date(msg.created_at);
          timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch (e) {}
      }

      // Optional Activity Preview Attachment
      let activityHtml = '';
      if (msg.activity_id && msg.activity_title) {
        activityHtml = `
          <div class="chat-activity-attachment" onclick="app.navigate('discover'); discover.highlightCard('${msg.activity_id}')">
            ${msg.activity_image ? `<img src="${msg.activity_image}" class="chat-att-img" alt="">` : ''}
            <div class="chat-att-info">
              <span class="chat-att-label">📍 Date Idea</span>
              <strong class="chat-att-title">${msg.activity_title}</strong>
              <span class="chat-att-btn">Tap to View Activity ✨</span>
            </div>
          </div>
        `;
      }

      return `
        <div class="chat-msg-row ${isMine ? 'mine' : 'theirs'}">
          ${!isMine ? `<div class="chat-sender-avatar" style="background:${senderColor};">${msg.sender_name[0]}</div>` : ''}
          <div class="chat-msg-wrapper">
            ${!isMine ? `<span class="chat-sender-name" style="color:${senderColor};">${msg.sender_name}</span>` : ''}
            <div class="chat-bubble ${isMine ? 'mine' : 'theirs'}">
              <div class="chat-msg-text">${this.escapeHtml(msg.text)}</div>
              ${activityHtml}
            </div>
            <span class="chat-timestamp">${timeStr}</span>
          </div>
        </div>
      `;
    }).join('');

    this.scrollToBottom();
  },

  scrollToBottom() {
    const container = document.getElementById('chat-messages-container');
    if (container) {
      setTimeout(() => {
        container.scrollTop = container.scrollHeight;
      }, 50);
    }
  },

  async handleFormSubmit(e) {
    if (e) e.preventDefault();
    const input = document.getElementById('chat-input-text');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    const sender = app.getActiveVoterName();
    
    // Add locally for instant response
    const tempMsg = {
      id: Date.now(),
      sender_name: sender,
      text: text,
      created_at: new Date().toISOString()
    };
    this.messages.push(tempMsg);
    this.renderMessages();

    try {
      if (typeof firebaseService !== 'undefined' && firebaseService.coupleId) {
        await firebaseService.sendChatMessage(sender, text, this.activeSharingEvent);
      }
      const saved = await api.sendChatMessage(sender, text, this.activeSharingEvent);
      this.activeSharingEvent = null;
      this.hideShareBanner();
      // Replace temp with saved
      const idx = this.messages.findIndex(m => m.id === tempMsg.id);
      if (idx !== -1 && saved) {
        this.messages[idx] = saved;
      }
    } catch (err) {
      console.error('Failed to send chat message:', err);
    }
  },

  sendQuickSuggestion(suggestionText) {
    const input = document.getElementById('chat-input-text');
    if (input) {
      input.value = suggestionText;
      this.handleFormSubmit();
    }
  },

  shareEventToChat(eventId) {
    const ev = (app.events || []).find(e => e.id === eventId);
    if (!ev) return;

    this.activeSharingEvent = ev;
    app.navigate('chat');

    const shareBanner = document.getElementById('chat-share-banner');
    const shareTitle = document.getElementById('chat-share-title');
    if (shareBanner && shareTitle) {
      shareTitle.textContent = `Sharing: ${ev.title}`;
      shareBanner.classList.remove('hidden');
    }

    const input = document.getElementById('chat-input-text');
    if (input) {
      input.value = `Look at this date idea! 💕`;
      input.focus();
    }
  },

  hideShareBanner() {
    this.activeSharingEvent = null;
    document.getElementById('chat-share-banner')?.classList.add('hidden');
  },

  startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      const chatPanel = document.getElementById('view-chat');
      if (chatPanel && chatPanel.classList.contains('active')) {
        this.loadMessages();
      }
    }, 6000);
  },

  escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
};

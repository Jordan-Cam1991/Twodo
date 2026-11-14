/**
 * TwoDo Shared Planner — Google Calendar Interface
 * Provides authentic Google Calendar Schedule Agenda, collapsible Mini-Month
 * picker, full interactive Month grid, Search, Today jump, + New Event FAB,
 * and Google Calendar event details + deep-link export alongside Bucket List
 * and Completed Memories.
 */

const GCAL_THEMES = {
  blueberry: { bg: '#5c6bc0', ink: '#3f51b5', label: 'Blueberry', style: 'solid' },
  sage:      { bg: '#0b8043', ink: '#0b8043', label: 'Sage', style: 'solid' },
  peacock:   { bg: '#039be5', ink: '#0277bd', label: 'Peacock', style: 'solid' },
  grape:     { bg: '#8e24aa', ink: '#7b1fa2', label: 'Grape', style: 'solid' },
  flamingo:  { bg: '#d81b60', ink: '#ad1457', label: 'Berry', style: 'solid' },
  banana:    { bg: '#d5b021', ink: '#8a6d00', label: 'Banana', style: 'solid' },
  outline:   { bg: '#5c6bc0', ink: '#3f51b5', label: 'Outlined', style: 'outline' }
};

const SLOT_DEFAULT_TIMES = {
  morning: '10:00',
  afternoon: '14:00',
  evening: '18:30',
  late_night: '20:30'
};

const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS_UPPER = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MON_FIRST_HEADERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const planner = {
  items: [],
  currentView: 'scheduled',
  activeMonthDate: null,
  selectedMonthDay: null,
  miniMonthOpen: false,
  drawerOpen: false,
  searchOpen: false,
  searchQuery: '',
  activeDetailId: null,
  isSaving: false,

  /** Local YYYY-MM-DD helper without UTC off-by-one shifts. */
  getTodayYmd() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  },

  /** Parse YYYY-MM-DD strictly as local midnight Date. */
  parseLocalDate(ymd) {
    if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(String(ymd))) return null;
    const [y, m, d] = String(ymd).split('-').map(Number);
    return new Date(y, m - 1, d);
  },

  /** Format Date object to local YYYY-MM-DD. */
  toYmd(dateObj) {
    return `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
  },

  /** Safely escape user or catalog text before inserting into HTML. */
  escapeHtml(val) {
    return String(val == null ? '' : val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  /** Safely escape text inside single-quoted JS inside double-quoted HTML attribute. */
  escapeJsInAttr(val) {
    return String(val == null ? '' : val)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/"/g, '&quot;');
  },

  /** Compute start/end compact date & time components shared by Google Calendar URL and .ics export. */
  computeEventDateTimeBounds(item) {
    if (!item?.scheduled_date || !/^\d{4}-\d{2}-\d{2}$/.test(item.scheduled_date)) return null;
    const compactDate = item.scheduled_date.replace(/-/g, '');
    const dt = this.parseLocalDate(item.scheduled_date);
    if (!dt) return null;

    const isAllDay = Boolean(item.all_day || String(item.duration_mins) === 'all_day');
    if (isAllDay) {
      const nextDt = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + 1);
      return {
        isAllDay: true,
        dtStart: compactDate,
        dtEnd: this.toYmd(nextDt).replace(/-/g, '')
      };
    }

    const start24 = this.getStartTime24(item);
    const [sh, sm] = start24.split(':').map(Number);
    const dur = parseInt(item.duration_mins, 10) || 120;
    const endTotal = sh * 60 + sm + dur;
    const endDt = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + Math.floor(endTotal / 1440));
    const endM = endTotal % 1440;
    const eh = Math.floor(endM / 60);
    const em = endM % 60;

    return {
      isAllDay: false,
      dtStart: `${compactDate}T${String(sh).padStart(2, '0')}${String(sm).padStart(2, '0')}00`,
      dtEnd: `${this.toYmd(endDt).replace(/-/g, '')}T${String(eh).padStart(2, '0')}${String(em).padStart(2, '0')}00`
    };
  },

  /** Ensure internal calendar focus state is initialized. */
  ensureCalendarState() {
    const todayYmd = this.getTodayYmd();
    if (!this.activeMonthDate) {
      this.activeMonthDate = this.parseLocalDate(todayYmd);
    }
    if (!this.selectedMonthDay) {
      this.selectedMonthDay = todayYmd;
    }
  },

  /** Load planner items from API / Firestore cache and render UI. */
  async loadPlanner() {
    this.ensureCalendarState();
    try {
      const data = await api.getPlanner();
      this.items = (data && Array.isArray(data.items)) ? data.items : [];
      this.syncHeaderChrome();
      this.renderPlanner();
      this.updateBadges();
      if (typeof matchesView !== 'undefined' && matchesView.refresh) {
        matchesView.refresh();
      }
    } catch (e) {
      console.error('Failed to load planner:', e);
    }
  },

  /** Active scheduled / bucket / memories collections (filtered consistently). */
  getPartitionedItems() {
    const query = (this.searchQuery || '').trim().toLowerCase();
    const matchesSearch = (item) => {
      if (!query) return true;
      const hay = `${item.title || ''} ${item.location_name || item.location || ''} ${item.notes || ''} ${item.category || ''}`.toLowerCase();
      return hay.includes(query);
    };

    const rawScheduled = this.items.filter(i => {
      if (i.status === 'completed' || i.status === 'bucket_list') return false;
      return i.status === 'scheduled' || i.status === 'in_planner' || Boolean(i.scheduled_date);
    });

    const sortByDateTime = (a, b) => {
      const da = `${a.scheduled_date || '9999-12-31'} ${this.getStartTime24(a)}`;
      const db = `${b.scheduled_date || '9999-12-31'} ${this.getStartTime24(b)}`;
      return da.localeCompare(db);
    };

    const scheduledAll = [...rawScheduled].sort(sortByDateTime);
    const scheduled = scheduledAll.filter(matchesSearch);
    const bucket = this.items.filter(i => (i.status === 'bucket_list' || (!i.status && !i.scheduled_date)) && matchesSearch(i));
    const memories = this.items.filter(i => i.status === 'completed' && matchesSearch(i));

    return { scheduledAll, scheduled, bucket, memories };
  },

  /** Update top header Today badge, user avatar initial, and active month label. */
  syncHeaderChrome() {
    this.ensureCalendarState();
    const todayNumEl = document.getElementById('gcal-today-num');
    if (todayNumEl) todayNumEl.textContent = String(new Date().getDate());

    const avatarEl = document.getElementById('gcal-avatar-btn');
    if (avatarEl) {
      const profile = (typeof app !== 'undefined' && app.profile) ? app.profile : null;
      const currentUser = (typeof api !== 'undefined' && api.currentUser) ? api.currentUser : 'user1';
      const rawName = currentUser === 'user2'
        ? (profile?.u2_name || profile?.user2_name || 'J')
        : (profile?.u1_name || profile?.user1_name || 'E');
      avatarEl.textContent = String(rawName).trim().charAt(0).toUpperCase() || 'E';
    }

    const monthLabelEl = document.getElementById('gcal-header-month');
    if (monthLabelEl && this.activeMonthDate) {
      const d = this.activeMonthDate;
      const currentYear = new Date().getFullYear();
      monthLabelEl.textContent = d.getFullYear() === currentYear
        ? MONTHS_FULL[d.getMonth()]
        : `${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}`;
    }

    const monthBtn = document.getElementById('gcal-month-btn');
    if (monthBtn) monthBtn.setAttribute('aria-expanded', this.miniMonthOpen ? 'true' : 'false');
  },

  /** Update all planner & nav badge counters consistently. */
  updateBadges() {
    const scheduledCount = this.items.filter(i => i.status !== 'completed' && i.status !== 'bucket_list' && (i.status === 'scheduled' || Boolean(i.scheduled_date))).length;
    const bucketCount = this.items.filter(i => i.status === 'bucket_list' || (!i.status && !i.scheduled_date)).length;
    const memoriesCount = this.items.filter(i => i.status === 'completed').length;
    const totalPending = scheduledCount + bucketCount;

    const setTxt = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(v);
    };
    setTxt('planner-count-badge', totalPending);
    setTxt('m-planner-badge', totalPending);
    setTxt('scheduled-count-badge', scheduledCount);
    setTxt('bucket-count-badge', bucketCount);
    setTxt('memories-count-badge', memoriesCount);
  },

  /** Switch active planner sub-view ('scheduled' | 'month' | 'bucket' | 'memories'). */
  switchView(view) {
    const valid = ['scheduled', 'month', 'bucket', 'memories'];
    this.currentView = valid.includes(view) ? view : 'scheduled';

    const sections = {
      scheduled: 'planner-section-scheduled',
      month: 'planner-section-month',
      bucket: 'planner-section-bucket',
      memories: 'planner-section-memories'
    };

    Object.entries(sections).forEach(([key, secId]) => {
      const sec = document.getElementById(secId);
      const tab = document.getElementById(`tab-btn-${key}`);
      const active = key === this.currentView;
      if (sec) sec.classList.toggle('hidden', !active);
      if (tab) tab.classList.toggle('active', active);
    });

    if (this.currentView === 'month') {
      this.miniMonthOpen = false;
      const mini = document.getElementById('gcal-mini-month');
      if (mini) mini.classList.add('hidden');
    }

    this.syncHeaderChrome();
    this.renderPlanner();
  },

  /** Toggle the collapsible mini-month calendar under "November ▾". */
  toggleMiniMonth(forceState) {
    this.miniMonthOpen = typeof forceState === 'boolean' ? forceState : !this.miniMonthOpen;
    const el = document.getElementById('gcal-mini-month');
    if (el) el.classList.toggle('hidden', !this.miniMonthOpen);
    this.syncHeaderChrome();
    if (this.miniMonthOpen) this.renderMiniMonth();
  },

  /** Toggle left Google Calendar navigation drawer. */
  toggleDrawer(forceState) {
    this.drawerOpen = typeof forceState === 'boolean' ? forceState : !this.drawerOpen;
    const drawer = document.getElementById('gcal-drawer-menu');
    const backdrop = document.getElementById('gcal-drawer-backdrop');
    if (drawer) drawer.classList.toggle('hidden', !this.drawerOpen);
    if (backdrop) backdrop.classList.toggle('hidden', !this.drawerOpen);
  },

  /** Toggle Google Calendar top search bar. */
  toggleSearch(forceState) {
    this.searchOpen = typeof forceState === 'boolean' ? forceState : !this.searchOpen;
    const bar = document.getElementById('gcal-search-bar');
    if (bar) bar.classList.toggle('hidden', !this.searchOpen);
    if (this.searchOpen) {
      const inp = document.getElementById('gcal-search-input');
      if (inp) setTimeout(() => inp.focus(), 40);
    } else if (this.searchQuery) {
      this.clearSearch();
    }
  },

  /** Filter planner views live by search query. */
  setSearchQuery(q) {
    this.searchQuery = String(q || '');
    this.renderPlanner();
  },

  /** Clear active search input and re-render. */
  clearSearch() {
    this.searchQuery = '';
    const inp = document.getElementById('gcal-search-input');
    if (inp) inp.value = '';
    this.renderPlanner();
  },

  /** Shift active calendar month by delta (-1 prev, +1 next). */
  shiftMonth(delta) {
    this.ensureCalendarState();
    const d = this.activeMonthDate;
    this.activeMonthDate = new Date(d.getFullYear(), d.getMonth() + delta, 1);
    this.syncHeaderChrome();
    if (this.miniMonthOpen) this.renderMiniMonth();
    if (this.currentView === 'month') this.renderMonthView();
  },

  /** Jump directly to Today in Schedule or Month view. */
  jumpToToday() {
    const todayYmd = this.getTodayYmd();
    this.activeMonthDate = this.parseLocalDate(todayYmd);
    this.selectedMonthDay = todayYmd;
    if (this.currentView === 'bucket' || this.currentView === 'memories') {
      this.switchView('scheduled');
    } else {
      this.syncHeaderChrome();
      this.renderPlanner();
    }
    const todayRow = document.getElementById(`gcal-day-${todayYmd}`);
    if (todayRow && todayRow.scrollIntoView) {
      todayRow.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  },

  /** Handle tapping a calendar date cell in either Mini-Month or Month view. */
  selectMonthDay(ymd) {
    const dt = this.parseLocalDate(ymd);
    if (!dt) return;
    this.selectedMonthDay = ymd;
    this.activeMonthDate = new Date(dt.getFullYear(), dt.getMonth(), 1);
    this.syncHeaderChrome();

    if (this.currentView === 'month') {
      this.renderMonthView();
      return;
    }

    if (this.currentView !== 'scheduled') {
      this.switchView('scheduled');
    } else if (this.miniMonthOpen) {
      this.renderMiniMonth();
    }

    const row = document.getElementById(`gcal-day-${ymd}`);
    if (row && row.scrollIntoView) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      this.toggleMiniMonth(false);
      this.openNewEventModal(ymd);
    }
  },

  /** Resolve canonical 24h start time string ("HH:MM") for sorting & display. */
  getStartTime24(item) {
    if (item && /^\d{2}:\d{2}$/.test(String(item.scheduled_time || ''))) {
      return String(item.scheduled_time);
    }
    const tStr = String(item?.time_str || '');
    const m = tStr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    if (m) {
      let hr = parseInt(m[1], 10);
      const min = m[2] ? parseInt(m[2], 10) : 0;
      const ap = m[3].toLowerCase();
      if (ap === 'pm' && hr < 12) hr += 12;
      if (ap === 'am' && hr === 12) hr = 0;
      return `${String(hr).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
    return SLOT_DEFAULT_TIMES[item?.time_slot] || '18:30';
  },

  /** Derive slot bucket ('morning' | 'afternoon' | 'evening' | 'late_night') from HH:MM. */
  deriveSlotFromTime(hhmm) {
    const hr = parseInt(String(hhmm || '18:30').split(':')[0], 10);
    if (hr < 12) return 'morning';
    if (hr < 17) return 'afternoon';
    if (hr < 20) return 'evening';
    return 'late_night';
  },

  /** Format compact Google Calendar time span (e.g. "9 – 10 am", "6:30 – 8:30 pm"). */
  formatGCalTimeRange(item) {
    if (!item) return '';
    if (item.all_day || String(item.duration_mins) === 'all_day') return 'All day';

    const start24 = this.getStartTime24(item);
    const [sh, sm] = start24.split(':').map(Number);
    const dur = parseInt(item.duration_mins, 10) || (item.time_slot === 'morning' || item.time_slot === 'afternoon' ? 90 : 120);
    const startTotal = sh * 60 + sm;
    const endTotal = (startTotal + dur) % (24 * 60);
    const eh = Math.floor(endTotal / 60);
    const em = endTotal % 60;

    const fmtPart = (h, m, showPeriod) => {
      const period = h >= 12 ? 'pm' : 'am';
      const h12 = h % 12 === 0 ? 12 : h % 12;
      const minPart = m === 0 ? '' : `:${String(m).padStart(2, '0')}`;
      return showPeriod ? `${h12}${minPart} ${period}` : `${h12}${minPart}`;
    };

    const startPeriod = sh >= 12 ? 'pm' : 'am';
    const endPeriod = eh >= 12 ? 'pm' : 'am';
    const left = fmtPart(sh, sm, startPeriod !== endPeriod);
    const right = fmtPart(eh, em, true);
    return `${left} – ${right}`;
  },

  /** Resolve Google Calendar visual theme & card style ('solid' | 'outline' | 'banner' | 'allday'). */
  getEventColorTheme(item) {
    if (item && item.all_day) {
      return { ...GCAL_THEMES.banana, key: 'banana', isAllDay: true, isBanner: false };
    }
    if (item && item.color && GCAL_THEMES[item.color]) {
      const base = GCAL_THEMES[item.color];
      const hasImg = Boolean(item.image_url);
      const isDining = /food|drink|dining|lunch|dinner|brunch|wine|cafe|picnic/i.test(`${item.category || ''} ${item.title || ''}`);
      return {
        ...base,
        key: item.color,
        isAllDay: false,
        isBanner: item.style === 'banner' || (hasImg && isDining && base.style !== 'outline')
      };
    }

    const cat = String(item?.category || '').toLowerCase();
    const title = String(item?.title || '').toLowerCase();
    let key = 'blueberry';
    if (cat.includes('outdoor') || cat.includes('nature') || cat.includes('adventure')) key = 'sage';
    else if (cat.includes('sport') || cat.includes('active') || cat.includes('wellness')) key = 'peacock';
    else if (cat.includes('music') || cat.includes('concert') || cat.includes('comedy') || cat.includes('art')) key = 'grape';
    else if (cat.includes('special') || cat.includes('date')) key = 'flamingo';

    const hasImg = Boolean(item?.image_url);
    const isDining = cat.includes('food') || cat.includes('drink') || /\b(lunch|dinner|brunch|picnic|high tea)\b/.test(title);
    const theme = GCAL_THEMES[key];
    return {
      ...theme,
      key,
      isAllDay: false,
      isBanner: item?.style === 'banner' || (hasImg && isDining)
    };
  },

  /** Render partner/couple initial badges shown on right side of event cards. */
  getPartnerAvatarHtml(item) {
    const profile = (typeof app !== 'undefined' && app.profile) ? app.profile : null;
    const u1 = String(profile?.u1_name || 'Emma').trim().charAt(0).toUpperCase() || 'E';
    const u2 = String(profile?.u2_name || 'Jordan').trim().charAt(0).toUpperCase() || 'J';
    const isSolo = typeof firebaseService !== 'undefined' && firebaseService.isSolo;
    if (isSolo || item?.is_personal) {
      return `<div class="gcal-ev-avatars"><span class="gcal-ev-avatar">${this.escapeHtml(u1)}</span></div>`;
    }
    return `<div class="gcal-ev-avatars"><span class="gcal-ev-avatar">${this.escapeHtml(u1)}</span><span class="gcal-ev-avatar">${this.escapeHtml(u2)}</span></div>`;
  },

  /** Map item dates to a Dictionary<YYYY-MM-DD, PlannerItem[]>. */
  groupEventsByDate(items) {
    const map = {};
    (items || []).forEach(it => {
      if (!it.scheduled_date) return;
      if (!map[it.scheduled_date]) map[it.scheduled_date] = [];
      map[it.scheduled_date].push(it);
    });
    return map;
  },

  /** Build Monday-first month calendar grid HTML shared by Mini-Month & Full Month views. */
  buildMonthGridHtml(year, month, eventsByDate, opts = {}) {
    const mode = opts.mode || 'mini';
    const todayYmd = this.getTodayYmd();
    const firstOfMonth = new Date(year, month, 1);
    const mondayOffset = (firstOfMonth.getDay() + 6) % 7;
    const startCell = new Date(year, month, 1 - mondayOffset);

    const lastOfMonth = new Date(year, month + 1, 0);
    const totalNeeded = mondayOffset + lastOfMonth.getDate();
    const cellCount = Math.ceil(totalNeeded / 7) * 7;

    const headerBar = `
      <div class="gcal-cal-nav">
        <span class="gcal-cal-nav-title">${MONTHS_FULL[month]} ${year}</span>
        <div class="gcal-cal-nav-btns">
          <button type="button" class="gcal-mini-arrow" onclick="planner.shiftMonth(-1)" aria-label="Previous month">&lsaquo;</button>
          <button type="button" class="gcal-mini-arrow" onclick="planner.shiftMonth(1)" aria-label="Next month">&rsaquo;</button>
        </div>
      </div>
    `;

    const dows = MON_FIRST_HEADERS.map(d => `<div class="gcal-grid-dow">${d}</div>`).join('');
    let cellsHtml = '';

    for (let i = 0; i < cellCount; i++) {
      const dt = new Date(startCell.getFullYear(), startCell.getMonth(), startCell.getDate() + i);
      const ymd = this.toYmd(dt);
      const isOutside = dt.getMonth() !== month;
      const isToday = ymd === todayYmd;
      const isSelected = ymd === this.selectedMonthDay;
      const dayEvents = eventsByDate[ymd] || [];

      if (mode === 'full') {
        const chips = dayEvents.slice(0, 3).map(ev => {
          const theme = this.getEventColorTheme(ev);
          const outlineCls = theme.style === 'outline' ? 'is-outline' : '';
          return `<div class="gcal-month-chip ${outlineCls}" style="background:${theme.style === 'outline' ? '#fff' : theme.bg}; --gcal-color:${theme.bg}; --gcal-ink:${theme.ink}">${this.escapeHtml(ev.title || 'Plan')}</div>`;
        }).join('');
        const extra = dayEvents.length > 3 ? `<div class="gcal-month-more">+${dayEvents.length - 3} more</div>` : '';
        cellsHtml += `
          <div class="gcal-month-cell ${isOutside ? 'is-outside' : ''} ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''}" onclick="planner.selectMonthDay('${ymd}')">
            <span class="gcal-month-cell-num">${dt.getDate()}</span>
            ${chips}
            ${extra}
          </div>
        `;
      } else {
        const dots = dayEvents.slice(0, 3).map(ev => {
          const theme = this.getEventColorTheme(ev);
          return `<span class="gcal-mini-dot" style="background:${theme.bg}"></span>`;
        }).join('');
        cellsHtml += `
          <button type="button" class="gcal-mini-cell ${isOutside ? 'is-outside' : ''} ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''}" onclick="planner.selectMonthDay('${ymd}')">
            <span class="gcal-mini-num">${dt.getDate()}</span>
            <span class="gcal-mini-dots">${dots}</span>
          </button>
        `;
      }
    }

    if (mode === 'full') {
      return `${headerBar}<div class="gcal-month-table">${dows}${cellsHtml}</div>`;
    }
    return `${headerBar}<div class="gcal-mini-grid">${dows}${cellsHtml}</div>`;
  },

  /** Build a direct "Open in Google Calendar" web template URL for an event. */
  buildGoogleCalendarUrl(item) {
    const title = encodeURIComponent(item.title || 'TwoDo Plan');
    const loc = encodeURIComponent(item.location_name || item.location || 'Brisbane');
    const notesParts = [];
    if (item.notes) notesParts.push(item.notes);
    if (item.source_url) notesParts.push(`Link: ${item.source_url}`);
    const details = encodeURIComponent(notesParts.join('\n\n') || 'Planned on TwoDo');

    const bounds = this.computeEventDateTimeBounds(item);
    const datesQuery = bounds ? `&dates=${encodeURIComponent(`${bounds.dtStart}/${bounds.dtEnd}`)}` : '';
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}${datesQuery}&details=${details}&location=${loc}`;
  },

  /** Main planner render entry point. */
  renderPlanner() {
    this.ensureCalendarState();
    this.syncHeaderChrome();
    const { scheduledAll, scheduled, bucket, memories } = this.getPartitionedItems();

    this.renderNextUpBanner(scheduledAll);
    if (this.miniMonthOpen) this.renderMiniMonth();

    if (this.currentView === 'scheduled') {
      this.renderScheduled(scheduled);
    } else if (this.currentView === 'month') {
      this.renderMonthView(scheduled);
    } else if (this.currentView === 'bucket') {
      this.renderBucketList(bucket);
    } else if (this.currentView === 'memories') {
      this.renderMemories(memories);
    }
  },

  /** Render compact Google Calendar "Next up" strip above Schedule agenda. */
  renderNextUpBanner(scheduledAll) {
    const heroEl = document.getElementById('planner-hero-card');
    if (!heroEl) return;

    if (this.currentView !== 'scheduled' || !scheduledAll || scheduledAll.length === 0) {
      heroEl.classList.add('hidden');
      heroEl.innerHTML = '';
      return;
    }

    const todayYmd = this.getTodayYmd();
    const nextDate = scheduledAll.find(it => (it.scheduled_date || '9999-12-31') >= todayYmd) || scheduledAll[0];
    if (!nextDate) {
      heroEl.classList.add('hidden');
      heroEl.innerHTML = '';
      return;
    }

    const theme = this.getEventColorTheme(nextDate);
    const dt = this.parseLocalDate(nextDate.scheduled_date);
    const dateLabel = dt
      ? (nextDate.scheduled_date === todayYmd ? 'Today' : `${MONTHS_SHORT[dt.getMonth()]} ${dt.getDate()}`)
      : 'Upcoming';
    const timeLabel = this.formatGCalTimeRange(nextDate);

    heroEl.classList.remove('hidden');
    heroEl.innerHTML = `
      <div class="gcal-nextup-left" onclick="planner.openEventDetail('${this.escapeHtml(nextDate.id)}')">
        <span class="gcal-nextup-dot" style="background:${theme.bg}"></span>
        <div class="gcal-nextup-text">
          <div class="gcal-nextup-label">Next Date · ${this.escapeHtml(dateLabel)} · ${this.escapeHtml(timeLabel)}</div>
          <div class="gcal-nextup-title">${this.escapeHtml(nextDate.title || 'Scheduled Plan')}</div>
        </div>
      </div>
      <button type="button" class="gcal-nextup-cta" onclick="planner.openEventDetail('${this.escapeHtml(nextDate.id)}')">Details</button>
    `;
  },

  /** Render collapsible Mini-Month Picker under "November ▾". */
  renderMiniMonth() {
    const container = document.getElementById('gcal-mini-month');
    if (!container) return;
    const { scheduled } = this.getPartitionedItems();
    const byDate = this.groupEventsByDate(scheduled);
    const d = this.activeMonthDate || new Date();
    container.innerHTML = this.buildMonthGridHtml(d.getFullYear(), d.getMonth(), byDate, { mode: 'mini' });
  },

  /** Build single Google Calendar event card HTML inside a Schedule/Month day list. */
  buildScheduleCardHtml(item) {
    const theme = this.getEventColorTheme(item);
    const timeText = this.formatGCalTimeRange(item);
    const loc = item.location_name || item.location || '';
    const subText = loc ? `${timeText} at ${loc}` : timeText;
    const avatarsHtml = this.getPartnerAvatarHtml(item);
    const idAttr = this.escapeHtml(item.id);
    const titleHtml = this.escapeHtml(item.title || 'Date Night');
    const subHtml = this.escapeHtml(subText);

    if (theme.isBanner && item.image_url) {
      const safeImg = this.escapeHtml(item.image_url);
      return `
        <div class="gcal-event-card is-banner" style="background-image:url('${safeImg}')" onclick="planner.openEventDetail('${idAttr}')">
          <div class="gcal-ev-main">
            <div class="gcal-ev-title">${titleHtml}</div>
            <div class="gcal-ev-time">${subHtml}</div>
          </div>
          ${avatarsHtml}
        </div>
      `;
    }

    if (theme.isAllDay) {
      return `
        <div class="gcal-event-card is-allday" style="--gcal-color:${theme.bg}" onclick="planner.openEventDetail('${idAttr}')">
          <div class="gcal-ev-main">
            <div class="gcal-ev-title">${titleHtml}</div>
          </div>
        </div>
      `;
    }

    const styleClass = theme.style === 'outline' ? 'is-outline' : 'is-solid';
    return `
      <div class="gcal-event-card ${styleClass}" style="--gcal-color:${theme.bg}; --gcal-ink:${theme.ink}" onclick="planner.openEventDetail('${idAttr}')">
        <div class="gcal-ev-main">
          <div class="gcal-ev-title-row">
            ${theme.style === 'outline' ? '<span class="gcal-ev-badge-icon">🗓️</span>' : ''}
            <span class="gcal-ev-title">${titleHtml}</span>
          </div>
          <div class="gcal-ev-time">${subHtml}</div>
        </div>
        ${avatarsHtml}
      </div>
    `;
  },

  /** Render Google Calendar Schedule Agenda view. */
  renderScheduled(scheduled) {
    const container = document.getElementById('scheduled-timeline');
    const emptyEl = document.getElementById('scheduled-empty');
    if (!container) return;

    if (!scheduled || scheduled.length === 0) {
      container.innerHTML = '';
      if (emptyEl) emptyEl.classList.remove('hidden');
      return;
    }

    if (emptyEl) emptyEl.classList.add('hidden');

    const byDate = this.groupEventsByDate(scheduled);
    const todayYmd = this.getTodayYmd();

    // Always include Today if search isn't hiding non-matching dates
    const allDates = new Set(Object.keys(byDate));
    if (!this.searchQuery.trim()) {
      allDates.add(todayYmd);
    }
    const sortedDates = Array.from(allDates).sort();

    let lastMonthKey = '';
    const htmlParts = [];

    sortedDates.forEach(ymd => {
      const dt = this.parseLocalDate(ymd);
      if (!dt) return;
      const monthKey = `${MONTHS_FULL[dt.getMonth()]} ${dt.getFullYear()}`;
      if (monthKey !== lastMonthKey) {
        if (lastMonthKey !== '') {
          htmlParts.push(`<div class="gcal-month-divider">${monthKey}</div>`);
        }
        lastMonthKey = monthKey;
      }

      const isToday = ymd === todayYmd;
      const dayItems = byDate[ymd] || [];
      const cardsHtml = dayItems.map(item => this.buildScheduleCardHtml(item)).join('');
      const nowLineHtml = isToday
        ? `<div class="gcal-now-line" aria-hidden="true"><span class="gcal-now-dot"></span><span class="gcal-now-bar"></span></div>`
        : '';
      const emptyTodayGhost = (isToday && dayItems.length === 0)
        ? `<button type="button" class="gcal-today-ghost" onclick="planner.openNewEventModal('${todayYmd}')">+ Nothing planned for today — tap to add an event</button>`
        : '';

      htmlParts.push(`
        <div class="gcal-day-row" id="gcal-day-${ymd}">
          <div class="gcal-date-gutter ${isToday ? 'gcal-day-gutter-today' : ''}">
            <div class="gcal-weekday">${WEEKDAYS_UPPER[dt.getDay()]}</div>
            <div class="gcal-day-num">${dt.getDate()}</div>
          </div>
          <div class="gcal-events-col">
            ${nowLineHtml}
            ${cardsHtml || emptyTodayGhost}
          </div>
        </div>
      `);
    });

    container.innerHTML = htmlParts.join('');
  },

  /** Render Full Interactive Month View with selected day agenda underneath. */
  renderMonthView(scheduled) {
    const container = document.getElementById('gcal-full-month');
    if (!container) return;

    const list = scheduled || this.getPartitionedItems().scheduled;
    const byDate = this.groupEventsByDate(list);
    const d = this.activeMonthDate || new Date();
    const gridHtml = this.buildMonthGridHtml(d.getFullYear(), d.getMonth(), byDate, { mode: 'full' });

    const selYmd = this.selectedMonthDay || this.getTodayYmd();
    const selDate = this.parseLocalDate(selYmd);
    const selLabel = selDate
      ? `${WEEKDAYS_UPPER[selDate.getDay()]}, ${selDate.getDate()} ${MONTHS_SHORT[selDate.getMonth()]}`
      : selYmd;
    const selEvents = byDate[selYmd] || [];
    const selCardsHtml = selEvents.length > 0
      ? selEvents.map(ev => this.buildScheduleCardHtml(ev)).join('')
      : `<button type="button" class="gcal-today-ghost" onclick="planner.openNewEventModal('${selYmd}')">+ Add event on ${selLabel}</button>`;

    container.innerHTML = `
      ${gridHtml}
      <div class="gcal-month-day-detail">
        <div class="gcal-month-day-head">
          <h4>${this.escapeHtml(selLabel)}</h4>
          <button type="button" class="btn btn-primary btn-xs" onclick="planner.openNewEventModal('${selYmd}')">+ Add</button>
        </div>
        <div class="gcal-events-col">${selCardsHtml}</div>
      </div>
    `;
  },

  /** Render Bucket List view cards cleanly. */
  renderBucketList(bucket) {
    const container = document.getElementById('bucket-list');
    const emptyEl = document.getElementById('bucket-empty');
    if (!container) return;

    if (!bucket || bucket.length === 0) {
      container.innerHTML = '';
      if (emptyEl) emptyEl.classList.remove('hidden');
      return;
    }

    if (emptyEl) emptyEl.classList.add('hidden');
    container.innerHTML = bucket.map(item => {
      const idAttr = this.escapeHtml(item.id);
      const evIdAttr = this.escapeHtml(item.event_id);
      const safeTitle = this.escapeHtml(item.title || 'Saved Activity');
      const safeTitleJs = this.escapeJsInAttr(item.title || '');
      const loc = item.location_name || item.location || 'Brisbane';
      const mapsUrl = `https://maps.apple.com/?q=${encodeURIComponent((item.title || '') + ' ' + loc)}`;
      const bgStyle = item.image_url
        ? `background-image:url('${this.escapeHtml(item.image_url)}')`
        : 'background:linear-gradient(135deg,#5c6bc0 0%,#0b57d0 100%)';

      return `
        <div class="bucket-card">
          <div class="bucket-card-img" style="${bgStyle}">
            <span class="bucket-cat-pill">${this.escapeHtml(item.category || 'Date Idea')}</span>
          </div>
          <div class="bucket-card-body">
            <h4>${safeTitle}</h4>
            <p class="bucket-meta">
              <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="venue-map-link">📍 ${this.escapeHtml(loc)} ↗</a>
              · ${this.escapeHtml(item.price_str || '$$')}
            </p>
            ${item.source_url ? `<a href="${this.escapeHtml(item.source_url)}" target="_blank" rel="noopener noreferrer" class="bucket-web-link">🔗 Official Page ↗</a>` : ''}
            <div class="bucket-card-actions">
              <button type="button" class="btn btn-primary btn-sm flex-1" onclick="planner.openScheduleModal('${evIdAttr}', '${safeTitleJs}', '${idAttr}')">
                📅 Pick Date
              </button>
              <button type="button" class="btn-icon-del" onclick="planner.deleteItem('${idAttr}')" title="Remove from bucket list">🗑️</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  /** Render Completed Couple Memories cards cleanly. */
  renderMemories(memories) {
    const container = document.getElementById('memories-list');
    const emptyEl = document.getElementById('memories-empty');
    if (!container) return;

    if (!memories || memories.length === 0) {
      container.innerHTML = '';
      if (emptyEl) emptyEl.classList.remove('hidden');
      return;
    }

    if (emptyEl) emptyEl.classList.add('hidden');
    container.innerHTML = memories.map(item => {
      const idAttr = this.escapeHtml(item.id);
      const dt = this.parseLocalDate(item.scheduled_date);
      const dateStr = dt ? `${dt.getDate()} ${MONTHS_SHORT[dt.getMonth()]} ${dt.getFullYear()}` : 'Completed Date';
      return `
        <div class="memory-card-item">
          <div class="memory-card-header">
            <span class="memory-badge">📸 Done · ${this.escapeHtml(dateStr)}</span>
            <button type="button" class="btn-icon-del" onclick="planner.deleteItem('${idAttr}')" title="Remove memory">🗑️</button>
          </div>
          <h4>${this.escapeHtml(item.title || 'Special Memory')}</h4>
          <p class="memory-loc">📍 ${this.escapeHtml(item.location_name || item.location || 'Brisbane')}</p>
          ${item.notes ? `<div class="memory-notes">💭 "${this.escapeHtml(item.notes)}"</div>` : ''}
        </div>
      `;
    }).join('');
  },

  /** Open Google Calendar Event Details bottom-sheet modal for any scheduled item. */
  openEventDetail(plannerId) {
    const item = this.items.find(i => String(i.id) === String(plannerId));
    if (!item) return;

    this.activeDetailId = item.id;
    const modal = document.getElementById('gcal-detail-modal');
    const body = document.getElementById('gcal-detail-body');
    if (!modal || !body) return;

    const theme = this.getEventColorTheme(item);
    const dt = this.parseLocalDate(item.scheduled_date);
    const dateLine = dt
      ? `${WEEKDAYS_UPPER[dt.getDay()]}, ${dt.getDate()} ${MONTHS_FULL[dt.getMonth()]} ${dt.getFullYear()}`
      : 'Unscheduled';
    const timeRange = this.formatGCalTimeRange(item);
    const loc = item.location_name || item.location || '';
    const mapsUrl = loc ? `https://maps.apple.com/?q=${encodeURIComponent((item.title || '') + ' ' + loc)}` : '';
    const gcalUrl = this.buildGoogleCalendarUrl(item);
    const safeId = this.escapeHtml(item.id);
    const safeEvId = this.escapeHtml(item.event_id);
    const safeTitleJs = this.escapeJsInAttr(item.title || '');

    const toolbarHtml = `
      <div class="gcal-detail-toolbar">
        <button type="button" class="gcal-detail-icon-btn" onclick="planner.closeEventDetail(); planner.openScheduleModal('${safeEvId}', '${safeTitleJs}', '${safeId}')" title="Edit event">✏️</button>
        <button type="button" class="gcal-detail-icon-btn" onclick="planner.deleteItem('${safeId}')" title="Delete event">🗑️</button>
        <button type="button" class="gcal-detail-icon-btn" onclick="planner.closeEventDetail()" title="Close">&times;</button>
      </div>
    `;

    const bannerHtml = item.image_url
      ? `<div class="gcal-detail-banner" style="background-image:url('${this.escapeHtml(item.image_url)}')">${toolbarHtml}</div>`
      : toolbarHtml;

    body.innerHTML = `
      ${bannerHtml}
      <div class="gcal-detail-content">
        <div class="gcal-detail-title-row">
          <span class="gcal-detail-color-sq" style="background:${theme.bg}"></span>
          <div>
            <h3 class="gcal-detail-title">${this.escapeHtml(item.title || 'Event')}</h3>
            <div class="gcal-detail-subtitle">${this.escapeHtml(dateLine)} &middot; ${this.escapeHtml(timeRange)}</div>
          </div>
        </div>

        <div class="gcal-detail-meta-list">
          ${loc ? `<div class="gcal-detail-meta-row"><span>📍</span><a href="${mapsUrl}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(loc)} (Open Maps ↗)</a></div>` : ''}
          ${item.source_url ? `<div class="gcal-detail-meta-row"><span>🔗</span><a href="${this.escapeHtml(item.source_url)}" target="_blank" rel="noopener noreferrer">Official Event / Website ↗</a></div>` : ''}
          ${item.notes ? `<div class="gcal-detail-meta-row"><span>📝</span><span>${this.escapeHtml(item.notes)}</span></div>` : ''}
          ${item.budget ? `<div class="gcal-detail-meta-row"><span>💰</span><span>Estimated Budget: $${this.escapeHtml(item.budget)}</span></div>` : ''}
          <div class="gcal-detail-meta-row">
            <span>🗓️</span>
            <a href="${gcalUrl}" target="_blank" rel="noopener noreferrer">Add to Google Calendar app ↗</a>
          </div>
        </div>

        <div class="gcal-detail-actions">
          <button type="button" class="btn btn-primary btn-sm" onclick="planner.markCompleted('${safeId}')">✅ We Did This!</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="planner.closeEventDetail(); planner.openScheduleModal('${safeEvId}', '${safeTitleJs}', '${safeId}')">✏️ Edit Time / Date</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="planner.moveToBucketList('${safeId}')">💡 Bucket List</button>
        </div>
      </div>
    `;

    modal.classList.remove('hidden');
  },

  /** Close Event Detail modal. */
  closeEventDetail() {
    this.activeDetailId = null;
    const modal = document.getElementById('gcal-detail-modal');
    if (modal) modal.classList.add('hidden');
  },

  /** Highlight selected swatch inside Schedule / Create modal. */
  selectScheduleColor(colorKey) {
    const validKey = GCAL_THEMES[colorKey] ? colorKey : 'blueberry';
    const hidden = document.getElementById('sched-color');
    if (hidden) hidden.value = validKey;
    document.querySelectorAll('#sched-color-swatches .gcal-swatch').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.color === validKey);
    });
  },

  /** Keep time input synced when user switches time-slot dropdown. */
  onSlotChange(slot) {
    const timeEl = document.getElementById('sched-time');
    if (timeEl && SLOT_DEFAULT_TIMES[slot]) {
      timeEl.value = SLOT_DEFAULT_TIMES[slot];
    }
  },

  /** Keep slot dropdown synced when user edits exact start time. */
  onTimeChange(hhmm) {
    const slotEl = document.getElementById('sched-slot');
    if (slotEl && hhmm) {
      slotEl.value = this.deriveSlotFromTime(hhmm);
    }
  },

  /** Open Schedule Modal directly in "+ New Personal Event" create mode. */
  openNewEventModal(defaultDateStr) {
    const modal = document.getElementById('schedule-modal');
    if (!modal) return;

    const targetDate = (defaultDateStr && /^\d{4}-\d{2}-\d{2}$/.test(defaultDateStr))
      ? defaultDateStr
      : (this.selectedMonthDay || this.getTodayYmd());

    const headingEl = document.getElementById('sched-modal-heading');
    if (headingEl) headingEl.textContent = 'New Event';

    document.getElementById('sched-event-id').value = '';
    document.getElementById('sched-planner-id').value = '';

    const staticGroup = document.getElementById('sched-static-title-group');
    const customFields = document.getElementById('sched-custom-fields');
    if (staticGroup) staticGroup.classList.add('hidden');
    if (customFields) customFields.classList.remove('hidden');

    const titleInp = document.getElementById('sched-title-input');
    const locInp = document.getElementById('sched-location-input');
    if (titleInp) titleInp.value = '';
    if (locInp) locInp.value = '';

    document.getElementById('sched-date').value = targetDate;
    document.getElementById('sched-slot').value = 'afternoon';
    const timeEl = document.getElementById('sched-time');
    const durEl = document.getElementById('sched-duration');
    if (timeEl) timeEl.value = '12:00';
    if (durEl) durEl.value = '90';
    document.getElementById('sched-notes').value = '';
    document.getElementById('sched-budget').value = '';
    this.selectScheduleColor('blueberry');

    const hintEl = document.getElementById('sched-event-when-hint');
    if (hintEl) hintEl.classList.add('hidden');

    modal.classList.remove('hidden');
    if (titleInp) setTimeout(() => titleInp.focus(), 40);
  },

  /** Open Schedule Modal for scheduling/editing an existing catalog event or item. */
  openScheduleModal(eventId, eventTitle, plannerId = null) {
    const modal = document.getElementById('schedule-modal');
    if (!modal) return;

    const headingEl = document.getElementById('sched-modal-heading');
    const staticGroup = document.getElementById('sched-static-title-group');
    const customFields = document.getElementById('sched-custom-fields');

    const existing = plannerId
      ? this.items.find(i => String(i.id) === String(plannerId))
      : this.getItemForEvent(eventId);
    const catalogEv = this.findEvent(eventId);
    const ev = catalogEv || existing || {};
    const isPersonal = Boolean(existing?.is_personal || !catalogEv);

    document.getElementById('sched-event-id').value = eventId || existing?.event_id || '';
    document.getElementById('sched-planner-id').value = existing?.id || plannerId || '';

    if (headingEl) headingEl.textContent = existing ? 'Edit Calendar Event' : 'Schedule Activity';

    if (isPersonal && existing) {
      if (staticGroup) staticGroup.classList.add('hidden');
      if (customFields) customFields.classList.remove('hidden');
      const titleInp = document.getElementById('sched-title-input');
      const locInp = document.getElementById('sched-location-input');
      if (titleInp) titleInp.value = eventTitle || existing.title || '';
      if (locInp) locInp.value = existing.location_name || existing.location || '';
    } else {
      if (staticGroup) staticGroup.classList.remove('hidden');
      if (customFields) customFields.classList.add('hidden');
      document.getElementById('sched-event-title').textContent = eventTitle || ev.title || 'Couple Plan';
    }

    const defaultDate = existing?.scheduled_date || ev.start_date || this.selectedMonthDay || this.getTodayYmd();
    document.getElementById('sched-date').value = defaultDate;

    const startTime = existing ? this.getStartTime24(existing) : this.getStartTime24(ev);
    const timeEl = document.getElementById('sched-time');
    const durEl = document.getElementById('sched-duration');
    if (timeEl) timeEl.value = startTime;
    if (durEl) {
      durEl.value = (existing?.all_day || String(existing?.duration_mins) === 'all_day')
        ? 'all_day'
        : String(existing?.duration_mins || 120);
    }

    document.getElementById('sched-slot').value = existing?.time_slot || this.deriveSlotFromTime(startTime);
    document.getElementById('sched-notes').value = existing?.notes || '';
    document.getElementById('sched-budget').value = existing?.budget || '';
    this.selectScheduleColor(existing?.color || this.getEventColorTheme(ev).key || 'blueberry');

    const hintEl = document.getElementById('sched-event-when-hint');
    if (hintEl) {
      if (ev.time_str) {
        hintEl.textContent = `Official event schedule: ${ev.time_str}`;
        hintEl.classList.remove('hidden');
      } else {
        hintEl.classList.add('hidden');
      }
    }

    modal.classList.remove('hidden');
  },

  /** Close Schedule / Create modal. */
  closeScheduleModal() {
    const modal = document.getElementById('schedule-modal');
    if (modal) modal.classList.add('hidden');
  },

  /** Persist Schedule / Create form submission across local, API, and Cloud Firestore. */
  async submitSchedule(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (this.isSaving) return;

    const eventId = document.getElementById('sched-event-id')?.value || '';
    const plannerId = document.getElementById('sched-planner-id')?.value || '';
    const customFieldsVisible = !document.getElementById('sched-custom-fields')?.classList.contains('hidden');
    const customTitle = document.getElementById('sched-title-input')?.value?.trim() || '';
    const customLocation = document.getElementById('sched-location-input')?.value?.trim() || '';
    const date = document.getElementById('sched-date')?.value || this.getTodayYmd();
    const slot = document.getElementById('sched-slot')?.value || 'evening';
    const timeVal = document.getElementById('sched-time')?.value || SLOT_DEFAULT_TIMES[slot] || '18:30';
    const durRaw = document.getElementById('sched-duration')?.value || '90';
    const isAllDay = durRaw === 'all_day';
    const durationMins = isAllDay ? null : (parseInt(durRaw, 10) || 90);
    const color = document.getElementById('sched-color')?.value || 'blueberry';
    const notes = document.getElementById('sched-notes')?.value?.trim() || '';
    const budget = document.getElementById('sched-budget')?.value || '';

    if (customFieldsVisible && !plannerId && !customTitle) {
      if (typeof app !== 'undefined' && app.showToast) app.showToast('Please enter an event title', 'error');
      return;
    }

    this.isSaving = true;
    try {
      if (!plannerId && !eventId) {
        await this.addPersonalPlan({
          title: customTitle || 'New Event',
          scheduled_date: date,
          scheduled_time: timeVal,
          duration_mins: durationMins,
          all_day: isAllDay,
          color,
          time_slot: slot,
          location: customLocation,
          notes,
          budget
        });
      } else if (plannerId) {
        const changes = {
          status: 'scheduled',
          scheduled_date: date,
          scheduled_time: timeVal,
          duration_mins: durationMins,
          all_day: isAllDay,
          color,
          style: color === 'outline' ? 'outline' : 'solid',
          time_slot: slot,
          notes,
          budget
        };
        if (customFieldsVisible && customTitle) changes.title = customTitle;
        if (customFieldsVisible) {
          changes.location_name = customLocation;
          changes.location = customLocation;
        }
        await api.updatePlanner(plannerId, changes);
        if (typeof firebaseService !== 'undefined' && firebaseService.updatePlannerItem) {
          await firebaseService.updatePlannerItem(plannerId, changes).catch(() => {});
        }
      } else {
        const existingItem = this.getItemForEvent(eventId);
        if (existingItem) {
          const changes = {
            status: 'scheduled',
            scheduled_date: date,
            scheduled_time: timeVal,
            duration_mins: durationMins,
            all_day: isAllDay,
            color,
            time_slot: slot,
            notes,
            budget
          };
          await api.updatePlanner(existingItem.id, changes);
          if (typeof firebaseService !== 'undefined' && firebaseService.updatePlannerItem) {
            await firebaseService.updatePlannerItem(existingItem.id, changes).catch(() => {});
          }
        } else {
          const ev = this.findEvent(eventId) || {};
          const payload = {
            event_id: eventId,
            title: ev.title || 'Scheduled Activity',
            status: 'scheduled',
            scheduled_date: date,
            scheduled_time: timeVal,
            duration_mins: durationMins,
            all_day: isAllDay,
            color,
            time_slot: slot,
            notes,
            budget
          };
          const res = await api.addToPlanner(payload);
          if (typeof firebaseService !== 'undefined' && firebaseService.savePlannerItem && res?.item) {
            await firebaseService.savePlannerItem(res.item).catch(() => {});
          }
        }
      }

      this.closeScheduleModal();
      const dt = this.parseLocalDate(date);
      if (dt) {
        this.activeMonthDate = new Date(dt.getFullYear(), dt.getMonth(), 1);
        this.selectedMonthDay = date;
      }
      await this.loadPlanner();
      if (typeof discover !== 'undefined' && discover.loadEvents) discover.loadEvents(false);
      if (typeof app !== 'undefined' && app.showToast) app.showToast('Saved to calendar!', 'success');
    } catch (err) {
      console.error('Failed saving schedule:', err);
      if (typeof app !== 'undefined' && app.showToast) app.showToast('Could not save event', 'error');
    } finally {
      this.isSaving = false;
    }
  },

  /** Add a custom personal plan / calendar event directly into Shared Planner. */
  async addPersonalPlan({
    title,
    scheduled_date,
    time_slot = 'evening',
    location = '',
    notes = '',
    scheduled_time = null,
    duration_mins = 90,
    all_day = false,
    color = 'blueberry',
    budget = ''
  }) {
    const cleanTitle = (title || '').trim();
    if (!cleanTitle) return null;

    const cleanDate = scheduled_date || this.getTodayYmd();
    const resolvedTime = scheduled_time || SLOT_DEFAULT_TIMES[time_slot] || '18:30';
    const personalId = `personal-${Date.now()}`;
    const itemPayload = {
      id: Date.now(),
      event_id: personalId,
      title: cleanTitle,
      description: notes || '',
      category: 'Personal',
      location_name: location || '',
      location: location || '',
      status: 'scheduled',
      scheduled_date: cleanDate,
      scheduled_time: resolvedTime,
      duration_mins: all_day ? null : duration_mins,
      all_day: Boolean(all_day),
      color: color || 'blueberry',
      style: color === 'outline' ? 'outline' : 'solid',
      time_slot: time_slot || this.deriveSlotFromTime(resolvedTime),
      notes: notes || '',
      budget: budget || '',
      image_url: '',
      is_personal: true,
      created_at: new Date().toISOString()
    };

    const res = await api.addToPlanner(itemPayload);
    const savedItem = res?.item || itemPayload;
    if (typeof firebaseService !== 'undefined' && firebaseService.savePlannerItem) {
      await firebaseService.savePlannerItem(savedItem).catch(() => {});
    }
    await this.loadPlanner();
    return savedItem;
  },

  /** Quick schedule helper kept for compatibility. */
  async scheduleEvent(eventId, scheduledDate, timeSlot = 'evening') {
    const ev = this.findEvent(eventId) || {};
    const res = await api.addToPlanner({
      event_id: eventId,
      title: ev.title || 'Scheduled Activity',
      status: 'scheduled',
      scheduled_date: scheduledDate || this.getTodayYmd(),
      time_slot: timeSlot
    });
    if (typeof firebaseService !== 'undefined' && firebaseService.savePlannerItem && res?.item) {
      await firebaseService.savePlannerItem(res.item).catch(() => {});
    }
    await this.loadPlanner();
    return res;
  },

  /** Mark a scheduled item completed and archive it into Memories. */
  async markCompleted(id) {
    const changes = { status: 'completed', completed_at: new Date().toISOString() };
    await api.updatePlanner(id, changes);
    if (typeof firebaseService !== 'undefined' && firebaseService.updatePlannerItem) {
      await firebaseService.updatePlannerItem(id, changes).catch(() => {});
    }
    this.closeEventDetail();
    await this.loadPlanner();
    if (typeof discover !== 'undefined' && discover.loadEvents) discover.loadEvents(false);
    if (typeof app !== 'undefined' && app.showToast) app.showToast('Saved to Couple Memories!', 'success');
  },

  /** Move a scheduled event back into the unscheduled Bucket List. */
  async moveToBucketList(id) {
    const changes = { status: 'bucket_list' };
    await api.updatePlanner(id, changes);
    if (typeof firebaseService !== 'undefined' && firebaseService.updatePlannerItem) {
      await firebaseService.updatePlannerItem(id, changes).catch(() => {});
    }
    this.closeEventDetail();
    await this.loadPlanner();
    if (typeof discover !== 'undefined' && discover.loadEvents) discover.loadEvents(false);
    if (typeof app !== 'undefined' && app.showToast) app.showToast('Moved to Bucket List', 'info');
  },

  /** Permanently remove an item from the planner. */
  async deleteItem(id) {
    await api.deletePlannerItem(id);
    if (typeof firebaseService !== 'undefined' && firebaseService.deletePlannerItem) {
      await firebaseService.deletePlannerItem(id).catch(() => {});
    }
    this.closeEventDetail();
    await this.loadPlanner();
    if (typeof discover !== 'undefined' && discover.loadEvents) discover.loadEvents(false);
    if (typeof app !== 'undefined' && app.showToast) app.showToast('Removed from calendar', 'info');
  },

  /** Find catalog event across live, preloaded, or local caches. */
  findEvent(eventId) {
    if (!eventId) return null;
    const pool = (typeof discover !== 'undefined' && discover.getAllEventsPool)
      ? discover.getAllEventsPool()
      : (typeof app !== 'undefined' && Array.isArray(app.events) ? app.events : []);
    return pool.find(e => e && String(e.id) === String(eventId)) || null;
  },

  /** Lookup existing planner record for a given catalog event ID. */
  getItemForEvent(eventId) {
    if (!eventId) return null;
    return this.items.find(i => String(i.event_id) === String(eventId)) || null;
  },

  /** Export scheduled items as an .ics file compatible with Google / Apple Calendar. */
  exportCalendar() {
    const { scheduledAll } = this.getPartitionedItems();
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//TwoDo//Couple Calendar//EN',
      'CALSCALE:GREGORIAN'
    ];

    scheduledAll.forEach(item => {
      const bounds = this.computeEventDateTimeBounds(item);
      if (!bounds) return;

      lines.push(
        'BEGIN:VEVENT',
        `UID:twodo-${item.id}@twodoapp.web.app`,
        bounds.isAllDay ? `DTSTART;VALUE=DATE:${bounds.dtStart}` : `DTSTART:${bounds.dtStart}`,
        bounds.isAllDay ? `DTEND;VALUE=DATE:${bounds.dtEnd}` : `DTEND:${bounds.dtEnd}`,
        `SUMMARY:${String(item.title || 'TwoDo Plan').replace(/[\r\n]/g, ' ')}`,
        `LOCATION:${String(item.location_name || item.location || '').replace(/[\r\n]/g, ' ')}`,
        `DESCRIPTION:${String(item.notes || '').replace(/[\r\n]/g, ' ')}`,
        'END:VEVENT'
      );
    });

    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'twodo-calendar.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    if (typeof app !== 'undefined' && app.showToast) app.showToast('Downloaded twodo-calendar.ics!', 'success');
  },

  /** Copy formatted schedule & bucket list summary to clipboard. */
  async copySummary() {
    const { scheduledAll, bucket } = this.getPartitionedItems();
    const lines = ['TwoDo Calendar Summary', ''];
    if (scheduledAll.length > 0) {
      lines.push('Scheduled:');
      scheduledAll.forEach(item => {
        lines.push(`• ${item.scheduled_date || 'TBD'} (${this.formatGCalTimeRange(item)}): ${item.title}${item.location_name ? ` @ ${item.location_name}` : ''}`);
      });
      lines.push('');
    }
    if (bucket.length > 0) {
      lines.push('Bucket List:');
      bucket.forEach(item => {
        lines.push(`• ${item.title}`);
      });
    }
    const text = lines.join('\n').trim() || 'No plans added yet.';
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        if (typeof app !== 'undefined' && app.showToast) app.showToast('Calendar summary copied!', 'success');
      }
    } catch (e) {
      if (typeof app !== 'undefined' && app.showToast) app.showToast('Could not copy summary', 'error');
    }
  }
};

if (typeof window !== 'undefined') {
  window.planner = planner;
}

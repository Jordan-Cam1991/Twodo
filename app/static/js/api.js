/**
 * TwoDo API Client
 * Clean REST communication with the Python backend.
 */
const api = {
  baseUrl: '',

  async getProfile() {
    const res = await fetch(`${this.baseUrl}/api/profile`);
    return await res.json();
  },

  async updateProfile(data) {
    const res = await fetch(`${this.baseUrl}/api/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return await res.json();
  },

  async getEvents(params = {}) {
    const qs = new URLSearchParams();
    if (params.city) qs.append('city', params.city);
    if (params.category && params.category !== 'All') qs.append('category', params.category);
    if (params.search) qs.append('search', params.search);
    if (params.filter && params.filter !== 'all') qs.append('filter', params.filter);
    if (params.date_range && params.date_range !== 'all') qs.append('date_range', params.date_range);
    if (params.custom_start) qs.append('custom_start', params.custom_start);
    if (params.custom_end) qs.append('custom_end', params.custom_end);
    if (params.suburb && params.suburb !== 'All') qs.append('suburb', params.suburb);
    if (params.vibe && params.vibe !== 'All') qs.append('vibe', params.vibe);

    const res = await fetch(`${this.baseUrl}/api/events?${qs.toString()}`);
    return await res.json();
  },

  async refreshEvents(city, lat = null, lng = null) {
    const res = await fetch(`${this.baseUrl}/api/events/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city, lat, lng })
    });
    return await res.json();
  },

  async vote(eventId, userName, vote) {
    const res = await fetch(`${this.baseUrl}/api/votes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id: eventId, user_name: userName, vote })
    });
    return await res.json();
  },

  async getPlanner() {
    const res = await fetch(`${this.baseUrl}/api/planner`);
    return await res.json();
  },

  async addToPlanner(payload) {
    const res = await fetch(`${this.baseUrl}/api/planner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  },

  async updatePlanner(id, payload) {
    const res = await fetch(`${this.baseUrl}/api/planner/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  },

  async deletePlannerItem(id) {
    const res = await fetch(`${this.baseUrl}/api/planner/${id}`, {
      method: 'DELETE'
    });
    return await res.json();
  },

  async addCustomEvent(data) {
    const res = await fetch(`${this.baseUrl}/api/events/custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return await res.json();
  },

  async getSummary() {
    const res = await fetch(`${this.baseUrl}/api/export/summary`);
    return await res.json();
  },

  exportCalendarUrl() {
    return `${this.baseUrl}/api/export/ics`;
  }
};

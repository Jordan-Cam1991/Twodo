/**
 * TwoDo Interactive Map Module
 * Uses Leaflet.js with fallback for offline environments.
 */
const mapView = {
  map: null,
  markersLayer: null,

  init() {
    if (this.map) return;
    const mapEl = document.getElementById('leaflet-map');
    if (!mapEl || typeof L === 'undefined') return;

    try {
      // Default to Brisbane or current city
      this.map = L.map('leaflet-map').setView([-27.4698, 153.0251], 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(this.map);

      this.markersLayer = L.layerGroup().addTo(this.map);
      this.renderMarkers();
    } catch (e) {
      console.warn('Map initialization skipped (likely offline tile server):', e);
      if (mapEl) {
        mapEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-weight:600;padding:2rem;text-align:center;">Interactive map is ready. Connect to internet for live OpenStreetMap satellite tiles.</div>';
      }
    }
  },

  renderMarkers() {
    // Filter events matching active filters
    const allEvents = app.events || [];
    const filteredEvents = allEvents.filter(ev => {
      if (typeof discover !== 'undefined') {
        // Suburb filter
        if (discover.selectedSuburbs && discover.selectedSuburbs.length > 0) {
          const matchSub = discover.selectedSuburbs.some(s => (ev.location_name || '').toLowerCase().includes(s.toLowerCase()));
          if (!matchSub) return false;
        }
        // Category filter
        if (discover.selectedCategories && discover.selectedCategories.length > 0) {
          const matchCat = discover.selectedCategories.some(c => (ev.category || '').toLowerCase() === c.toLowerCase());
          if (!matchCat) return false;
        }
        // Vibe filter
        if (discover.selectedVibes && discover.selectedVibes.length > 0) {
          const matchVibe = discover.selectedVibes.some(v => (ev.tags || []).some(t => t.toLowerCase() === v.toLowerCase()));
          if (!matchVibe) return false;
        }
      }
      return true;
    });

    // Update filter status text & clear button
    const statusEl = document.getElementById('map-filter-status');
    const clearBtn = document.getElementById('map-btn-clear-filters');
    const anyFilters = typeof discover !== 'undefined' && (
      (discover.selectedSuburbs && discover.selectedSuburbs.length > 0) ||
      (discover.selectedCategories && discover.selectedCategories.length > 0) ||
      (discover.selectedVibes && discover.selectedVibes.length > 0) ||
      (discover.activeDateRange && discover.activeDateRange !== 'all')
    );

    if (statusEl) {
      if (anyFilters) {
        statusEl.textContent = `📍 Showing ${filteredEvents.length} filtered pins on map`;
      } else {
        statusEl.textContent = `📍 Showing all ${filteredEvents.length} activities on map`;
      }
    }
    if (clearBtn) clearBtn.classList.toggle('hidden', !anyFilters);

    const listEl = document.getElementById('map-events-list');
    if (listEl) {
      if (filteredEvents.length === 0) {
        listEl.innerHTML = `
          <div style="padding:1.5rem; text-align:center; color:var(--text-muted); font-size:0.88rem;">
            No activities match your map filters.<br>
            <button class="btn btn-secondary btn-sm" style="margin-top:0.6rem;" onclick="discover.resetFilters()">Clear Filters</button>
          </div>
        `;
      } else {
        listEl.innerHTML = filteredEvents.map(ev => {
          const u1 = app.profile?.user1_name || 'Emma';
          const u2 = app.profile?.user2_name || 'Jordan';
          let votePill = '';
          if (ev.is_match) {
            votePill = `<span style="display:inline-block; font-size:0.7rem; background:#fee2e2; color:#ef4444; padding:1px 6px; border-radius:9999px; font-weight:700; margin-top:2px;">🎉 Mutual Match</span>`;
          } else if (ev.u1_vote === 'love' || ev.u2_vote === 'love') {
            const lover = ev.u1_vote === 'love' ? u1 : u2;
            votePill = `<span style="display:inline-block; font-size:0.7rem; background:#fce7f3; color:#ec4899; padding:1px 6px; border-radius:9999px; font-weight:700; margin-top:2px;">❤️ ${lover} loves</span>`;
          }

          return `
            <div class="map-list-item" onclick="mapView.panToEvent('${ev.id}')">
              <strong style="font-size:0.88rem; display:block;">${ev.title}</strong>
              <span style="font-size:0.75rem; color:var(--text-muted);">${ev.category} • ${ev.location_name}</span>
              ${votePill}
            </div>
          `;
        }).join('');
      }
    }

    if (!this.map || !this.markersLayer || typeof L === 'undefined') return;

    this.markersLayer.clearLayers();
    const bounds = [];

    filteredEvents.forEach(ev => {
      if (ev.lat && ev.lng) {
        const markerColor = this.getCategoryColor(ev.category);
        const pinEmoji = ev.is_match ? '💖' : '📍';
        const customIcon = L.divIcon({
          className: 'custom-map-pin',
          html: `<div style="background:${markerColor}; width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:white; font-size:14px; border:2px solid white; box-shadow:0 3px 6px rgba(0,0,0,0.3);">${pinEmoji}</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        });

        // Notes and partner feedback in popup
        const u1 = app.profile?.user1_name || 'Emma';
        const u2 = app.profile?.user2_name || 'Jordan';
        let popupNotesHtml = '';
        if (ev.u1_vote === 'love' && ev.u1_note) {
          popupNotesHtml += `<div style="font-size:0.75rem; background:#fff1f2; color:#e11d48; padding:3px 6px; border-radius:6px; margin-bottom:4px;">❤️ <strong>${u1}:</strong> "${ev.u1_note}"</div>`;
        }
        if (ev.u2_vote === 'love' && ev.u2_note) {
          popupNotesHtml += `<div style="font-size:0.75rem; background:#f5f3ff; color:#7c3aed; padding:3px 6px; border-radius:6px; margin-bottom:4px;">💜 <strong>${u2}:</strong> "${ev.u2_note}"</div>`;
        }

        const marker = L.marker([ev.lat, ev.lng], { icon: customIcon });
        const popupContent = `
          <div style="font-family:var(--font-family); min-width:190px;">
            <img src="${ev.image_url}" style="width:100%; height:90px; object-fit:cover; border-radius:6px; margin-bottom:6px;">
            <div style="font-size:0.72rem; font-weight:700; color:var(--primary); text-transform:uppercase;">${ev.category}</div>
            <strong style="font-size:0.95rem; display:block; margin-bottom:4px;">${ev.title}</strong>
            <div style="font-size:0.78rem; color:#64748b; margin-bottom:6px;">${ev.location_name} • ${ev.price_str || ev.price_level}</div>
            ${popupNotesHtml}
            <div style="display:flex; gap:4px; margin-top:6px;">
              <button onclick="planner.openScheduleModal('${ev.id}', '${ev.title.replace(/'/g, "\\'")}', ${ev.planner_id || null})" style="background:#f43f5e; color:white; border:none; padding:5px 8px; border-radius:6px; font-weight:700; font-size:0.75rem; cursor:pointer; flex:1;">
                📅 Plan
              </button>
              <button onclick="chatView.shareEventToChat('${ev.id}')" style="background:#8b5cf6; color:white; border:none; padding:5px 8px; border-radius:6px; font-weight:700; font-size:0.75rem; cursor:pointer;">
                💬 Chat
              </button>
            </div>
          </div>
        `;

        marker.bindPopup(popupContent);
        this.markersLayer.addLayer(marker);
        bounds.push([ev.lat, ev.lng]);
        marker.eventId = ev.id;
      }
    });

    if (bounds.length > 0) {
      try {
        this.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      } catch (err) {}
    }
  },

  panToEvent(eventId) {
    const ev = (app.events || []).find(e => e.id === eventId);
    if (!ev || !ev.lat || !ev.lng || !this.map) return;
    this.map.setView([ev.lat, ev.lng], 15, { animate: true });

    // Open popup if found
    if (this.markersLayer) {
      this.markersLayer.eachLayer(layer => {
        if (layer.eventId === eventId) {
          layer.openPopup();
        }
      });
    }
  },

  getCategoryColor(category) {
    switch (category) {
      case 'Date Night Specials': return '#ec4899';
      case 'Food & Drink': return '#f59e0b';
      case 'Outdoor & Adventure':
      case 'Sightseeing & Nature': return '#10b981';
      case 'Music & Concerts':
      case 'Comedy & Shows':
      case 'Arts & Culture': return '#8b5cf6';
      default: return '#f43f5e';
    }
  }
};

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
    const listEl = document.getElementById('map-events-list');
    if (listEl) {
      listEl.innerHTML = (app.events || []).map(ev => `
        <div class="map-list-item" onclick="mapView.panToEvent('${ev.id}')">
          <strong style="font-size:0.88rem; display:block;">${ev.title}</strong>
          <span style="font-size:0.75rem; color:var(--text-muted);">${ev.category} • ${ev.location_name}</span>
        </div>
      `).join('');
    }

    if (!this.map || !this.markersLayer || typeof L === 'undefined') return;

    this.markersLayer.clearLayers();
    const bounds = [];

    (app.events || []).forEach(ev => {
      if (ev.lat && ev.lng) {
        const markerColor = this.getCategoryColor(ev.category);
        const customIcon = L.divIcon({
          className: 'custom-map-pin',
          html: `<div style="background:${markerColor}; width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:white; font-size:14px; border:2px solid white; box-shadow:0 3px 6px rgba(0,0,0,0.3);">📍</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        });

        const marker = L.marker([ev.lat, ev.lng], { icon: customIcon });
        const popupContent = `
          <div style="font-family:var(--font-family); min-width:180px;">
            <img src="${ev.image_url}" style="width:100%; height:90px; object-fit:cover; border-radius:6px; margin-bottom:6px;">
            <div style="font-size:0.72rem; font-weight:700; color:var(--primary); text-transform:uppercase;">${ev.category}</div>
            <strong style="font-size:0.95rem; display:block; margin-bottom:4px;">${ev.title}</strong>
            <div style="font-size:0.78rem; color:#64748b; margin-bottom:8px;">${ev.location_name} • ${ev.price_str || ev.price_level}</div>
            <button onclick="planner.openScheduleModal('${ev.id}', '${ev.title.replace(/'/g, "\\'")}', ${ev.planner_id || null})" style="background:#f43f5e; color:white; border:none; padding:4px 10px; border-radius:4px; font-weight:700; font-size:0.75rem; cursor:pointer; width:100%;">
              📅 Add to Planner
            </button>
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

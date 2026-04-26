/**
 * TRINETRA — Offline Map Layer v2
 * - Leaflet on a local tactical grid (no remote tile dependency)
 * - Safe-route messages with waypoints rendered as polylines
 * - Interactive route-drawing mode: tap to add waypoints, save as safe-route
 * - All other typed messages render as coloured pins
 */
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getMessages, saveMessage } from '../lib/db.js';
import { generateBundleId } from '../lib/crypto.js';
import { getPeers } from '../lib/webrtc.js';
import { pushMessage } from '../lib/sync.js';
import { bundlesToQR } from '../lib/qr.js';
import { icon } from './icons.js';
import { getBeacons } from '../lib/beacon.js';

// ─── Full-screen Notification ────────────────────────────────────

let _mapFsEl    = null;
let _mapFsTimer = null;

function _showFullscreen(variant, title, subtitle, body) {
  if (_mapFsEl) { clearTimeout(_mapFsTimer); _mapFsEl.remove(); _mapFsEl = null; }

  const isSuccess = variant === 'success';
  const accentColor = isSuccess ? '#00e676' : variant === 'danger' ? '#e02424' : '#f0a500';
  const accentDim   = isSuccess ? 'rgba(0,230,118,0.12)' : variant === 'danger' ? 'rgba(224,36,36,0.12)' : 'rgba(240,165,0,0.12)';
  const checkChar   = isSuccess ? '✓' : variant === 'danger' ? '⚠' : 'ℹ';

  const el = document.createElement('div');
  el.className = 'fs-notif-overlay';
  el.innerHTML = `
    <div class="fs-notif-sheet">
      <div class="fs-notif-icon-ring" style="--accent:${accentColor};--accent-dim:${accentDim};">
        <span class="fs-notif-check">${checkChar}</span>
      </div>
      <div class="fs-notif-title">${_escMap(title)}</div>
      ${subtitle ? `<div class="fs-notif-subtitle">${_escMap(subtitle)}</div>` : ''}
      ${body     ? `<div class="fs-notif-body">${_escMap(body)}</div>`         : ''}
      <button class="fs-notif-close-btn" style="--accent:${accentColor};">OK</button>
    </div>
  `;
  document.body.appendChild(el);
  _mapFsEl = el;

  requestAnimationFrame(() => el.classList.add('fs-show'));

  const close = () => {
    clearTimeout(_mapFsTimer);
    el.classList.replace('fs-show', 'fs-hide');
    setTimeout(() => { if (_mapFsEl === el) _mapFsEl = null; el.remove(); }, 380);
  };
  el.querySelector('.fs-notif-close-btn').addEventListener('click', close);
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
  _mapFsTimer = setTimeout(close, 6000);
}

function _escMap(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let _map          = null;
let _markerLayer  = null;
let _routeLayer   = null;
let _beaconLayer  = null;
let _tileLayer    = null;
let _tileKey      = 'dark';
let _watchId      = null;
let _selfMarker   = null;
let _followMe     = false;

// ─── Offline tactical grid (canvas GridLayer — no internet needed) ─
// Always sits at the bottom of the layer stack. Real map tiles load on
// top of it when online. When offline this is what the user sees instead
// of a blank black screen.

const _TacticalGrid = L.GridLayer.extend({
  createTile(coords) {
    const tile = document.createElement('canvas');
    const sz   = this.getTileSize();
    tile.width  = sz.x;
    tile.height = sz.y;
    const ctx = tile.getContext('2d');

    // Base fill — deep tactical green-black
    ctx.fillStyle = '#06100a';
    ctx.fillRect(0, 0, sz.x, sz.y);

    // Subtle dot grid every 16 px
    ctx.fillStyle = 'rgba(0,220,100,0.055)';
    for (let x = 0; x <= sz.x; x += 16) {
      for (let y = 0; y <= sz.y; y += 16) {
        ctx.fillRect(x, y, 1, 1);
      }
    }

    // Major grid lines every 64 px
    ctx.strokeStyle = 'rgba(0,230,118,0.10)';
    ctx.lineWidth = 0.7;
    for (let x = 0; x <= sz.x; x += 64) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, sz.y); ctx.stroke();
    }
    for (let y = 0; y <= sz.y; y += 64) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(sz.x, y); ctx.stroke();
    }

    // Tile grid-ref label at low zoom (spatial orientation)
    if (coords.z <= 9) {
      ctx.fillStyle = 'rgba(0,230,118,0.22)';
      ctx.font = 'bold 8px "Courier New",monospace';
      ctx.fillText(`${coords.x}/${coords.y}`, 5, 14);
    }

    return tile;
  },
});

// ─── Tile layer definitions ───────────────────────────────────────

const TILE_LAYERS = {
  dark: {
    label: 'Dark',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    options: {
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OSM</a> © <a href="https://carto.com/" target="_blank">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19,
    },
  },
  standard: {
    label: 'Map',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: {
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
      maxZoom: 19,
    },
  },
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: {
      attribution: '© <a href="https://www.esri.com" target="_blank">Esri</a>',
      maxZoom: 19,
    },
  },
};

const TILE_CYCLE = ['dark', 'standard', 'satellite'];

function _applyTileLayer(key) {
  if (!_map) return;
  const cfg = TILE_LAYERS[key];
  if (!cfg) return;
  if (_tileLayer) { _tileLayer.remove(); _tileLayer = null; }
  _tileLayer = L.tileLayer(cfg.url, cfg.options).addTo(_map);
  _tileKey = key;
}

// Route-drawing state
let _drawingMode    = false;
let _drawnWaypoints = [];   // [[lat, lng], …]
let _drawPolyline   = null;
let _drawMarkers    = [];

const PIN_CFG = {
  shelter:      { color: '#af52de', label: 'Shelter'    },
  'safe-route': { color: '#34c759', label: 'Safe Route' },
  emergency:    { color: '#ff2d55', label: 'Emergency'  },
  alert:        { color: '#ffd60a', label: 'Alert'      },
  medical:      { color: '#5ac8fa', label: 'Medical'    },
  resource:     { color: '#ff9f0a', label: 'Resource'   },
  info:         { color: '#007aff', label: 'Info'       },
};

function _makePinIcon(color) {
  return L.divIcon({
    className: '',
    html: `<div class="map-pin" style="--pin-c:${color};">
             <div class="map-pin-dot"></div>
             <div class="map-pin-tail"></div>
           </div>`,
    iconSize: [20, 28],
    iconAnchor: [10, 28],
    popupAnchor: [0, -30],
  });
}

function _makeWaypointIcon(color, label) {
  return L.divIcon({
    className: '',
    html: `<div style="width:10px;height:10px;background:${color};border:2px solid #fff;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.5);" title="${label}"></div>`,
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });
}

function _makeDrawWaypointIcon(idx) {
  return L.divIcon({
    className: '',
    html: `<div style="width:12px;height:12px;background:#00e676;border:2px solid #fff;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;font-size:0;"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}

function _makeSelfIcon() {
  return L.divIcon({
    className: '',
    html: `<div class="map-self-pin"><div class="map-self-pulse"></div></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function _makePeerBeaconIcon(alias) {
  const initials = String(alias || '?').slice(0, 2).toUpperCase();
  return L.divIcon({
    className: '',
    html: `<div class="beacon-peer-pin">
             <div class="beacon-peer-pulse"></div>
             <div class="beacon-peer-label">${initials}</div>
           </div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18],
  });
}

function _plotBeacons() {
  if (!_map || !_beaconLayer) return;
  _beaconLayer.clearLayers();
  const beacons = getBeacons();
  for (const b of beacons) {
    const ageS   = Math.floor((Date.now() - b.ts) / 1000);
    const ageStr = ageS < 60 ? `${ageS}s ago` : `${Math.floor(ageS / 60)}m ago`;
    const marker = L.marker([b.lat, b.lng], { icon: _makePeerBeaconIcon(b.alias), zIndexOffset: 800 });
    marker.bindPopup(`
      <div class="map-popup">
        <div class="map-popup-type" style="color:#00e676;">📡 Peer Beacon</div>
        <div class="map-popup-title">${_esc(b.alias || b.shortId)}</div>
        <div class="map-popup-meta">${ageStr} · ${b.lat.toFixed(5)}, ${b.lng.toFixed(5)}</div>
      </div>
    `, { className: 'map-popup-wrap', maxWidth: 220 });
    _beaconLayer.addLayer(marker);
  }
}

// ─── Message plotting ─────────────────────────────────────────────

async function _plotMessages() {
  if (!_map || !_markerLayer) return;
  _markerLayer.clearLayers();

  const now  = Date.now();
  const msgs = (await getMessages()).filter((m) => m.expiresAt > now);

  let pinCount = 0;

  for (const m of msgs) {
    const cfg = PIN_CFG[m.type] || PIN_CFG.info;

    // Safe-route with waypoints → polyline
    if (m.type === 'safe-route' && Array.isArray(m.waypoints) && m.waypoints.length >= 2) {
      _plotRoute(m, cfg);
      pinCount++;
      continue;
    }

    // Regular GPS pin
    if (m.lat != null && m.lng != null) {
      _plotPin(m, cfg);
      pinCount++;
    }
  }

  if (pinCount > 0) {
    const located = msgs.filter((m) => {
      if (m.type === 'safe-route' && Array.isArray(m.waypoints) && m.waypoints.length >= 2) return true;
      return m.lat != null && m.lng != null;
    });
    if (located.length > 0) {
      const bounds = L.latLngBounds(located.flatMap((m) => {
        if (Array.isArray(m.waypoints) && m.waypoints.length > 0) return m.waypoints.map((w) => L.latLng(w[0], w[1]));
        return [[m.lat, m.lng]];
      }));
      _map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
  }

  return pinCount;
}

function _plotPin(m, cfg) {
  const now    = Date.now();
  const age    = Math.floor((now - m.createdAt) / 60_000);
  const ageStr = age < 60 ? `${age}m ago` : `${Math.floor(age/60)}h ago`;
  const hopsStr = m.hops > 0 ? `<div class="map-popup-meta">${m.hops} hop${m.hops !== 1 ? 's' : ''}</div>` : '';
  const partialStr = m.bodyState === 'partial' ? '<div class="map-popup-meta" style="color:var(--amber);">Scoped relay copy</div>' : '';

  const marker = L.marker([m.lat, m.lng], { icon: _makePinIcon(cfg.color) });
  marker.bindPopup(`
    <div class="map-popup">
      <div class="map-popup-type" style="color:${cfg.color};">${cfg.label}</div>
      <div class="map-popup-title">${_esc(m.title)}</div>
      ${m.body ? `<div class="map-popup-body">${_esc(m.body.slice(0, 120))}${m.body.length > 120 ? '…' : ''}</div>` : ''}
      ${partialStr}
      <div class="map-popup-meta">${ageStr}</div>
      ${hopsStr}
    </div>
  `, { className: 'map-popup-wrap', maxWidth: 240 });
  _markerLayer.addLayer(marker);
}

function _plotRoute(m, cfg) {
  const now     = Date.now();
  const age     = Math.floor((now - m.createdAt) / 60_000);
  const ageStr  = age < 60 ? `${age}m ago` : `${Math.floor(age/60)}h ago`;
  const wps     = m.waypoints;
  const hopsStr = m.hops > 0 ? ` · ${m.hops} hop${m.hops !== 1 ? 's' : ''}` : '';

  // Polyline
  const poly = L.polyline(wps, {
    color:   cfg.color,
    weight:  4,
    opacity: 0.85,
    dashArray: null,
  }).addTo(_markerLayer);

  const popupHtml = `
    <div class="map-popup">
      <div class="map-popup-type" style="color:${cfg.color};">${icon('route')} Safe Route</div>
      <div class="map-popup-title">${_esc(m.title)}</div>
      ${m.body ? `<div class="map-popup-body">${_esc(m.body.slice(0, 120))}${m.body.length > 120 ? '…' : ''}</div>` : ''}
      <div class="map-popup-meta">${wps.length} waypoints · ${ageStr}${hopsStr}</div>
    </div>
  `;
  poly.bindPopup(popupHtml, { className: 'map-popup-wrap', maxWidth: 260 });

  // Start marker (filled circle)
  L.marker(wps[0], { icon: _makeWaypointIcon(cfg.color, 'Start') })
    .bindPopup(popupHtml, { className: 'map-popup-wrap', maxWidth: 260 })
    .addTo(_markerLayer);

  // End marker (slightly larger)
  L.marker(wps[wps.length - 1], { icon: _makePinIcon(cfg.color) })
    .bindPopup(popupHtml, { className: 'map-popup-wrap', maxWidth: 260 })
    .addTo(_markerLayer);

  // Intermediate waypoint dots
  for (let i = 1; i < wps.length - 1; i++) {
    L.marker(wps[i], { icon: _makeWaypointIcon(cfg.color, `Waypoint ${i + 1}`) })
      .addTo(_markerLayer);
  }
}

// ─── Geolocation ─────────────────────────────────────────────────

function _startGeolocation(container) {
  if (!navigator.geolocation) return;
  _watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      if (!_map) return;
      if (!_selfMarker) {
        _selfMarker = L.marker([lat, lng], { icon: _makeSelfIcon(), zIndexOffset: 1000 }).addTo(_map);
        _map.setView([lat, lng], 15);
      } else {
        _selfMarker.setLatLng([lat, lng]);
        if (_followMe) _map.panTo([lat, lng], { animate: true, duration: 0.5 });
      }
      const accEl = container.querySelector('#map-accuracy');
      if (accEl) accEl.textContent = `±${Math.round(accuracy)}m`;
    },
    () => {
      const accEl = container.querySelector('#map-accuracy');
      if (accEl) accEl.textContent = 'No GPS';
    },
    { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 }
  );
}

// ─── Route Drawing ────────────────────────────────────────────────

function _enterDrawingMode(container) {
  if (!_map || _drawingMode) return;
  _drawingMode    = true;
  _drawnWaypoints = [];
  _drawPolyline   = null;
  _drawMarkers    = [];

  if (!_routeLayer) {
    _routeLayer = L.layerGroup().addTo(_map);
  }
  _routeLayer.clearLayers();

  // Visual cursor hint
  _map.getContainer().classList.add('map-drawing-mode');

  // Show drawing controls bar
  const ctrlBar = container.querySelector('#draw-ctrl-bar');
  const drawBtn = container.querySelector('#map-draw-btn');
  if (ctrlBar) ctrlBar.classList.remove('hidden');
  if (drawBtn) {
    drawBtn.innerHTML = `${icon('close')} Cancel`;
    drawBtn.style.background = 'rgba(255,45,85,0.18)';
    drawBtn.style.color      = 'var(--red)';
  }

  // Show instruction
  _setDrawStatus(container, 'Tap the map to add waypoints along the route');

  _map.on('click', _onDrawClick.bind(null, container));
}

function _exitDrawingMode(container, save) {
  if (!_drawingMode) return;
  _drawingMode = false;

  _map?.getContainer().classList.remove('map-drawing-mode');
  _map?.off('click', _onDrawClick);

  const ctrlBar = container.querySelector('#draw-ctrl-bar');
  const drawBtn = container.querySelector('#map-draw-btn');
  if (ctrlBar) ctrlBar.classList.add('hidden');
  if (drawBtn) {
    drawBtn.innerHTML = `${icon('draw')} Draw Route`;
    drawBtn.style.background = '';
    drawBtn.style.color      = '';
  }

  if (!save) {
    _routeLayer?.clearLayers();
    _drawnWaypoints = [];
    _drawMarkers    = [];
    _drawPolyline   = null;
  }
}

function _onDrawClick(container, e) {
  const { lat, lng } = e.latlng;
  _drawnWaypoints.push([lat, lng]);
  _refreshDrawLayer(container);
}

function _refreshDrawLayer(container) {
  if (!_routeLayer) return;
  _routeLayer.clearLayers();
  _drawMarkers = [];

  // Draw polyline
  if (_drawnWaypoints.length >= 2) {
    _drawPolyline = L.polyline(_drawnWaypoints, {
      color: '#00e676', weight: 4, opacity: 0.9,
    }).addTo(_routeLayer);
  }

  // Waypoint markers
  _drawnWaypoints.forEach((wp, i) => {
    const m = L.marker(wp, { icon: _makeDrawWaypointIcon(i), zIndexOffset: 500 })
      .addTo(_routeLayer);
    _drawMarkers.push(m);
  });

  const n = _drawnWaypoints.length;
  if (n === 0) {
    _setDrawStatus(container, 'Tap the map to add waypoints');
  } else if (n === 1) {
    _setDrawStatus(container, `1 waypoint — tap to add more (need at least 2)`);
  } else {
    _setDrawStatus(container, `${n} waypoints — tap Save Route when done`);
    // Enable save button
    const saveBtn = container.querySelector('#draw-save-btn');
    if (saveBtn) saveBtn.disabled = false;
  }

  const undoBtn = container.querySelector('#draw-undo-btn');
  if (undoBtn) undoBtn.disabled = n === 0;
}

function _setDrawStatus(container, msg) {
  const el = container.querySelector('#draw-status');
  if (el) el.textContent = msg;
}

// ─── Save Route Dialog ────────────────────────────────────────────

function _showSaveRouteDialog(container) {
  const existing = document.getElementById('save-route-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'save-route-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);display:flex;align-items:flex-end;justify-content:center;padding:0;';

  overlay.innerHTML = `
    <div style="background:var(--bg-elevated);border-radius:var(--radius) var(--radius) 0 0;border:1px solid var(--border-strong);padding:20px 20px 32px;max-width:480px;width:100%;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <span style="font-size:1rem;font-weight:800;color:var(--text);">${icon('route')} Save Safe Route</span>
        <button id="save-route-cancel" style="background:none;border:none;color:var(--text-muted);cursor:pointer;display:flex;">${icon('close')}</button>
      </div>

      <div style="margin-bottom:12px;">
        <label style="display:block;font-size:0.78rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">Route Name</label>
        <input id="route-name-input" class="form-input" maxlength="80"
          placeholder="e.g. Safe passage: Bakery Alley to West Gate"
          style="font-size:0.9rem;" />
      </div>

      <div style="margin-bottom:12px;">
        <label style="display:block;font-size:0.78rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">Notes (optional)</label>
        <textarea id="route-notes-input" class="form-input" rows="2" maxlength="200"
          placeholder="Avoid checkpoints, guards are friendly at waypoint 3…"></textarea>
      </div>

      <div style="margin-bottom:16px;">
        <label style="display:block;font-size:0.78rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">Expires after</label>
        <select id="route-expiry-select" class="form-input">
          <option value="3600000">1 hour</option>
          <option value="14400000" selected>4 hours</option>
          <option value="86400000">24 hours</option>
          <option value="172800000">48 hours</option>
        </select>
      </div>

      <div style="margin-bottom:16px;padding:10px 12px;background:rgba(0,230,118,0.07);border:1px solid rgba(0,230,118,0.2);border-radius:6px;font-size:0.78rem;color:var(--text-muted);line-height:1.5;">
        ${icon('route')} ${_drawnWaypoints.length} waypoints drawn · will show as a green line on all devices that receive this message
      </div>

      <div id="save-route-error" class="hidden text-danger text-sm" style="margin-bottom:10px;"></div>

      <div style="display:flex;gap:10px;">
        <button class="btn btn-secondary" id="save-route-cancel-2" style="flex:1;">Cancel</button>
        <button class="btn btn-secondary" id="save-route-qr-only" style="flex:1;">
          ${icon('qr')} QR Only
        </button>
        <button class="btn btn-primary" id="save-route-confirm" style="flex:2;">
          ${icon('send')} Save &amp; Broadcast
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => { overlay.remove(); };
  overlay.querySelector('#save-route-cancel').addEventListener('click', close);
  overlay.querySelector('#save-route-cancel-2').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  async function _validateAndBuildMsg(overlay) {
    const nameInput   = overlay.querySelector('#route-name-input');
    const notesInput  = overlay.querySelector('#route-notes-input');
    const expiryInput = overlay.querySelector('#route-expiry-select');
    const errEl       = overlay.querySelector('#save-route-error');
    const title   = nameInput.value.trim();
    const notes   = notesInput.value.trim();
    const expiryMs = parseInt(expiryInput.value, 10);
    if (!title) {
      errEl.textContent = 'Route name is required.';
      errEl.classList.remove('hidden');
      nameInput.focus();
      return null;
    }
    if (_drawnWaypoints.length < 2) {
      errEl.textContent = 'Draw at least 2 waypoints first.';
      errEl.classList.remove('hidden');
      return null;
    }
    errEl.classList.add('hidden');
    const now = Date.now();
    const body = notes || `${_drawnWaypoints.length} waypoints.`;
    const id   = await generateBundleId(title + body, now, 'route');
    const [lat, lng] = _drawnWaypoints[0];
    return {
      id, rootId: id, revision: 1, replaces: null,
      type: 'safe-route', priority: 75,
      title, body, bodyPreview: body.slice(0, 160), bodyState: 'full', lat, lng,
      waypoints: _drawnWaypoints.map(([la, ln]) => [parseFloat(la.toFixed(6)), parseFloat(ln.toFixed(6))]),
      createdAt: now, expiresAt: now + expiryMs,
      ttl: 65, hops: 0, seenCount: 1,
      fragments: [], fragmentCount: 0,
      localSessionOwned: true,
    };
  }

  async function _showRouteQR(msg, dialogEl) {
    const sheets = await bundlesToQR([msg]);
    const canvas = sheets[0];
    dialogEl.innerHTML = `
      <div style="text-align:center;padding:8px 0;">
        <div style="margin-bottom:8px;font-size:0.75rem;font-weight:700;color:var(--green);letter-spacing:0.1em;text-transform:uppercase;">${icon('route')} Route QR — show or scan to share</div>
        <div style="display:flex;justify-content:center;margin-bottom:12px;"></div>
        <div style="font-size:0.75rem;color:var(--text-muted);line-height:1.5;margin-bottom:12px;">
          ${_esc(msg.title)}<br>${msg.waypoints.length} waypoints · expires ${new Date(msg.expiresAt).toLocaleTimeString()}
        </div>
        <button class="btn btn-secondary btn-full" id="route-qr-done">Done</button>
      </div>
    `;
    dialogEl.querySelector('div > div:nth-child(2)').appendChild(canvas);
    canvas.style.cssText = 'max-width:240px;width:100%;height:auto;border-radius:8px;';
    dialogEl.querySelector('#route-qr-done').addEventListener('click', () => overlay.remove());
  }

  overlay.querySelector('#save-route-qr-only').addEventListener('click', async () => {
    const qrBtn = overlay.querySelector('#save-route-qr-only');
    qrBtn.disabled = true; qrBtn.textContent = 'Generating…';
    try {
      const msg = await _validateAndBuildMsg(overlay);
      if (!msg) { qrBtn.disabled = false; qrBtn.innerHTML = `${icon('qr')} QR Only`; return; }
      const dialogEl = overlay.querySelector('div');
      await _showRouteQR(msg, dialogEl);
      _showFullscreen('success', 'Sent Successfully', 'Route QR generated', msg.title);
    } catch (err) {
      qrBtn.disabled = false; qrBtn.innerHTML = `${icon('qr')} QR Only`;
      overlay.querySelector('#save-route-error').textContent = err.message;
      overlay.querySelector('#save-route-error').classList.remove('hidden');
    }
  });

  overlay.querySelector('#save-route-confirm').addEventListener('click', async () => {
    const errEl     = overlay.querySelector('#save-route-error');
    const confirmBtn = overlay.querySelector('#save-route-confirm');

    confirmBtn.disabled = true;
    confirmBtn.innerHTML = `<div class="spinner" style="width:16px;height:16px;border-width:2px;display:inline-block;margin-right:6px;"></div> Saving…`;

    try {
      const msg = await _validateAndBuildMsg(overlay);
      if (!msg) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = `${icon('send')} Save &amp; Broadcast`;
        return;
      }

      await saveMessage(msg, { mode: 'origin', localSessionOwned: true });

      // Push to all open peers
      const openPeers = getPeers().filter((p) => p.status === 'open');
      await Promise.all(openPeers.map((p) => pushMessage(p.peerId, msg)));

      window.dispatchEvent(new CustomEvent('meshdrop:bundles-updated', {
        detail: { source: 'route-draw' },
      }));

      _showFullscreen(
        'success',
        'Sent Successfully',
        openPeers.length > 0
          ? `Route broadcast to ${openPeers.length} peer${openPeers.length > 1 ? 's' : ''}`
          : 'Route saved to your feed',
        msg.title
      );

      // Show a QR of the saved route before closing
      const dialogEl = overlay.querySelector('div');
      await _showRouteQR(msg, dialogEl);

      _exitDrawingMode(container, false);
      const count = await _plotMessages();
      _updatePinUI(container, count);

    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = `${icon('send')} Save &amp; Broadcast`;
    }
  });

  // Auto-focus
  setTimeout(() => overlay.querySelector('#route-name-input')?.focus(), 100);
}

// ─── Render ──────────────────────────────────────────────────────

export async function renderMapScreen(container) {
  container.innerHTML = `
    <div class="map-screen animate-in">

      <!-- Header bar -->
      <div class="map-header-bar">
        <div class="map-header-left">
          <span class="map-header-title">${icon('shield')} FIELD MAP</span>
          <span class="map-header-sub">Live tiles · cached for offline use</span>
        </div>
        <div class="map-header-right">
          <span class="map-gps-badge" id="map-accuracy">Locating…</span>
          <button class="map-icon-btn" id="map-follow-btn" title="Toggle follow me" style="font-size:0.65rem;font-weight:800;letter-spacing:0.04em;padding:0 8px;min-width:52px;">
            FOLLOW
          </button>
          <button class="map-icon-btn" id="map-layer-btn" title="Switch map style" style="font-size:0.65rem;font-weight:800;letter-spacing:0.04em;padding:0 8px;min-width:52px;">
            DARK
          </button>
          <button class="map-icon-btn" id="map-locate-btn" title="Re-centre on my location">
            ${icon('wifi')}
          </button>
          <button class="map-icon-btn" id="map-refresh-btn" title="Refresh message pins">
            ${icon('hop')}
          </button>
        </div>
      </div>

      <!-- Instruction bar -->
      <div class="map-instruction">
        ${icon('info')}
        <span>Pins show GPS-tagged messages. Green lines are safe routes. Tap any for details.</span>
      </div>

      <!-- Legend strip -->
      <div class="map-legend-strip" id="map-legend">
        ${Object.entries(PIN_CFG).map(([, c]) =>
          `<span class="map-legend-dot" style="background:${c.color};"></span>
           <span class="map-legend-label">${c.label}</span>`
        ).join('')}
        <span class="map-legend-dot" style="background:#00e676;border-radius:2px;width:14px;height:4px;"></span>
        <span class="map-legend-label">Route</span>
      </div>

      <!-- Map container -->
      <div id="trinetra-map" class="trinetra-map"></div>

      <!-- Pin count badge -->
      <div class="map-pin-count hidden" id="map-pin-count">
        ${icon('alert')} <span id="map-pin-num">0</span> located messages
      </div>

      <!-- Empty state -->
      <div class="map-empty-state hidden" id="map-empty">
        ${icon('shield')}
        <div class="map-empty-title">No Located Messages</div>
        <div class="map-empty-sub">
          Messages with GPS coordinates appear as pins.<br>
          Safe routes with waypoints appear as green lines.<br>
          Create messages in the Feed tab with a location attached.
        </div>
      </div>

      <!-- Draw Route FAB -->
      <button class="map-draw-fab" id="map-draw-btn" title="Draw a safe route">
        ${icon('draw')} Draw Route
      </button>

      <!-- Drawing mode controls bar (hidden until drawing) -->
      <div class="map-draw-ctrl hidden" id="draw-ctrl-bar">
        <div class="map-draw-status" id="draw-status">Tap the map to add waypoints</div>
        <div class="map-draw-actions">
          <button class="btn btn-secondary btn-sm" id="draw-undo-btn" disabled>
            ${icon('undo')} Undo
          </button>
          <button class="btn btn-primary btn-sm" id="draw-save-btn" disabled>
            ${icon('check')} Save Route
          </button>
        </div>
      </div>

    </div>
  `;

  // Mount Leaflet after DOM is ready
  await new Promise((r) => requestAnimationFrame(r));

  _followMe = false;

  _map = L.map('trinetra-map', {
    zoomControl: true,
    attributionControl: true,
    minZoom: 2,
    maxZoom: 19,
  }).setView([20.5937, 78.9629], 5);

  // Offline tactical grid — always present as the bottom layer.
  // Shows a coordinate grid when tiles haven't loaded yet or when offline.
  new _TacticalGrid({ zIndex: 0, opacity: 1 }).addTo(_map);

  // Add tile layer on top (dark CartoDB by default — fits the tactical theme)
  _applyTileLayer(_tileKey);

  // Scale bar bottom-left
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(_map);

  _markerLayer = L.layerGroup().addTo(_map);
  _routeLayer  = L.layerGroup().addTo(_map);
  _beaconLayer = L.layerGroup().addTo(_map);

  const pinCount = await _plotMessages();
  _plotBeacons();
  _updatePinUI(container, pinCount);
  _startGeolocation(container);

  // Layer switcher (cycles dark → standard → satellite)
  const layerBtn = container.querySelector('#map-layer-btn');
  if (layerBtn) {
    layerBtn.textContent = TILE_LAYERS[_tileKey].label.toUpperCase();
    layerBtn.addEventListener('click', () => {
      const idx  = TILE_CYCLE.indexOf(_tileKey);
      const next = TILE_CYCLE[(idx + 1) % TILE_CYCLE.length];
      _applyTileLayer(next);
      layerBtn.textContent = TILE_LAYERS[next].label.toUpperCase();
    });
  }

  // Follow-me toggle
  const followBtn = container.querySelector('#map-follow-btn');
  if (followBtn) {
    const _updateFollowBtn = () => {
      followBtn.style.color      = _followMe ? '#34c759' : '';
      followBtn.style.borderColor = _followMe ? '#34c759' : '';
    };
    followBtn.addEventListener('click', () => {
      _followMe = !_followMe;
      _updateFollowBtn();
      if (_followMe && _selfMarker) {
        _map.flyTo(_selfMarker.getLatLng(), 16, { duration: 1.0 });
      }
    });
    _updateFollowBtn();
  }

  // Disable follow when user manually pans
  _map.on('dragstart', () => {
    if (_followMe) {
      _followMe = false;
      const fb = container.querySelector('#map-follow-btn');
      if (fb) { fb.style.color = ''; fb.style.borderColor = ''; }
    }
  });

  // Re-centre button
  container.querySelector('#map-locate-btn').addEventListener('click', () => {
    if (_selfMarker) {
      _map.flyTo(_selfMarker.getLatLng(), 16, { duration: 1.2 });
    } else {
      navigator.geolocation?.getCurrentPosition((p) => {
        _map.flyTo([p.coords.latitude, p.coords.longitude], 15, { duration: 1.2 });
      });
    }
  });

  // Refresh pins
  container.querySelector('#map-refresh-btn').addEventListener('click', async () => {
    const btn = container.querySelector('#map-refresh-btn');
    btn.style.opacity = '0.4';
    const n = await _plotMessages();
    _plotBeacons();
    _updatePinUI(container, n);
    setTimeout(() => { btn.style.opacity = ''; }, 600);
  });

  // Draw Route FAB
  container.querySelector('#map-draw-btn').addEventListener('click', () => {
    if (_drawingMode) {
      _exitDrawingMode(container, false);
    } else {
      _enterDrawingMode(container);
    }
  });

  // Undo last waypoint
  container.querySelector('#draw-undo-btn').addEventListener('click', () => {
    if (_drawnWaypoints.length > 0) {
      _drawnWaypoints.pop();
      _refreshDrawLayer(container);
    }
  });

  // Save route
  container.querySelector('#draw-save-btn').addEventListener('click', () => {
    if (_drawnWaypoints.length < 2) return;
    _showSaveRouteDialog(container);
  });

  // Listen for bundle updates
  const _onUpdate = async () => {
    if (!_map || _drawingMode) return;
    const n = await _plotMessages();
    _updatePinUI(container, n);
  };
  const _onBeacon = () => { if (_map) _plotBeacons(); };
  window.addEventListener('meshdrop:bundles-updated', _onUpdate);
  window.addEventListener('meshdrop:beacon-update',   _onBeacon);
  container._mapCleanup = () => {
    window.removeEventListener('meshdrop:bundles-updated', _onUpdate);
    window.removeEventListener('meshdrop:beacon-update',   _onBeacon);
  };

  setTimeout(() => _map?.invalidateSize(), 300);
}

function _updatePinUI(container, count) {
  const badge = container.querySelector('#map-pin-count');
  const empty = container.querySelector('#map-empty');
  const num   = container.querySelector('#map-pin-num');
  if (!badge || !empty) return;
  if (count > 0) {
    badge.classList.remove('hidden');
    empty.classList.add('hidden');
    if (num) num.textContent = count;
  } else {
    badge.classList.add('hidden');
    empty.classList.remove('hidden');
  }
}

export function cleanupMapScreen() {
  if (_drawingMode) _exitDrawingMode(document.querySelector('.map-screen'), false);

  const overlay = document.getElementById('save-route-overlay');
  if (overlay) overlay.remove();

  if (_watchId != null) {
    navigator.geolocation?.clearWatch(_watchId);
    _watchId = null;
  }

  const container = document.querySelector('.map-screen');
  container?._mapCleanup?.();

  if (_map) {
    _map.off('click');
    _map.off('dragstart');
    _map.remove();
    _map = null;
  }
  _markerLayer    = null;
  _routeLayer     = null;
  _beaconLayer    = null;
  _tileLayer      = null;
  _selfMarker     = null;
  _followMe       = false;
  _drawingMode    = false;
  _drawnWaypoints = [];
  _drawMarkers    = [];
  _drawPolyline   = null;
}

function _esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/**
 * TRINETRA — Live Feed v3
 * + SOS hold-to-activate (2s hold, haptic, GPS, immediate broadcast)
 * + Named Frequencies (GENERAL / MEDICAL / FOOD / SECURITY / EVAC)
 * + Message Reactions (local annotations: ✓ Confirmed / ⚠ Unverified / ✗ False)
 * + Web Share API on message cards
 */
import { getMessages, saveMessage, purgeMessage } from '../lib/db.js';
import { generateBundleId } from '../lib/crypto.js';
import { getPeers } from '../lib/webrtc.js';
import { pushMessage } from '../lib/sync.js';
import { icon } from './icons.js';
import { haptic } from '../lib/haptic.js';
import { getReaction, toggleReaction, REACTIONS } from '../lib/reactions.js';

let _container      = null;
let _typeFilter     = '';
let _freqFilter     = '';
let _countdownTimer = null;
let _composeModalEl = null;
let _setComposeType = null;
let _editingMessage = null;
const _messageIndex = new Map();
const _expanded     = new Map();
const MAX_VISIBLE   = 3;
const COMPOSE_LOCATION_IDLE_LABEL   = `${icon('mappin')} Attach My Location — shows on Map tab`;
const COMPOSE_LOCATION_ACTIVE_LABEL = `${icon('mappin')} GPS Attached`;

// SOS hold state
let _sosHoldTimer   = null;
let _sosHoldStart   = 0;
let _sosRafId       = null;

const EXPIRY_OPTIONS = [
  { label: '1 hour',   ms:       3_600_000 },
  { label: '4 hours',  ms:      14_400_000 },
  { label: '24 hours', ms:      86_400_000 },
  { label: '48 hours', ms:     172_800_000 },
  { label: '7 days',   ms:     604_800_000 },
];

const TYPE_CFG = {
  emergency:   { icon: 'emergency', label: 'Emergency',  color: '#e02424', bg: 'rgba(224,36,36,0.10)',   border: '#e02424', order: 0, expiry: 0, alwaysExpand: true },
  alert:       { icon: 'alert',     label: 'Alert',      color: '#f0a500', bg: 'rgba(240,165,0,0.10)',   border: '#f0a500', order: 1, expiry: 1 },
  'safe-route':{ icon: 'route',     label: 'Safe Route', color: '#00e676', bg: 'rgba(0,230,118,0.08)',   border: '#00e676', order: 2, expiry: 2 },
  medical:     { icon: 'medical',   label: 'Medical',    color: '#5ac8fa', bg: 'rgba(90,200,250,0.08)',  border: '#5ac8fa', order: 3, expiry: 1 },
  shelter:     { icon: 'shelter',   label: 'Shelter',    color: '#af52de', bg: 'rgba(175,82,222,0.08)',  border: '#af52de', order: 4, expiry: 2 },
  resource:    { icon: 'resource',  label: 'Resource',   color: '#ff9f0a', bg: 'rgba(255,159,10,0.08)',  border: '#ff9f0a', order: 5, expiry: 2 },
  info:        { icon: 'info',      label: 'Info',       color: '#3b7de8', bg: 'rgba(59,125,232,0.07)',  border: '#3b7de8', order: 6, expiry: 2 },
};

const TYPE_DEFAULTS_EXPIRY = {
  emergency: 0, alert: 1, 'safe-route': 2, medical: 1, shelter: 2, resource: 2, info: 2,
};

const FILTER_TABS = [
  { type: '',            label: 'All',       iconName: 'feed'      },
  { type: 'emergency',   label: 'Emergency', iconName: 'emergency' },
  { type: 'alert',       label: 'Alert',     iconName: 'alert'     },
  { type: 'safe-route',  label: 'Routes',    iconName: 'route'     },
  { type: 'medical',     label: 'Medical',   iconName: 'medical'   },
  { type: 'shelter',     label: 'Shelter',   iconName: 'shelter'   },
  { type: 'resource',    label: 'Resource',  iconName: 'resource'  },
  { type: 'info',        label: 'Info',      iconName: 'info'      },
];

const FREQUENCIES = [
  { id: 'general',  label: 'General',  color: '#5a5a5a' },
  { id: 'medical',  label: 'Medical',  color: '#5ac8fa' },
  { id: 'food',     label: 'Food',     color: '#34c759' },
  { id: 'security', label: 'Security', color: '#ff9f0a' },
  { id: 'evac',     label: 'EVAC',     color: '#ff2d55' },
];

// ─── Public API ──────────────────────────────────────────────────

export async function renderFeedScreen(container) {
  _container  = container;
  _typeFilter = '';
  _freqFilter = '';
  _setComposeType = null;
  _editingMessage = null;
  _messageIndex.clear();

  _composeModalEl?.remove();
  _composeModalEl = null;

  container.innerHTML = `
    <div class="feed-screen animate-in">

      <!-- ── Header ── -->
      <div class="feed-header-bar">
        <div class="feed-title-block">
          <div class="feed-title">Live Feed</div>
          <div class="feed-subtitle" id="feed-subtitle">
            <span class="feed-live-dot">Live</span>
          </div>
        </div>
        <div class="feed-header-actions">
          <button class="feed-sos-btn" id="btn-sos" aria-label="Hold for SOS">
            ${icon('sos')}
            <span class="sos-label">SOS</span>
            <span class="sos-hold-fill" id="sos-hold-fill"></span>
          </button>
          <button class="feed-new-btn" id="btn-compose" aria-label="Create announcement">
            ${icon('plus')}
          </button>
        </div>
      </div>

      <!-- ── Frequency Bar ── -->
      <div class="freq-bar" id="freq-bar">
        <span class="freq-bar-label">${icon('frequency')} FREQ:</span>
        ${FREQUENCIES.map((f) => `
          <button class="freq-chip ${f.id === 'general' ? 'active' : ''}" data-freq="${f.id}"
            style="--fc:${f.color};">
            ${f.label}
          </button>
        `).join('')}
      </div>

      <!-- ── Filter Strip ── -->
      <div class="feed-filters" id="filter-bar" role="tablist" aria-label="Filter by type">
        ${FILTER_TABS.map((t) => `
          <button class="ffilter-chip ${t.type === '' ? 'active' : ''}" data-type="${t.type}" role="tab"
            aria-selected="${t.type === '' ? 'true' : 'false'}">
            ${icon(t.iconName)} ${t.label}
          </button>
        `).join('')}
      </div>

      <!-- ── Feed List ── -->
      <div class="feed-list" id="feed-list" role="feed" aria-live="polite"></div>

    </div>
  `;

  const modal = document.createElement('div');
  modal.className = 'compose-overlay hidden anim-in';
  modal.id = 'compose-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'compose-modal-title');
  modal.innerHTML = `
    <div class="compose-sheet">
      <div class="compose-sheet-scroll">
      <div class="compose-header">
        <span class="compose-title" id="compose-modal-title">New Announcement</span>
        <button class="compose-close" id="compose-close" aria-label="Close">${icon('close')}</button>
      </div>
      <form id="compose-form" novalidate>

        <div class="form-group" style="margin-bottom:14px;">
          <div class="form-label">Category</div>
          <div class="type-grid" id="type-grid">
            ${Object.entries(TYPE_CFG).map(([t, c]) => `
              <button type="button" class="type-grid-btn ${t === 'info' ? 'selected' : ''}" data-type="${t}"
                style="${t === 'info' ? `background:${c.bg};border-color:${c.border};` : ''}">
                <span class="tg-icon">${icon(c.icon)}</span>
                <span>${c.label}</span>
              </button>
            `).join('')}
          </div>
        </div>

        <div class="form-group" style="margin-bottom:12px;">
          <div class="form-label">${icon('frequency')} Frequency Channel</div>
          <div class="freq-compose-row" id="freq-compose-row">
            ${FREQUENCIES.map((f) => `
              <button type="button" class="freq-compose-chip ${f.id === 'general' ? 'selected' : ''}" data-freq="${f.id}"
                style="--fc:${f.color};">
                ${f.label}
              </button>
            `).join('')}
          </div>
        </div>

        <div class="form-group" style="margin-bottom:12px;">
          <label class="form-label" for="compose-title">Title <span style="color:var(--red);">*</span></label>
          <input class="form-input" id="compose-title" maxlength="80"
                 placeholder="Brief, clear description of the situation" />
          <div class="char-count"><span id="title-count">0</span> / 80</div>
        </div>

        <div class="form-group" style="margin-bottom:12px;">
          <label class="form-label" for="compose-body">Details</label>
          <textarea class="form-input" id="compose-body" rows="3" maxlength="500"
                    placeholder="Location, what is happening, what action to take…"></textarea>
          <div class="char-count"><span id="body-count">0</span> / 500</div>
        </div>

        <div class="form-group" style="margin-bottom:12px;">
          <div class="form-label" style="display:flex;align-items:center;gap:6px;">
            Location
            <span style="font-size:0.65rem;font-weight:600;color:var(--green);letter-spacing:0.1em;text-transform:uppercase;background:var(--green-dim);border:1px solid rgba(0,230,118,0.16);border-radius:20px;padding:1px 7px;">Map pin</span>
          </div>
          <button type="button" class="compose-loc-btn" id="compose-loc-btn" style="width:100%;">
            ${icon('mappin')} Attach My Location — shows on Map tab
          </button>
          <div class="compose-loc-coords" id="compose-loc-coords" style="display:none;"></div>
        </div>

        <div class="form-group" style="margin-bottom:16px;">
          <label class="form-label" for="compose-expiry">Expires after</label>
          <select class="form-input" id="compose-expiry">
            ${EXPIRY_OPTIONS.map((o, i) => `<option value="${i}">${o.label}</option>`).join('')}
          </select>
        </div>

        <div class="hidden text-danger text-sm" id="compose-error" style="margin-bottom:10px;padding:0 2px;"></div>
        <div class="hidden text-muted text-sm" id="compose-edit-note" style="margin-bottom:10px;padding:0 2px;"></div>
      </form>
      </div><!-- /.compose-sheet-scroll -->

      <div class="compose-actions">
        <button type="button" class="btn btn-secondary" id="compose-cancel" style="flex:1;">Cancel</button>
        <button type="button" class="btn btn-primary" id="compose-submit" style="flex:2;">
          ${icon('send')} Broadcast
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  _composeModalEl = modal;

  _wireFilters(container);
  _wireFreqBar(container);
  _wireButtons(container);
  _wireComposeModal();
  _wireComposeForm();
  await _loadFeed(container);

  window.addEventListener('meshdrop:bundles-updated', _onBundlesUpdated);
  _countdownTimer = setInterval(() => _loadFeed(container), 30_000);
}

export function cleanupFeedScreen() {
  window.removeEventListener('meshdrop:bundles-updated', _onBundlesUpdated);
  clearInterval(_countdownTimer);
  _countdownTimer = null;
  _composeModalEl?.remove();
  _composeModalEl = null;
  _setComposeType = null;
  _editingMessage = null;
  _messageIndex.clear();
  _container = null;
  _cancelSosHold();
}

async function _onBundlesUpdated() {
  if (_container) await _loadFeed(_container);
}

// ─── SOS Hold-to-Activate ────────────────────────────────────────

const SOS_HOLD_MS = 2000;

function _wireSOSButton(container) {
  const btn  = container.querySelector('#btn-sos');
  const fill = container.querySelector('#sos-hold-fill');
  if (!btn || !fill) return;

  const start = (e) => {
    e.preventDefault();
    // Capture pointer so pointerleave doesn't fire when finger shifts slightly
    try { btn.setPointerCapture(e.pointerId); } catch {}
    _sosHoldStart = Date.now();
    haptic('hold_tick');

    _sosRafId = requestAnimationFrame(function tick() {
      const elapsed = Date.now() - _sosHoldStart;
      const pct     = Math.min(100, (elapsed / SOS_HOLD_MS) * 100);
      fill.style.width = pct + '%';
      if (elapsed < SOS_HOLD_MS) {
        _sosRafId = requestAnimationFrame(tick);
      } else {
        fill.style.width = '100%';
        _fireSOS();
      }
    });

    _sosHoldTimer = setTimeout(() => {}, SOS_HOLD_MS);
  };

  const cancel = (e) => {
    // Only cancel if this is the captured pointer
    try { btn.releasePointerCapture(e.pointerId); } catch {}
    _cancelSosHold();
    fill.style.width = '0%';
  };

  btn.addEventListener('pointerdown', start);
  btn.addEventListener('pointerup',   cancel);
  btn.addEventListener('pointercancel', cancel);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}

function _cancelSosHold() {
  clearTimeout(_sosHoldTimer);
  cancelAnimationFrame(_sosRafId);
  _sosHoldTimer = null;
  _sosRafId     = null;
}

async function _fireSOS() {
  _cancelSosHold();
  haptic('sos');

  const btn = _container?.querySelector('#btn-sos');
  if (btn) {
    btn.classList.add('sos-fired');
    setTimeout(() => btn.classList.remove('sos-fired'), 1800);
  }

  // Get GPS location (non-blocking — broadcast immediately then update if available)
  let lat = null, lng = null;
  try {
    const pos = await new Promise((res, rej) =>
      navigator.geolocation.getCurrentPosition(res, rej, { timeout: 4000, enableHighAccuracy: true })
    );
    lat = pos.coords.latitude;
    lng = pos.coords.longitude;
  } catch {}

  const now       = Date.now();
  const expiresAt = now + 4 * 3_600_000; // 4h
  const title     = 'SOS — Emergency Assistance Required';
  const body      = lat
    ? `Coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}`
    : 'No GPS — broadcaster needs help.';
  const id = await generateBundleId(title, now, 'sos');

  const msg = {
    id, rootId: id, revision: 1, replaces: null,
    type: 'emergency', priority: 100,
    title, body,
    bodyPreview: body, fragments: [], fragmentCount: 1,
    bodyState: 'full',
    createdAt: now, expiresAt, ttl: 80, hops: 0, seenCount: 1,
    localSessionOwned: true,
    ...(lat != null ? { lat, lng } : {}),
  };

  await saveMessage(msg, { mode: 'origin', localSessionOwned: true });

  const openPeers = getPeers().filter((p) => p.status === 'open');
  await Promise.all(openPeers.map((p) => pushMessage(p.peerId, msg)));

  window.dispatchEvent(new CustomEvent('meshdrop:bundles-updated', { detail: { source: 'sos' } }));
  window.dispatchEvent(new CustomEvent('meshdrop:show-toast', {
    detail: { message: `SOS broadcast sent to ${openPeers.length} peer${openPeers.length !== 1 ? 's' : ''}` },
  }));
}

// ─── Wiring ──────────────────────────────────────────────────────

function _wireFilters(container) {
  container.querySelector('#filter-bar').addEventListener('click', async (e) => {
    const chip = e.target.closest('.ffilter-chip');
    if (!chip) return;
    container.querySelectorAll('.ffilter-chip').forEach((c) => {
      c.classList.remove('active');
      c.setAttribute('aria-selected', 'false');
    });
    chip.classList.add('active');
    chip.setAttribute('aria-selected', 'true');
    _typeFilter = chip.dataset.type;
    await _loadFeed(container);
  });
}

function _wireFreqBar(container) {
  container.querySelector('#freq-bar').addEventListener('click', async (e) => {
    const chip = e.target.closest('.freq-chip');
    if (!chip) return;
    container.querySelectorAll('.freq-chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    _freqFilter = chip.dataset.freq === 'general' ? '' : chip.dataset.freq;
    await _loadFeed(container);
  });
}

function _wireButtons(container) {
  _wireSOSButton(container);
  container.querySelector('#btn-compose').addEventListener('click', () => _openCompose('info'));
  container.querySelector('#feed-list')?.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.fc-edit-btn');
    if (editBtn) {
      const msg = _messageIndex.get(editBtn.dataset.id);
      if (msg) _openCompose(msg.type, msg);
      return;
    }

    // Reaction button
    const rxBtn = e.target.closest('.fc-reaction-btn');
    if (rxBtn) {
      const id       = rxBtn.dataset.id;
      const reaction = rxBtn.dataset.reaction;
      toggleReaction(id, reaction);
      haptic('light');
      // Re-render just the reaction bar
      const card = rxBtn.closest('.fc-card');
      if (card) _refreshReactionBar(card, id);
      return;
    }

    // Share button
    const shareBtn = e.target.closest('.fc-share-btn');
    if (shareBtn) {
      const msg = _messageIndex.get(shareBtn.dataset.id);
      if (msg) _shareMessage(msg);
      return;
    }

    // Delete button
    const delBtn = e.target.closest('.fc-delete-btn');
    if (delBtn) {
      _confirmDeleteMessage(delBtn.dataset.id, delBtn.dataset.title);
    }
  });
}

function _refreshReactionBar(card, msgId) {
  const bar = card.querySelector('.fc-reaction-bar');
  if (!bar) return;
  bar.innerHTML = _renderReactionBar(msgId);
}

function _wireComposeModal() {
  const modal = _composeModalEl;
  if (!modal) return;
  modal.querySelector('#compose-close').addEventListener('click', _hideComposeModal);
  modal.querySelector('#compose-cancel')?.addEventListener('click', _hideComposeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) _hideComposeModal(); });
}

function _wireComposeForm() {
  const modal = _composeModalEl;
  if (!modal) return;
  const form         = modal.querySelector('#compose-form');
  const titleInput   = modal.querySelector('#compose-title');
  const bodyTA       = modal.querySelector('#compose-body');
  const expirySelect = modal.querySelector('#compose-expiry');
  const errorEl      = modal.querySelector('#compose-error');
  const submitBtn    = modal.querySelector('#compose-submit');
  let   selectedType = 'info';
  let   selectedFreq = 'general';
  modal._locCoords   = null;
  let   isSubmitting = false;

  // ── Frequency chips ──
  modal.querySelector('#freq-compose-row')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.freq-compose-chip');
    if (!chip) return;
    modal.querySelectorAll('.freq-compose-chip').forEach((c) => c.classList.remove('selected'));
    chip.classList.add('selected');
    selectedFreq = chip.dataset.freq;
  });

  // ── GPS location button ──
  const locBtn    = modal.querySelector('#compose-loc-btn');
  const locCoords = modal.querySelector('#compose-loc-coords');

  if (locBtn) {
    locBtn.addEventListener('click', () => {
      if (modal._locCoords) {
        modal._locCoords = null;
        locBtn.classList.remove('loc-active');
        locBtn.innerHTML = COMPOSE_LOCATION_IDLE_LABEL;
        locCoords.style.display = 'none';
        locCoords.textContent   = '';
        return;
      }
      if (!navigator.geolocation) {
        locCoords.textContent   = 'GPS not available';
        locCoords.style.display = 'block';
        return;
      }
      locBtn.disabled = true;
      locBtn.innerHTML = `<div class="spinner" style="width:14px;height:14px;border-width:2px;"></div> Locating…`;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          modal._locCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          locBtn.disabled = false;
          locBtn.classList.add('loc-active');
          locBtn.innerHTML = COMPOSE_LOCATION_ACTIVE_LABEL;
          locCoords.textContent   = `${modal._locCoords.lat.toFixed(5)}, ${modal._locCoords.lng.toFixed(5)}`;
          locCoords.style.display = 'block';
        },
        () => {
          locBtn.disabled = false;
          locBtn.innerHTML = COMPOSE_LOCATION_IDLE_LABEL;
          locCoords.textContent   = 'Location unavailable';
          locCoords.style.display = 'block';
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });
  }

  modal.querySelectorAll('.type-grid-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      modal.querySelectorAll('.type-grid-btn').forEach((b) => {
        b.classList.remove('selected');
        b.style.background = b.style.borderColor = '';
      });
      selectedType = btn.dataset.type;
      btn.classList.add('selected');
      const cfg = TYPE_CFG[selectedType];
      if (cfg) { btn.style.background = cfg.bg; btn.style.borderColor = cfg.border; }
      expirySelect.value = String(TYPE_DEFAULTS_EXPIRY[selectedType] ?? 2);
    });
  });

  titleInput.addEventListener('input', () => {
    modal.querySelector('#title-count').textContent = titleInput.value.length;
  });
  bodyTA.addEventListener('input', () => {
    modal.querySelector('#body-count').textContent = bodyTA.value.length;
  });

  submitBtn?.addEventListener('click', () => {
    if (typeof form.requestSubmit === 'function') {
      form.requestSubmit();
      return;
    }
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    const title    = titleInput.value.trim();
    const body     = bodyTA.value.trim();
    const expiryMs = EXPIRY_OPTIONS[parseInt(expirySelect.value, 10)].ms;

    errorEl.classList.add('hidden');
    if (!title) {
      errorEl.textContent = 'Title is required.';
      errorEl.classList.remove('hidden');
      titleInput.focus();
      return;
    }

    isSubmitting = true;
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<div class="spinner" style="width:18px;height:18px;border-width:2px;"></div> ${_editingMessage ? 'Updating…' : 'Sending…'}`;

    try {
      const now       = Date.now();
      const expiresAt = now + expiryMs;
      const priority  = selectedType === 'emergency' ? 90 : selectedType === 'alert' ? 70 : 50;
      const rootId    = _editingMessage?.rootId || _editingMessage?.id;
      const revision  = (_editingMessage?.revision || 0) + 1;
      const id        = await generateBundleId(title + body, now, `${rootId || 'new'}:${revision}`);
      const msg       = {
        id,
        rootId: rootId || id,
        revision: _editingMessage ? revision : 1,
        replaces: _editingMessage?.id || null,
        type: selectedType,
        priority,
        title,
        body,
        bodyPreview: body.slice(0, 160),
        fragments: [],
        fragmentCount: body ? Math.ceil(body.length / 120) : 0,
        bodyState: 'full',
        frequency: selectedFreq !== 'general' ? selectedFreq : undefined,
        createdAt: now, expiresAt, ttl: 80, hops: 0, seenCount: 1,
        localSessionOwned: true,
        ...modal._locCoords ? { lat: modal._locCoords.lat, lng: modal._locCoords.lng } : {},
      };

      const result = await saveMessage(msg, { mode: 'origin', localSessionOwned: true });
      if (result.status === 'stale') {
        throw new Error('A newer revision already exists for this message.');
      }

      _hideComposeModal();
      modal._locCoords = null;
      _resetComposeForm();

      const openPeers = getPeers().filter((p) => p.status === 'open');
      await Promise.all(openPeers.map((p) => pushMessage(p.peerId, msg)));

      haptic('success');
      window.dispatchEvent(new CustomEvent('meshdrop:bundles-updated', { detail: { source: 'compose' } }));
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    } finally {
      isSubmitting = false;
      submitBtn.disabled = false;
      _syncComposeModeUI(modal);
    }
  });

  _setComposeType = (type) => {
    selectedType = type;
    modal.querySelectorAll('.type-grid-btn').forEach((b) => {
      const isSel = b.dataset.type === type;
      b.classList.toggle('selected', isSel);
      const cfg = TYPE_CFG[b.dataset.type];
      b.style.background  = isSel && cfg ? cfg.bg : '';
      b.style.borderColor = isSel && cfg ? cfg.border : '';
    });
    if (!_editingMessage) {
      expirySelect.value = String(TYPE_DEFAULTS_EXPIRY[type] ?? 2);
    }
  };

  _syncComposeModeUI(modal);
}

function _resetComposeForm() {
  const modal = _composeModalEl;
  if (!modal) return;
  _editingMessage = null;
  modal.querySelector('#compose-form')?.reset();
  modal.querySelector('#title-count').textContent = '0';
  modal.querySelector('#body-count').textContent  = '0';
  modal.querySelector('#compose-error')?.classList.add('hidden');
  modal.querySelector('#compose-edit-note')?.classList.add('hidden');
  modal.querySelector('#compose-edit-note').textContent = '';
  modal.querySelector('#compose-modal-title').textContent = 'New Announcement';
  modal._locCoords = null;

  const locBtn    = modal.querySelector('#compose-loc-btn');
  const locCoords = modal.querySelector('#compose-loc-coords');
  if (locBtn) { locBtn.classList.remove('loc-active'); locBtn.innerHTML = COMPOSE_LOCATION_IDLE_LABEL; locBtn.disabled = false; }
  if (locCoords) { locCoords.style.display = 'none'; locCoords.textContent = ''; }

  modal.querySelectorAll('.type-grid-btn').forEach((b) => {
    b.classList.remove('selected');
    b.style.background = b.style.borderColor = '';
  });
  const infoBtn = modal.querySelector('.type-grid-btn[data-type="info"]');
  if (infoBtn) {
    infoBtn.classList.add('selected');
    infoBtn.style.background  = TYPE_CFG.info.bg;
    infoBtn.style.borderColor = TYPE_CFG.info.border;
  }
  modal.querySelector('#compose-expiry').value = String(TYPE_DEFAULTS_EXPIRY.info ?? 2);

  // Reset frequency
  modal.querySelectorAll('.freq-compose-chip').forEach((c) => c.classList.remove('selected'));
  modal.querySelector('.freq-compose-chip[data-freq="general"]')?.classList.add('selected');

  _syncComposeModeUI(modal);
}

function _hideComposeModal() {
  _composeModalEl?.classList.add('hidden');
}

function _openCompose(presetType = 'info', message = null) {
  _editingMessage = message;
  _composeModalEl?.classList.remove('hidden');
  if (message) {
    _prefillComposeForm(message);
  } else {
    _resetComposeForm();
  }
  _setComposeType?.(presetType);
  _syncComposeModeUI(_composeModalEl);
  _composeModalEl?.querySelector('#compose-title')?.focus();
}

function _prefillComposeForm(message) {
  const modal = _composeModalEl;
  if (!modal || !message) return;

  const titleInput = modal.querySelector('#compose-title');
  const bodyTA = modal.querySelector('#compose-body');
  const expirySelect = modal.querySelector('#compose-expiry');
  const locBtn = modal.querySelector('#compose-loc-btn');
  const locCoords = modal.querySelector('#compose-loc-coords');
  const noteEl = modal.querySelector('#compose-edit-note');

  titleInput.value = message.title || '';
  bodyTA.value = message.bodyState === 'partial' ? message.bodyPreview || '' : message.body || '';
  modal.querySelector('#title-count').textContent = String(titleInput.value.length);
  modal.querySelector('#body-count').textContent = String(bodyTA.value.length);
  modal.querySelector('#compose-modal-title').textContent = 'Update Announcement';
  modal.querySelector('#compose-error')?.classList.add('hidden');

  if (locBtn && locCoords) {
    if (message.lat != null && message.lng != null) {
      modal._locCoords = { lat: message.lat, lng: message.lng };
      locBtn.classList.add('loc-active');
      locBtn.innerHTML = COMPOSE_LOCATION_ACTIVE_LABEL;
      locCoords.textContent = `${message.lat.toFixed(5)}, ${message.lng.toFixed(5)}`;
      locCoords.style.display = 'block';
    } else {
      modal._locCoords = null;
      locBtn.classList.remove('loc-active');
      locBtn.innerHTML = COMPOSE_LOCATION_IDLE_LABEL;
      locCoords.style.display = 'none';
      locCoords.textContent = '';
    }
  }

  // Frequency
  const freq = message.frequency || 'general';
  modal.querySelectorAll('.freq-compose-chip').forEach((c) => {
    c.classList.toggle('selected', c.dataset.freq === freq);
  });

  const remaining = Math.max(3_600_000, (message.expiresAt || Date.now()) - Date.now());
  const expiryIndex = EXPIRY_OPTIONS.findIndex((option) => option.ms >= remaining);
  expirySelect.value = String(expiryIndex >= 0 ? expiryIndex : EXPIRY_OPTIONS.length - 1);

  noteEl.textContent = `Revision ${message.revision || 1} will be replaced with a new scoped update.`;
  noteEl.classList.remove('hidden');
}

function _syncComposeModeUI(modal) {
  if (!modal) return;
  const submitBtn = modal.querySelector('#compose-submit');
  const noteEl = modal.querySelector('#compose-edit-note');
  const titleEl = modal.querySelector('#compose-modal-title');
  if (titleEl) titleEl.textContent = _editingMessage ? 'Update Announcement' : 'New Announcement';
  if (submitBtn && !submitBtn.disabled) {
    submitBtn.innerHTML = _editingMessage ? `${icon('send')} Publish Update` : `${icon('send')} Broadcast`;
  }
  if (!_editingMessage && noteEl) {
    noteEl.classList.add('hidden');
    noteEl.textContent = '';
  }
}

// ─── Web Share ────────────────────────────────────────────────────

async function _shareMessage(msg) {
  const text = [msg.title, msg.body].filter(Boolean).join('\n');
  if (navigator.share) {
    try {
      await navigator.share({
        title: `TRINETRA — ${msg.title}`,
        text,
      });
    } catch {}
  } else {
    try {
      await navigator.clipboard.writeText(text);
      window.dispatchEvent(new CustomEvent('meshdrop:show-toast', {
        detail: { message: 'Message copied to clipboard' },
      }));
    } catch {}
  }
}

// ─── Delete Message ───────────────────────────────────────────────

function _confirmDeleteMessage(id, title) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-dialog">
      <div class="confirm-dialog-icon" style="color:var(--red);">${icon('trash')}</div>
      <h3 class="confirm-dialog-title">Delete Message?</h3>
      <p class="confirm-dialog-body">
        <strong>${_esc(title)}</strong><br>
        <span style="color:var(--text-muted);font-size:0.82rem;">
          This removes it from your local feed only. Other devices that already received it keep their copy.
        </span>
      </p>
      <div class="confirm-dialog-btns">
        <button class="btn btn-secondary" id="del-cancel" style="flex:1;">Cancel</button>
        <button class="btn btn-danger"    id="del-confirm" style="flex:1;">Delete</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#del-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#del-confirm').addEventListener('click', async () => {
    overlay.remove();
    try {
      await purgeMessage(id);
    } catch {}
    if (_container) await _loadFeed(_container);
    window.dispatchEvent(new CustomEvent('meshdrop:bundles-updated', { detail: { source: 'delete' } }));
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

// ─── Feed Loading ────────────────────────────────────────────────

async function _loadFeed(container) {
  const list     = container.querySelector('#feed-list');
  const subtitle = container.querySelector('#feed-subtitle');
  if (!list) return;

  const all  = await getMessages(_typeFilter ? { type: _typeFilter } : {});
  const now  = Date.now();
  let   msgs = all.filter((m) => m.expiresAt > now);

  // Apply frequency filter
  if (_freqFilter) {
    msgs = msgs.filter((m) => (m.frequency || 'general') === _freqFilter);
  }

  _messageIndex.clear();
  msgs.forEach((msg) => _messageIndex.set(msg.id, msg));

  if (subtitle) {
    const count = msgs.length;
    subtitle.innerHTML = `<span class="feed-live-dot">Live</span>&ensp;${count} active signal${count !== 1 ? 's' : ''}`;
  }

  if (msgs.length === 0) {
    const cfg = TYPE_CFG[_typeFilter];
    list.innerHTML = `
      <div class="feed-empty">
        <div class="feed-empty-icon">${icon(cfg?.icon || 'feed')}</div>
        <div class="feed-empty-title">${_typeFilter ? `No ${cfg?.label || _typeFilter} Signals` : 'No Active Signals'}</div>
        <div class="feed-empty-sub">
          ${_typeFilter
            ? `No ${cfg?.label} messages active.`
            : 'The local mesh is quiet. Hold <strong>SOS</strong> for 2 seconds to broadcast an emergency, or tap the compose button.'}
        </div>
      </div>
    `;
    return;
  }

  if (_typeFilter) {
    msgs.sort((a, b) => b.createdAt - a.createdAt);
    list.innerHTML = `<div style="padding:8px 14px 4px;">${msgs.map(_renderCard).join('')}</div>`;
  } else {
    list.innerHTML = _renderSections(msgs);
    _wireSections(list);
  }
}

function _renderSections(msgs) {
  const groups = new Map();
  for (const t of Object.keys(TYPE_CFG)) groups.set(t, []);
  for (const m of msgs) {
    const arr = groups.get(m.type) || groups.get('info');
    arr.push(m);
  }

  return [...Object.entries(TYPE_CFG)]
    .filter(([t]) => (groups.get(t) || []).length > 0)
    .map(([t, cfg]) => {
      const items = (groups.get(t) || []).sort((a, b) => b.createdAt - a.createdAt);
      const isExpanded = _expanded.get(t) !== false;
      const showAll    = _expanded.get(t + ':full') === true;
      const visible    = (cfg.alwaysExpand || showAll) ? items : items.slice(0, MAX_VISIBLE);
      const hidden     = items.length - visible.length;

      return `
        <div class="feed-section ${isExpanded ? '' : 'collapsed'}" data-section="${t}">
          <div class="feed-section-hdr" role="button" aria-expanded="${isExpanded}" tabindex="0">
            <div class="feed-section-icon" style="background:${cfg.bg};color:${cfg.color};">
              ${icon(cfg.icon)}
            </div>
            <span class="feed-section-label" style="color:${cfg.color};">${cfg.label}</span>
            <span class="feed-section-count" style="color:${cfg.color};">${items.length}</span>
            <span class="feed-section-chevron">${icon('back')}</span>
          </div>
          <div class="feed-section-body">
            ${visible.map(_renderCard).join('')}
            ${hidden > 0 ? `
              <button class="feed-view-more" data-section="${t}" data-action="expand">
                ${icon('plus')} View ${hidden} more ${cfg.label} signal${hidden !== 1 ? 's' : ''}
              </button>` : ''}
            ${showAll && items.length > MAX_VISIBLE ? `
              <button class="feed-view-more" data-section="${t}" data-action="collapse">
                ${icon('back')} Show less
              </button>` : ''}
          </div>
        </div>
      `;
    }).join('');
}

function _wireSections(listEl) {
  listEl.querySelectorAll('.feed-section-hdr').forEach((hdr) => {
    const section = hdr.closest('.feed-section');
    const type    = section.dataset.section;
    const toggle  = () => {
      const isNowCollapsed = section.classList.toggle('collapsed');
      _expanded.set(type, !isNowCollapsed);
      hdr.setAttribute('aria-expanded', String(!isNowCollapsed));
    };
    hdr.addEventListener('click', toggle);
    hdr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });

  listEl.querySelectorAll('.feed-view-more').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const type   = btn.dataset.section;
      const action = btn.dataset.action;
      _expanded.set(type + ':full', action === 'expand');
      if (_container) await _loadFeed(_container);
    });
  });
}

function _renderReactionBar(msgId) {
  const current = getReaction(msgId);
  return REACTIONS.map((r) => `
    <button class="fc-reaction-btn ${current === r.id ? 'active' : ''}"
      data-id="${_esc(msgId)}" data-reaction="${r.id}"
      style="--rxc:${r.color};" title="${r.label}">
      ${r.emoji}
    </button>
  `).join('');
}

function _renderCard(msg) {
  const now      = Date.now();
  const ttlMs    = msg.expiresAt - now;
  const cfg      = TYPE_CFG[msg.type] || TYPE_CFG.info;
  const isUrgent = ttlMs < 3_600_000;
  const isNew    = (now - msg.createdAt) < 900_000;
  const totalMs  = msg.expiresAt - msg.createdAt;
  const ttlPct   = Math.max(2, Math.min(100, Math.round((ttlMs / totalMs) * 100)));
  const canEdit  = !!msg.localSessionOwned;
  const isPartial = msg.bodyState === 'partial';
  const freqCfg  = msg.frequency ? FREQUENCIES.find((f) => f.id === msg.frequency) : null;

  const ttlLabel = ttlMs < 3_600_000
    ? `${Math.floor(ttlMs / 60_000)}m`
    : ttlMs < 86_400_000
      ? `${Math.floor(ttlMs / 3_600_000)}h`
      : `${Math.floor(ttlMs / 86_400_000)}d`;

  const isEmergency = msg.type === 'emergency';

  return `
    <article class="fc-card" data-type="${msg.type}"
      style="--fc-color:${cfg.color};--fc-border:${cfg.border};--fc-bg:${cfg.bg};">
      ${isEmergency ? `
        <div class="fc-scan-line"></div>
        <div class="fc-corner fc-corner-tl"></div>
        <div class="fc-corner fc-corner-tr"></div>
        <div class="fc-corner fc-corner-bl"></div>
        <div class="fc-corner fc-corner-br"></div>
      ` : ''}
      <div class="fc-accent-bar"></div>
      <div class="fc-body">
        <div class="fc-header">
          <div class="fc-header-left">
            <span class="fc-type-badge">${icon(cfg.icon)} ${cfg.label}</span>
            ${freqCfg ? `<span class="fc-freq-badge" style="color:${freqCfg.color};border-color:${freqCfg.color}20;">${freqCfg.label}</span>` : ''}
            ${isNew && isEmergency
              ? `<span class="fc-live-badge"><span class="fc-live-dot"></span>LIVE</span>`
              : isNew
              ? `<span class="fc-new-badge">NEW</span>`
              : ''}
            ${msg.revision > 1 ? `<span class="fc-revision-badge">REV ${msg.revision}</span>` : ''}
            ${isPartial ? `<span class="fc-partial-badge">SCOPED</span>` : ''}
          </div>
          <span class="fc-time">${_timeAgo(msg.createdAt)}</span>
        </div>
        <div class="fc-title">${_esc(msg.title)}</div>
        ${msg.body ? `<div class="fc-text">${_esc(msg.body)}</div>` : ''}
        <div class="fc-foot">
          <div class="fc-ttl-track">
            <div class="fc-ttl-fill" style="width:${ttlPct}%"></div>
            <span class="fc-ttl-label${isUrgent ? ' fc-urgent' : ''}">${icon('clock')} ${ttlLabel} left</span>
          </div>
          ${msg.lat != null ? `<span class="fc-loc-badge">${icon('mappin')}</span>` : ''}
          ${msg.hops > 0 ? `<span class="fc-hop fc-relayed-badge">${icon('hop')} ${msg.hops === 1 ? 'RELAYED' : msg.hops + ' HOPS'}</span>` : ''}
          <button class="fc-share-btn" type="button" data-id="${_esc(msg.id)}" title="Share this message">${icon('share')}</button>
          ${canEdit ? `<button class="fc-edit-btn" type="button" data-id="${_esc(msg.id)}">${icon('pencil')} Update</button>` : ''}
          <button class="fc-delete-btn" type="button" data-id="${_esc(msg.id)}" data-title="${_esc(msg.title)}" title="Delete message">${icon('trash')}</button>
        </div>
        <div class="fc-reaction-bar">
          ${_renderReactionBar(msg.id)}
        </div>
      </div>
    </article>
  `;
}

// ─── Helpers ─────────────────────────────────────────────────────

function _timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function _esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

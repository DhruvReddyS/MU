/**
 * TRINETRA — QR Drop Screen
 * Two modes:
 *   Export — select messages → generate QR to show another device
 *   Scan   — camera scan to receive a QR bundle
 */
import {
  bundlesToQR,
  startQRScanner,
  stopQRScanner,
  toggleTorch,
  isTorchAvailable,
} from '../lib/qr.js';
import { getMessages, saveMessage } from '../lib/db.js';
import { getPeers } from '../lib/webrtc.js';
import { requestSync } from '../lib/sync.js';
import { icon } from './icons.js';

const TYPE_CFG = {
  emergency:    { label: 'Emergency',   color: '#ff2d55', iconName: 'emergency' },
  alert:        { label: 'Alert',       color: '#ffd60a', iconName: 'alert'     },
  'safe-route': { label: 'Safe Route',  color: '#34c759', iconName: 'route'     },
  medical:      { label: 'Medical',     color: '#5ac8fa', iconName: 'medical'   },
  shelter:      { label: 'Shelter',     color: '#af52de', iconName: 'shelter'   },
  resource:     { label: 'Resource',    color: '#ff9f0a', iconName: 'resource'  },
  info:         { label: 'Info',        color: '#007aff', iconName: 'info'      },
};

let _allMsgs      = [];
let _activeFilter = '';
let _bannerTimer  = null;

// ─── Public API ──────────────────────────────────────────────────

export function renderQRScreen(container) {
  container.innerHTML = `
    <div class="qr-screen animate-in">

      <!-- ── Screen header ── -->
      <div class="qr-screen-hdr">
        <div class="qr-screen-hdr-left">
          <span class="qr-screen-title">${icon('qr')} QR DROP</span>
          <span class="qr-screen-sub">Offline peer data transfer</span>
        </div>
        <div class="qr-lock-badge">${icon('lock')} ENCRYPTED</div>
      </div>

      <!-- ── Tab pills ── -->
      <div class="qr-tab-row" role="tablist" aria-label="QR mode">
        <button class="qr-tab-pill active" id="tab-export" role="tab"
          aria-controls="export-panel" aria-selected="true" tabindex="0">
          ${icon('share')} Export
        </button>
        <button class="qr-tab-pill" id="tab-import" role="tab"
          aria-controls="import-panel" aria-selected="false" tabindex="-1">
          ${icon('camera')} Scan
        </button>
      </div>

      <!-- ── Notification banner slot ── -->
      <div id="qr-banner-slot"></div>

      <!-- ══ EXPORT PANEL ══ -->
      <div id="export-panel" class="qr-panel" role="tabpanel" aria-labelledby="tab-export">

        <div class="qr-instruction">
          ${icon('info')}
          <span>Step 1: select messages. Step 2: tap <strong>Generate QR</strong> to share by scan, or <strong>Send to Peers</strong> for already connected devices.</span>
        </div>

        <div class="qr-filter-row" id="qr-cat-strip" role="toolbar" aria-label="Filter messages by type">
          <button class="qr-filter-chip active" data-type="" aria-pressed="true">All</button>
          ${Object.entries(TYPE_CFG).map(([t, c]) =>
            `<button class="qr-filter-chip" data-type="${t}" aria-pressed="false" style="--chip-c:${c.color};">
               ${icon(c.iconName)} ${c.label}
             </button>`
          ).join('')}
        </div>

        <div class="qr-sel-bar">
          <span class="qr-sel-count" id="qr-sel-count" aria-live="polite">0 selected</span>
          <div class="qr-sel-actions">
            <button class="qr-sel-btn" id="qr-select-all">Select All</button>
            <button class="qr-sel-btn" id="qr-select-none">Clear</button>
          </div>
        </div>

        <div class="qr-msg-list" id="qr-msg-list" role="list" aria-label="Messages available for QR export"></div>

        <div class="qr-action-bar" aria-label="QR export actions">
          <button class="btn btn-secondary qr-action-btn" id="qr-send-btn">
            ${icon('send')} Send to Peers
          </button>
          <button class="btn btn-primary qr-action-btn" id="qr-gen-btn">
            ${icon('qr')} Generate QR
          </button>
        </div>

        <div id="qr-display-area" class="qr-display-area hidden" role="region" aria-live="polite"></div>

      </div>

      <!-- ══ IMPORT PANEL ══ -->
      <div class="hidden qr-panel" id="import-panel" role="tabpanel" aria-labelledby="tab-import">

        <div id="cam-prompt" class="qr-cam-prompt">
          <div class="qr-cam-icon">${icon('camera')}</div>
          <div class="qr-cam-title">Scan TRINETRA QR</div>
          <div class="qr-cam-steps">
            <div class="qr-cam-step">
              <span class="qr-cam-step-num">1</span>
              <span>Ask the sender to open QR Drop and generate the code</span>
            </div>
            <div class="qr-cam-step">
              <span class="qr-cam-step-num">2</span>
              <span>Allow camera access below (works fully offline)</span>
            </div>
            <div class="qr-cam-step">
              <span class="qr-cam-step-num">3</span>
              <span>Keep the QR inside the frame and hold steady</span>
            </div>
          </div>
          <button class="btn btn-primary" id="grant-cam-btn" style="margin-top:16px;width:100%;">
            ${icon('camera')} Allow Camera &amp; Start Scanning
          </button>
        </div>

        <div class="hidden" id="cam-active">
          <div class="qr-instruction" style="margin:12px 14px 0;">
            ${icon('info')}
            <span>Keep the QR fully visible inside the frame. Use the torch in low light. For multi-part QRs, hold each part steady until captured.</span>
          </div>

          <div class="scanner-wrap">
            <video id="import-video" class="scanner-video" autoplay playsinline muted></video>
            <div class="scanner-overlay">
              <div class="scanner-frame"></div>
              <div class="scan-line"></div>
            </div>
            <button class="torch-btn hidden" id="torch-btn" aria-label="Toggle torch">
              ${icon('flashlight')}
            </button>
          </div>

          <button class="btn btn-secondary btn-full" id="scan-stop-btn" style="margin:10px 14px 0;">
            ${icon('close')} Stop Camera
          </button>

          <div class="hidden qr-multi-tracker" id="multi-tracker">
            <div class="qr-multi-label">MULTI-PART QR</div>
            <div id="multi-progress" class="qr-multi-progress"></div>
            <div id="multi-dots" class="qr-multi-dots"></div>
          </div>
        </div>

      </div>

    </div>
  `;

  _activeFilter = '';
  _allMsgs = [];

  const resetImport = _wireImportPanel(container);
  _wireTabSwitcher(container, resetImport);
  _wireExportPanel(container);
  _loadMsgList(container);
}

export function cleanupQRScreen() {
  stopQRScanner();
  clearTimeout(_bannerTimer);
  _allMsgs = [];
}

// ─── Full-screen Notification (Sent / Received) ───────────────────

let _qrFsEl    = null;
let _qrFsTimer = null;

function _showFullscreen(variant, title, subtitle, body) {
  if (_qrFsEl) { clearTimeout(_qrFsTimer); _qrFsEl.remove(); _qrFsEl = null; }

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
      <div class="fs-notif-title">${_esc(title)}</div>
      ${subtitle ? `<div class="fs-notif-subtitle">${_esc(subtitle)}</div>` : ''}
      ${body     ? `<div class="fs-notif-body">${_esc(body)}</div>`         : ''}
      <button class="fs-notif-close-btn" style="--accent:${accentColor};">OK</button>
    </div>
  `;
  document.body.appendChild(el);
  _qrFsEl = el;

  requestAnimationFrame(() => el.classList.add('fs-show'));

  const close = () => {
    clearTimeout(_qrFsTimer);
    el.classList.replace('fs-show', 'fs-hide');
    setTimeout(() => { if (_qrFsEl === el) _qrFsEl = null; el.remove(); }, 380);
  };
  el.querySelector('.fs-notif-close-btn').addEventListener('click', close);
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
  _qrFsTimer = setTimeout(close, 6000);
}

// ─── Notification Banner ─────────────────────────────────────────

function _showBanner(container, type, iconName, title, sub = '') {
  clearTimeout(_bannerTimer);
  const slot = container.querySelector('#qr-banner-slot');
  if (!slot) return;

  const variantClass = type === 'success' ? 't-banner-success'
                     : type === 'error'   ? 't-banner-error'
                     : type === 'warn'    ? 't-banner-warn'
                     :                     't-banner-info';

  slot.innerHTML = `
    <div class="t-banner ${variantClass}" role="alert">
      <span class="t-banner-icon">${icon(iconName)}</span>
      <div class="t-banner-body">
        <div class="t-banner-title">${title}</div>
        ${sub ? `<div class="t-banner-sub">${sub}</div>` : ''}
      </div>
      <button class="t-banner-close" aria-label="Dismiss">${icon('close')}</button>
    </div>
  `;

  slot.querySelector('.t-banner-close').addEventListener('click', () => {
    slot.innerHTML = '';
    clearTimeout(_bannerTimer);
  });

  _bannerTimer = setTimeout(() => { slot.innerHTML = ''; }, 6000);
}

// ─── Tab Switcher ─────────────────────────────────────────────────

function _wireTabSwitcher(container, resetImport) {
  const exportTab = container.querySelector('#tab-export');
  const importTab = container.querySelector('#tab-import');

  const exportPanel = container.querySelector('#export-panel');
  const importPanel = container.querySelector('#import-panel');

  const tabs   = [exportTab, importTab];
  const panels = [exportPanel, importPanel];

  function activate(targetTab, targetPanel, doReset) {
    tabs.forEach((t, i) => {
      const isActive = t === targetTab;
      t.classList.toggle('active', isActive);
      t.setAttribute('aria-selected', String(isActive));
      t.tabIndex = isActive ? 0 : -1;
      panels[i].classList.toggle('hidden', !isActive);
    });
    if (doReset) resetImport();
  }

  exportTab.addEventListener('click', () => activate(exportTab, exportPanel, true));
  importTab.addEventListener('click', () => activate(importTab, importPanel, false));

  tabs.forEach((tab) => {
    tab.addEventListener('keydown', (e) => {
      const idx = tabs.indexOf(tab);
      if (e.key === 'ArrowRight') { tabs[(idx + 1) % tabs.length].focus(); tabs[(idx + 1) % tabs.length].click(); }
      if (e.key === 'ArrowLeft')  { tabs[(idx + tabs.length - 1) % tabs.length].focus(); tabs[(idx + tabs.length - 1) % tabs.length].click(); }
    });
  });
}

// ─── Export Panel ─────────────────────────────────────────────────

async function _loadMsgList(container) {
  const listEl = container.querySelector('#qr-msg-list');
  if (!listEl) return;
  const now = Date.now();
  const all = await getMessages();
  _allMsgs  = all.filter((m) => m.expiresAt > now);
  _renderMsgList(container);
}

function _renderMsgList(container) {
  const listEl  = container.querySelector('#qr-msg-list');
  const countEl = container.querySelector('#qr-sel-count');
  if (!listEl) return;

  const visible = _activeFilter
    ? _allMsgs.filter((m) => m.type === _activeFilter)
    : _allMsgs;

  if (visible.length === 0) {
    listEl.innerHTML = `
      <div class="qr-empty-state">
        <span class="qr-empty-icon">${icon('share')}</span>
        <div class="qr-empty-title">No Messages to Share</div>
        <div class="qr-empty-sub">
          ${_activeFilter
            ? 'No messages of this type. Try a different filter above.'
            : 'Create messages in the Feed tab first, then return here to share them offline.'}
        </div>
      </div>`;
    if (countEl) countEl.textContent = '0 selected';
    return;
  }

  const now = Date.now();
  listEl.innerHTML = visible.map((m) => {
    const cfg   = TYPE_CFG[m.type] || TYPE_CFG.info;
    const ttlMs = m.expiresAt - now;
    const ttl   = ttlMs < 3_600_000
      ? `${Math.floor(ttlMs / 60_000)}m`
      : ttlMs < 86_400_000
        ? `${Math.floor(ttlMs / 3_600_000)}h`
        : `${Math.floor(ttlMs / 86_400_000)}d`;

    return `
      <label class="qr-msg-row" data-id="${_esc(m.id)}" role="listitem">
        <input type="checkbox" class="qr-msg-chk" data-id="${_esc(m.id)}" checked aria-label="Select ${_esc(m.title)}" />
        <span class="qr-msg-type-bar" style="background:${cfg.color};"></span>
        <span class="qr-msg-type-icon" style="color:${cfg.color};">${icon(cfg.iconName)}</span>
        <div class="qr-msg-info">
          <div class="qr-msg-title">${_esc(m.title)}</div>
          <div class="qr-msg-meta">
            <span class="qr-msg-tag" style="color:${cfg.color};">${cfg.label}</span>
            <span class="qr-msg-sep">·</span>
            ${icon('clock')} <span>${ttl} left</span>
            ${m.hops > 0 ? `<span class="qr-msg-sep">·</span>${icon('hop')} <span>${m.hops}</span>` : ''}
          </div>
        </div>
      </label>
    `;
  }).join('');

  function updateCount() {
    const n = listEl.querySelectorAll('.qr-msg-chk:checked').length;
    if (countEl) countEl.textContent = `${n} selected`;
  }
  listEl.querySelectorAll('.qr-msg-chk').forEach((c) => c.addEventListener('change', updateCount));
  updateCount();
}

function _getSelectedIds(container) {
  return [...container.querySelectorAll('.qr-msg-chk:checked')].map((c) => c.dataset.id);
}

function _wireExportPanel(container) {
  container.querySelector('#qr-cat-strip').addEventListener('click', (e) => {
    const btn = e.target.closest('.qr-filter-chip');
    if (!btn) return;
    container.querySelectorAll('.qr-filter-chip').forEach((b) => {
      b.classList.remove('active');
      b.setAttribute('aria-pressed', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-pressed', 'true');
    _activeFilter = btn.dataset.type;
    _renderMsgList(container);
  });

  container.querySelector('#qr-select-all').addEventListener('click', () => {
    container.querySelectorAll('.qr-msg-chk').forEach((c) => { c.checked = true; });
    const n  = container.querySelectorAll('.qr-msg-chk').length;
    const el = container.querySelector('#qr-sel-count');
    if (el) el.textContent = `${n} selected`;
  });
  container.querySelector('#qr-select-none').addEventListener('click', () => {
    container.querySelectorAll('.qr-msg-chk').forEach((c) => { c.checked = false; });
    const el = container.querySelector('#qr-sel-count');
    if (el) el.textContent = '0 selected';
  });

  container.querySelector('#qr-gen-btn').addEventListener('click', async () => {
    const btn     = container.querySelector('#qr-gen-btn');
    const display = container.querySelector('#qr-display-area');
    const ids     = _getSelectedIds(container);

    if (ids.length === 0) {
      _showBanner(container, 'warn', 'alert', 'Nothing Selected', 'Check at least one message to generate a QR code.');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = `${icon('qr')} Generating…`;
    display.classList.add('hidden');
    display.innerHTML = '';

    try {
      const now  = Date.now();
      const msgs = _allMsgs.filter((m) => ids.includes(m.id) && m.expiresAt > now);

      if (msgs.length === 0) {
        _showBanner(container, 'warn', 'alert', 'Messages Expired', 'Selected messages have expired. Reload the list.');
        return;
      }

      const canvases = await bundlesToQR(msgs);
      display.classList.remove('hidden');

      const qrWrap = document.createElement('div');
      qrWrap.className = 'qr-result-card';

      const minTTL = Math.min(...msgs.map((m) => (m.expiresAt - now) / 3_600_000));
      qrWrap.innerHTML = `
        <div class="qr-result-header">
          <span class="qr-result-badge">${icon('share')} ${msgs.length} msg${msgs.length !== 1 ? 's' : ''}</span>
          <span class="qr-result-badge">${icon('clock')} ${minTTL.toFixed(1)}h TTL</span>
          ${canvases.length > 1
            ? `<span class="qr-result-badge qr-badge-warn">${icon('alert')} ${canvases.length} parts</span>`
            : ''}
        </div>
        <div class="qr-canvas-wrap" id="qr-slot"></div>
        ${canvases.length > 1 ? `
          <div class="qr-carousel-nav">
            <button class="btn btn-secondary btn-sm" id="qr-prev">&#8249;</button>
            <span class="qr-carousel-ctr" id="qr-ctr">1 / ${canvases.length}</span>
            <button class="btn btn-secondary btn-sm" id="qr-next">&#8250;</button>
          </div>
          <div class="qr-carousel-hint">
            ${icon('info')} Show each QR in order — the scanner collects all parts automatically.
          </div>
        ` : ''}
        <div class="qr-scan-hint">
          ${icon('device')} Hold screen fully visible and steady toward the other device.
        </div>
      `;
      display.appendChild(qrWrap);

      const slot = qrWrap.querySelector('#qr-slot');
      if (canvases.length === 1) {
        slot.appendChild(canvases[0]);
        _showBanner(container, 'success', 'check', 'QR Ready', 'Show this to the other device to share your messages.');
        setTimeout(() => display.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
      } else {
        let idx = 0;
        const showSlide = (i) => {
          slot.innerHTML = '';
          slot.appendChild(canvases[i]);
          const ctr = qrWrap.querySelector('#qr-ctr');
          if (ctr) ctr.textContent = `${i + 1} / ${canvases.length}`;
          qrWrap.querySelector('#qr-prev').disabled = i === 0;
          qrWrap.querySelector('#qr-next').disabled = i === canvases.length - 1;
        };
        qrWrap.querySelector('#qr-prev').addEventListener('click', () => { if (idx > 0) showSlide(--idx); });
        qrWrap.querySelector('#qr-next').addEventListener('click', () => { if (idx < canvases.length - 1) showSlide(++idx); });
        showSlide(0);
        _showBanner(container, 'info', 'info', `${canvases.length}-Part QR`, 'Show each QR in order — the scanner will collect all parts.');
        setTimeout(() => display.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
      }
    } catch (err) {
      _showBanner(container, 'error', 'alert', 'Generation Failed', err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${icon('qr')} Generate QR`;
    }
  });

  container.querySelector('#qr-send-btn').addEventListener('click', async () => {
    const btn       = container.querySelector('#qr-send-btn');
    const openPeers = getPeers().filter((p) => p.status === 'open');

    if (openPeers.length === 0) {
      _showBanner(container, 'warn', 'wifi', 'No Peers Connected', 'Go to the Connect tab and pair a device first.');
      return;
    }

    const ids = _getSelectedIds(container);
    if (ids.length === 0) {
      _showBanner(container, 'warn', 'alert', 'Nothing Selected', 'Check at least one message to send to peers.');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = `${icon('send')} Sending…`;
    try {
      await Promise.all(openPeers.map((p) => requestSync(p.peerId)));
      const n = openPeers.length;
      _showFullscreen(
        'success',
        'Sent Successfully',
        `${ids.length} message${ids.length > 1 ? 's' : ''} sent to ${n} peer${n > 1 ? 's' : ''}`,
        'Messages are now relayed over the mesh network.'
      );
    } catch (err) {
      _showFullscreen('danger', 'Send Failed', err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${icon('send')} Send to Peers`;
    }
  });
}

// ─── Import Panel ─────────────────────────────────────────────────

function _wireImportPanel(container) {
  const grantBtn  = container.querySelector('#grant-cam-btn');
  const camPrompt = container.querySelector('#cam-prompt');
  const camActive = container.querySelector('#cam-active');
  const stopBtn   = container.querySelector('#scan-stop-btn');
  const torchBtn  = container.querySelector('#torch-btn');
  const video     = container.querySelector('#import-video');
  const tracker   = container.querySelector('#multi-tracker');
  const progress  = container.querySelector('#multi-progress');
  const dots      = container.querySelector('#multi-dots');

  const parts = new Map();
  let expectedTotal    = null;
  let lastSingleScanMs = 0;

  function resetState() {
    parts.clear();
    expectedTotal    = null;
    lastSingleScanMs = 0;
    stopQRScanner();
    if (video) video.srcObject = null;
    camPrompt.classList.remove('hidden');
    camActive.classList.add('hidden');
    torchBtn.classList.add('hidden');
    torchBtn.classList.remove('on');
    torchBtn.innerHTML = icon('flashlight');
    tracker.classList.add('hidden');
    grantBtn.disabled = false;
    grantBtn.innerHTML = `${icon('camera')} Allow Camera &amp; Start Scanning`;
  }

  function updateTracker() {
    if (!expectedTotal || expectedTotal <= 1) { tracker.classList.add('hidden'); return; }
    tracker.classList.remove('hidden');
    progress.textContent = `Captured ${parts.size} of ${expectedTotal} parts`;
    dots.innerHTML = '';
    for (let i = 1; i <= expectedTotal; i++) {
      const d = document.createElement('div');
      const got = parts.has(i);
      d.className = 'qr-multi-dot' + (got ? ' qr-multi-dot-done' : '');
      dots.appendChild(d);
    }
  }

  async function handleScan({ bundles, part, total }) {
    const now = Date.now();
    if (total === 1) {
      if (now - lastSingleScanMs < 3000) return;
      lastSingleScanMs = now;
      await _saveBundles(bundles, container);
      _loadMsgList(container);
      return;
    }
    if (!expectedTotal) expectedTotal = total;
    if (parts.has(part)) return;
    parts.set(part, bundles);
    updateTracker();

    if (parts.size === expectedTotal) {
      const all = [];
      for (let i = 1; i <= expectedTotal; i++) all.push(...(parts.get(i) || []));
      parts.clear(); expectedTotal = null;
      tracker.classList.add('hidden');
      await _saveBundles(all, container);
      _loadMsgList(container);
    } else {
      _showBanner(container, 'info', 'info', `Part ${part} of ${total} Captured`, 'Keep scanning — show the next QR code.');
    }
  }

  grantBtn.addEventListener('click', async () => {
    if (!window.isSecureContext) {
      _showBanner(container, 'error', 'lock', 'HTTPS Required', 'Camera access requires a secure connection.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      _showBanner(container, 'error', 'alert', 'Camera Not Supported', 'Try Chrome or Safari on a recent version.');
      return;
    }
    grantBtn.disabled = true;
    grantBtn.innerHTML = `${icon('camera')} Starting camera…`;
    try {
      camPrompt.classList.add('hidden');
      camActive.classList.remove('hidden');
      await startQRScanner(video, handleScan);
      setTimeout(() => { if (isTorchAvailable()) torchBtn.classList.remove('hidden'); }, 800);
    } catch (err) {
      resetState();
      const msg = err.name === 'NotAllowedError'  ? 'Camera denied — enable Camera in site settings.' :
                  err.name === 'NotFoundError'    ? 'No camera found on this device.' :
                  err.name === 'NotReadableError' ? 'Camera is in use by another app.' :
                                                    err.message;
      _showBanner(container, 'error', 'alert', 'Camera Error', msg);
    }
  });

  stopBtn.addEventListener('click', resetState);

  torchBtn.addEventListener('click', async () => {
    const on = await toggleTorch();
    torchBtn.classList.toggle('on', on);
  });

  return resetState;
}

async function _saveBundles(bundles, container) {
  const now = Date.now();
  let saved = 0;
  let dupes = 0;
  let replaced = 0;
  let merged = 0;
  for (const b of bundles) {
    if (!b.expiresAt || b.expiresAt <= now) continue;
    try {
      const result = await saveMessage(b, { mode: 'scan' });
      if (result.status === 'created') saved++;
      else if (result.status === 'updated') replaced++;
      else if (result.status === 'merged') merged++;
      else dupes++;
    } catch (e) {
      console.warn(e.message);
    }
  }

  const changed = saved + replaced + merged;
  if (changed > 0) {
    const detail = [
      saved     > 0 ? `${saved} new`        : '',
      replaced  > 0 ? `${replaced} updated`  : '',
      merged    > 0 ? `${merged} merged`     : '',
      dupes     > 0 ? `${dupes} unchanged`   : '',
    ].filter(Boolean).join(' · ');
    _showFullscreen(
      'success',
      'Received Successfully',
      `${changed} message${changed > 1 ? 's' : ''} saved to your feed`,
      detail
    );
    window.dispatchEvent(new CustomEvent('meshdrop:bundles-updated', {
      detail: { source: 'qr-scan', count: changed },
    }));
  } else {
    _showBanner(container, 'info', 'info', 'Nothing New', `Already have all ${bundles.length} message${bundles.length > 1 ? 's' : ''}.`);
  }
}

function _esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

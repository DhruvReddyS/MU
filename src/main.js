// TRINETRA — Main entry point v2
import './style.css';
import {
  dbPromise,
  saveMessage,
  getMessages,
  getMessageIds,
  deleteExpiredMessages,
  purgeMessage,
} from './lib/db.js';
import { startScheduler } from './lib/scheduler.js';
import {
  generateSessionKeypair,
  getSessionPublicKey,
  encryptDM,
  decryptDM,
  generateBundleId,
} from './lib/crypto.js';
import {
  bundlesToQR,
  decodeQRPayload,
  startQRScanner,
  stopQRScanner,
} from './lib/qr.js';
import { getPeers, disconnectAll, sendToPeer } from './lib/webrtc.js';
import { getContactAlias } from './lib/identity.js';
import { initSync } from './lib/sync.js';
import { haptic } from './lib/haptic.js';
import { initBeacon, handleIncomingBeacon, BEACON_MSG } from './lib/beacon.js';
import { initDeadMan } from './lib/deadman.js';
import { getPeerPublicKey, setPeerPublicKey, clearPeerKey } from './lib/peer-keys.js';
import {
  storeMessage,
  incrementUnread,
  getTotalUnread,
  pruneExpiredDMs,
} from './lib/dm-store.js';
import { initAlertsScreen, refreshAlertsScreen } from './ui/alerts-screen.js';
import { renderQRScreen, cleanupQRScreen } from './ui/qr-screen.js';
import { renderFeedScreen, cleanupFeedScreen } from './ui/feed-screen.js';
import { renderConnectScreen, cleanupConnectScreen, updateConnectionBadge } from './ui/connect-screen.js';
import { renderDMScreen, cleanupDMScreen } from './ui/dm-screen.js';
import { renderSettingsScreen, cleanupSettingsScreen } from './ui/settings-screen.js';
import { renderMapScreen, cleanupMapScreen } from './ui/map-screen.js';
import { icon } from './ui/icons.js';

// Expose for console testing
window.trinetra = {
  saveMessage, getMessages, getMessageIds, deleteExpiredMessages, purgeMessage,
  generateSessionKeypair, getSessionPublicKey, encryptDM, decryptDM, generateBundleId,
  bundlesToQR, decodeQRPayload, startQRScanner, stopQRScanner,
  getPeers, disconnectAll, initSync,
};

// ─── App State ───────────────────────────────────────────────────

let currentScreen = 'feed';
let logoTapCount  = 0;
let logoTapTimer  = null;
let syncCount     = 0;

const SESSION_REFRESH_MESSAGE = 'Session reset — reconnect to resume.';

const BLACKOUT_KEY = 'trinetra_blackout';
const DISGUISE_KEY = 'trinetra_disguise';

// ─── Global DM listener (always-on regardless of active screen) ───

const MSG_DM           = 'DM_SEND';
const MSG_DM_VOICE     = 'DM_VOICE';
const MSG_KEY_EXCHANGE = 'KEY_EXCHANGE';
const _CRYPTO          = !!(window?.crypto?.subtle);

function _initGlobalDMListener() {
  // When a peer connects, immediately send our ECDH public key for encrypted DMs
  window.addEventListener('meshdrop:peer-connected', async (e) => {
    const { peerId } = e.detail || {};
    if (!peerId) return;
    haptic('connect');
    try {
      const myPubKey = await getSessionPublicKey();
      if (myPubKey) sendToPeer(peerId, { type: MSG_KEY_EXCHANGE, payload: { publicKey: myPubKey } });
    } catch {}
  });

  // Clean up keys when peer disconnects
  window.addEventListener('meshdrop:peer-disconnected', (e) => {
    const { peerId } = e.detail || {};
    if (peerId) { clearPeerKey(peerId); haptic('medium'); }
  });

  window.addEventListener('meshdrop:peer-message', async (e) => {
    const { peerId, message } = e.detail || {};
    if (!peerId || !message) return;

    // Handle key exchange
    if (message.type === MSG_KEY_EXCHANGE) {
      const key = message.payload?.publicKey;
      if (key) setPeerPublicKey(peerId, key);
      return;
    }

    // Live location beacon
    if (message.type === BEACON_MSG) {
      const shortId = peerId.replace(/-/g,'').slice(0, 8).toUpperCase();
      handleIncomingBeacon(shortId, message.payload);
      return;
    }

    // Voice DM
    if (message.type === MSG_DM_VOICE) {
      const voice   = message.payload?.voice;
      const from    = message.payload?.from || peerId.slice(0, 8).toUpperCase();
      const shortId = peerId.replace(/-/g,'').slice(0, 8).toUpperCase();
      if (!voice) return;
      const entry = { text: '🎤 Voice message', voice, from, ts: Date.now(), isSent: false, shortId };
      storeMessage(shortId, entry);
      haptic('message');
      if (currentScreen !== 'dm') {
        incrementUnread(shortId);
        _updateDMBadge();
        showDMToast(getContactAlias(shortId), '🎤 Voice message', shortId);
      }
      window.dispatchEvent(new CustomEvent('meshdrop:dm-message-stored', { detail: { shortId, entry } }));
      return;
    }

    if (message.type !== MSG_DM) return;

    const from    = message.payload?.from || peerId.slice(0, 8).toUpperCase();
    const shortId = peerId.replace(/-/g,'').slice(0, 8).toUpperCase();

    // Decrypt if sender used encryption
    let text;
    if (message.payload?.encrypted && _CRYPTO) {
      const senderPubKey = getPeerPublicKey(peerId);
      if (senderPubKey) {
        try {
          text = await decryptDM(message.payload.ciphertext, message.payload.iv, senderPubKey);
        } catch {
          text = '🔒 [decryption failed — session mismatch]';
        }
      } else {
        text = '🔒 [encrypted — key not yet received]';
      }
    } else {
      text = message.payload?.text;
    }

    if (!text) return;

    const entry = { text, from, ts: Date.now(), isSent: false, shortId };
    storeMessage(shortId, entry);

    haptic('message');
    if (currentScreen !== 'dm') {
      incrementUnread(shortId);
      _updateDMBadge();

      const alias   = getContactAlias(shortId);
      const preview = text.length > 55 ? text.slice(0, 55) + '…' : text;
      showDMToast(alias, preview, shortId);
    }

    window.dispatchEvent(new CustomEvent('meshdrop:dm-message-stored', {
      detail: { shortId, entry },
    }));
  });
}

function _updateDMBadge() {
  const badge = document.getElementById('dm-badge');
  if (!badge) return;
  const count = getTotalUnread();
  if (count > 0 && currentScreen !== 'dm') {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.style.display = 'block';
  } else {
    badge.style.display = 'none';
  }
}

function _wasReloadNavigation() {
  const navEntry = performance.getEntriesByType?.('navigation')?.[0];
  if (navEntry?.type) return navEntry.type === 'reload';

  const legacyNavigation = performance.navigation;
  return legacyNavigation?.type === legacyNavigation?.TYPE_RELOAD;
}

function _handleSessionUnload() {
  try {
    disconnectAll();
  } catch {}
}

// ─── App Shell ───────────────────────────────────────────────────

function _showSplash() {
  const splash = document.createElement('div');
  splash.id = 'trinetra-splash';
  splash.innerHTML = `
    <div class="splash-glow-ring"></div>
    <div class="splash-grid" aria-hidden="true"></div>
    <div class="splash-emitter splash-emitter-1" aria-hidden="true"></div>
    <div class="splash-emitter splash-emitter-2" aria-hidden="true"></div>
    <div class="splash-emitter splash-emitter-3" aria-hidden="true"></div>
    <div class="splash-mark-wrap">
      <span class="splash-orbit splash-orbit-outer"></span>
      <span class="splash-orbit splash-orbit-mid"></span>
      <span class="splash-orbit splash-orbit-inner"></span>
      <svg class="splash-logo-svg" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-label="TRINETRA logo" role="img">
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2.5" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <polygon points="60,7 113,100 7,100" fill="rgba(196,26,26,0.07)" stroke="#c41a1a" stroke-width="2.8" stroke-linejoin="round" filter="url(#glow)"/>
        <polygon points="60,26 94,88 26,88" fill="none" stroke="rgba(196,26,26,0.4)" stroke-width="1.5" stroke-linejoin="round"/>
        <line x1="60" y1="26" x2="60" y2="42" stroke="rgba(196,26,26,0.3)" stroke-width="1"/>
        <ellipse cx="60" cy="70" rx="14" ry="10" fill="none" stroke="#c41a1a" stroke-width="1.8" filter="url(#glow)"/>
        <circle cx="60" cy="70" r="5.5" fill="#c41a1a" filter="url(#glow)"/>
        <circle cx="62.5" cy="67.5" r="2" fill="rgba(255,255,255,0.55)"/>
        <line x1="30" y1="70" x2="43" y2="70" stroke="rgba(196,26,26,0.45)" stroke-width="1.2"/>
        <line x1="77" y1="70" x2="90" y2="70" stroke="rgba(196,26,26,0.45)" stroke-width="1.2"/>
        <circle cx="60" cy="26" r="2.5" fill="rgba(196,26,26,0.7)"/>
        <circle cx="26" cy="88" r="2.5" fill="rgba(196,26,26,0.7)"/>
        <circle cx="94" cy="88" r="2.5" fill="rgba(196,26,26,0.7)"/>
      </svg>
      <div class="splash-sparks" aria-hidden="true">
        <span class="splash-spark s-sp1"></span><span class="splash-spark s-sp2"></span>
        <span class="splash-spark s-sp3"></span><span class="splash-spark s-sp4"></span>
        <span class="splash-spark s-sp5"></span><span class="splash-spark s-sp6"></span>
      </div>
    </div>
    <div class="splash-wordmark">
      <span class="splash-wordmark-text" aria-label="TRINETRA">TRINETRA</span>
    </div>
    <div class="splash-status-line">
      <span class="splash-status-dot"></span>
      <span class="splash-status-text">INITIALIZING TRINETRA</span>
    </div>
    <div class="splash-strap">SEE BEYOND THE BLACKOUT</div>
    <div class="splash-scanline"></div>
    <div class="splash-progress"><div class="splash-progress-fill"></div></div>
  `;
  document.getElementById('app').appendChild(splash);
  return splash;
}

function initApp() {
  const app = document.getElementById('app');

  app.innerHTML = `
    <header class="app-header">
      <div class="app-brand" id="app-logo" title="Tap 5× for emergency wipe">
        <span class="header-mark-shell">
          <img class="header-logo-img" src="/branding/trinetra-mark.png" alt="TRINETRA logo" />
        </span>
        <img class="app-wordmark-img" src="/branding/trinetra-wordmark.png" alt="TRINETRA" />
      </div>
      <div class="app-status" id="app-status-wrap">
        <span class="status-dot standalone" id="status-dot"></span>
        <span id="status-text" class="status-text-label"></span>
      </div>
    </header>

    <div class="app-body">
      <div class="app-body-bg" aria-hidden="true"></div>
      <div class="app-content-wrap">
        <section id="alerts-root"></section>
        <main class="app-main" id="app-main"></main>
      </div>
    </div>

    <nav class="bottom-nav" id="bottom-nav">
      <button class="nav-item active" data-screen="feed">
        ${icon('feed')}
        <span class="nav-label">Feed</span>
      </button>
      <button class="nav-item" data-screen="connect">
        ${icon('signal')}
        <span class="nav-label">Connect</span>
      </button>
      <button class="nav-item" data-screen="map">
        ${icon('mappin')}
        <span class="nav-label">Map</span>
      </button>
      <button class="nav-item" data-screen="qr">
        ${icon('qr')}
        <span class="nav-label">QR Drop</span>
      </button>
      <button class="nav-item" data-screen="dm" id="nav-dm">
        <span style="position:relative;display:inline-flex;">
          ${icon('dm')}
          <span id="dm-badge" style="display:none;position:absolute;top:-5px;right:-8px;background:var(--red);color:#fff;font-size:0.6rem;font-weight:800;border-radius:10px;padding:1px 5px;min-width:17px;text-align:center;line-height:1.5;"></span>
        </span>
        <span class="nav-label">Messages</span>
      </button>
      <button class="nav-item" data-screen="settings">
        ${icon('settings')}
        <span class="nav-label">System</span>
      </button>
    </nav>

    <div class="app-toast hidden" id="app-toast"></div>
  `;

  app.querySelectorAll('[data-screen]').forEach((item) => {
    item.addEventListener('click', () => {
      const screen = item.dataset.screen;
      if (screen === currentScreen) return;
      _setActiveNav(screen);
      navigateTo(screen);
    });
  });

  // Emergency wipe — 5 taps on logo within 2 seconds
  app.querySelector('#app-logo').addEventListener('click', () => {
    logoTapCount++;
    clearTimeout(logoTapTimer);
    logoTapTimer = setTimeout(() => { logoTapCount = 0; }, 2000);
    if (logoTapCount >= 5) {
      logoTapCount = 0;
      showEmergencyWipe();
    }
  });

  window.addEventListener('meshdrop:peer-connected',    _updateStatus);
  window.addEventListener('meshdrop:peer-disconnected', _updateStatus);
  window.addEventListener('meshdrop:bundles-updated',   _onBundlesUpdated);
  window.addEventListener('meshdrop:sync-start',        _onSyncStart);
  window.addEventListener('meshdrop:sync-complete',     _onSyncComplete);
  window.addEventListener('meshdrop:dm-message-stored', _onDMStored);
  window.addEventListener('meshdrop:show-toast', (e) => {
    const msg = e.detail?.message;
    if (msg) showToast(msg);
  });

  window._showEmergencyWipe = showEmergencyWipe;

  initAlertsScreen(app.querySelector('#alerts-root'));
  navigateTo('feed');
  refreshAlertsScreen();
}

// ─── Navigation ──────────────────────────────────────────────────

function _setActiveNav(screen) {
  document.querySelectorAll('[data-screen]').forEach((el) => {
    el.classList.toggle('active', el.dataset.screen === screen);
  });
}

function navigateTo(screen) {
  const cleaners = {
    feed:     cleanupFeedScreen,
    qr:       cleanupQRScreen,
    connect:  cleanupConnectScreen,
    dm:       cleanupDMScreen,
    map:      cleanupMapScreen,
    settings: cleanupSettingsScreen,
  };
  cleaners[currentScreen]?.();

  currentScreen = screen;
  const main = document.getElementById('app-main');

  const renderers = {
    feed:     renderFeedScreen,
    qr:       renderQRScreen,
    connect:  renderConnectScreen,
    dm:       renderDMScreen,
    map:      renderMapScreen,
    settings: renderSettingsScreen,
  };
  renderers[screen]?.(main);

  // Clear DM badge when entering Messages
  if (screen === 'dm') _updateDMBadge();

  _updateStatus();
  refreshAlertsScreen();
}

// ─── Status Updates ──────────────────────────────────────────────

function _updateStatus() {
  const count = getPeers().filter((p) => p.status === 'open').length;
  const dot   = document.getElementById('status-dot');
  const text  = document.getElementById('status-text');

  if (!dot || !text) return;

  if (count === 0) {
    dot.className    = syncCount > 0 ? 'status-dot syncing' : 'status-dot standalone';
    text.textContent = syncCount > 0 ? 'SYNCING' : 'READY';
  } else {
    dot.className    = 'status-dot connected';
    text.textContent = `${count} NODE${count > 1 ? 'S' : ''}`;
  }

  updateConnectionBadge(count);
}

async function _onBundlesUpdated(event) {
  refreshAlertsScreen();
  const source = event.detail?.source;
  const count  = event.detail?.count || 0;
  if (source === 'p2p-sync' && count > 0) {
    // Full-screen notification for incoming peer alerts/emergencies
    const { getMessages } = await import('./lib/db.js');
    const now     = Date.now();
    const all     = await getMessages();
    const fresh   = all.filter((m) => m.expiresAt > now && now - m.createdAt < 15_000);
    const topMsg  = fresh.sort((a, b) => (b.priority || 0) - (a.priority || 0))[0];
    const variant = topMsg?.type === 'emergency' ? 'danger'
                  : topMsg?.type === 'alert'     ? 'warn'
                  : 'success';
    showFullscreenNotif({
      variant,
      title:    'Alert Received',
      subtitle: topMsg?.title || `${count} new message${count > 1 ? 's' : ''} from the mesh`,
      body:     topMsg?.body ? topMsg.body.slice(0, 100) : undefined,
      autoClose: 7000,
    });
  }
}

function _onSyncStart() {
  syncCount += 1;
  _updateStatus();
}

function _onSyncComplete() {
  syncCount = Math.max(0, syncCount - 1);
  _updateStatus();
}

function _onDMStored(e) {
  // Update badge — the global DM listener in _initGlobalDMListener handles
  // badge updates for messages from peers. This catches the case where the
  // DM screen dispatches its own events.
  _updateDMBadge();
}

// ─── Toast ────────────────────────────────────────────────────────

let _toastTimer    = null;
let _toastHideTimer = null;

export function showToast(message, duration = 3000) {
  const toast = document.getElementById('app-toast');
  if (!toast) return;

  // Clear any existing DM toast
  _hideDMToast();

  clearTimeout(_toastTimer);
  clearTimeout(_toastHideTimer);

  toast.textContent = message;
  toast.className   = 'app-toast toast-show';

  _toastTimer = setTimeout(() => {
    toast.classList.replace('toast-show', 'toast-hide');
    _toastHideTimer = setTimeout(() => { toast.className = 'app-toast'; }, 320);
  }, duration);
}

// ─── DM Toast (rich card, clickable, at top) ──────────────────────

let _dmToastTimer = null;
let _dmToastEl    = null;

export function showDMToast(alias, preview, shortId, duration = 5000) {
  _hideDMToast(true);

  const card = document.createElement('div');
  card.className = 'dm-toast-card';
  card.innerHTML = `
    <div class="dm-toast-avatar">${_esc2(alias.slice(0,2).toUpperCase())}</div>
    <div class="dm-toast-body">
      <div class="dm-toast-label">New Message</div>
      <div class="dm-toast-alias">${_esc2(alias)}</div>
      <div class="dm-toast-preview">${_esc2(preview)}</div>
    </div>
    <div class="dm-toast-tap">${icon('back')} Open</div>
  `;
  card.querySelector('.dm-toast-tap .ui-icon')?.style?.setProperty('transform', 'rotate(180deg)');

  document.body.appendChild(card);
  _dmToastEl = card;

  requestAnimationFrame(() => card.classList.add('toast-show'));

  card.addEventListener('click', () => {
    _hideDMToast(true);
    _setActiveNav('dm');
    navigateTo('dm');
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('meshdrop:open-dm-thread', { detail: { shortId } }));
    }, 120);
  });

  _dmToastTimer = setTimeout(() => _hideDMToast(), duration);
}

function _hideDMToast(immediate = false) {
  clearTimeout(_dmToastTimer);
  if (!_dmToastEl) return;
  const el = _dmToastEl;
  _dmToastEl = null;
  if (immediate) {
    el.remove();
  } else {
    el.classList.replace('toast-show', 'toast-hide');
    setTimeout(() => el.remove(), 340);
  }
}

// ─── Full-screen Notification (QR Drop + Emergency alerts) ───────

let _fsNotifEl    = null;
let _fsNotifTimer = null;

export function showFullscreenNotif({ variant = 'success', title, subtitle, body, autoClose = 5000 }) {
  _hideFullscreenNotif(true);

  const isSuccess = variant === 'success';
  const isDanger  = variant === 'danger';

  const accentColor = isSuccess ? 'var(--green)' : isDanger ? 'var(--red)' : 'var(--amber)';
  const accentDim   = isSuccess ? 'var(--green-dim)' : isDanger ? 'var(--red-dim)' : 'var(--amber-dim)';
  const checkIcon   = isSuccess ? '✓' : isDanger ? '⚠' : 'ℹ';

  const el = document.createElement('div');
  el.className = 'fs-notif-overlay';
  el.innerHTML = `
    <div class="fs-notif-sheet">
      <div class="fs-notif-icon-ring" style="--accent:${accentColor};--accent-dim:${accentDim};">
        <span class="fs-notif-check">${checkIcon}</span>
      </div>
      <div class="fs-notif-title">${_esc2(title)}</div>
      ${subtitle ? `<div class="fs-notif-subtitle">${_esc2(subtitle)}</div>` : ''}
      ${body     ? `<div class="fs-notif-body">${_esc2(body)}</div>` : ''}
      <button class="fs-notif-close-btn" style="--accent:${accentColor};">OK</button>
    </div>
  `;

  document.body.appendChild(el);
  _fsNotifEl = el;

  requestAnimationFrame(() => el.classList.add('fs-show'));

  el.querySelector('.fs-notif-close-btn').addEventListener('click', () => _hideFullscreenNotif(true));
  el.addEventListener('click', (e) => { if (e.target === el) _hideFullscreenNotif(true); });

  if (autoClose > 0) _fsNotifTimer = setTimeout(() => _hideFullscreenNotif(), autoClose);
}

function _hideFullscreenNotif(immediate = false) {
  clearTimeout(_fsNotifTimer);
  if (!_fsNotifEl) return;
  const el = _fsNotifEl;
  _fsNotifEl = null;
  if (immediate) {
    el.remove();
  } else {
    el.classList.replace('fs-show', 'fs-hide');
    setTimeout(() => el.remove(), 380);
  }
}

function _esc2(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Emergency Wipe ──────────────────────────────────────────────

function showEmergencyWipe() {
  const overlay = document.createElement('div');
  overlay.className = 'wipe-overlay';
  overlay.innerHTML = `
    <div class="wipe-dialog">
      <h2>⚠ Emergency Wipe</h2>
      <p>
        Permanently deletes all messages, keys, contacts, and settings from this device.
        Connected peers keep their copies. Cannot be undone.
      </p>
      <div class="wipe-confirm-row">
        <label class="wipe-confirm-label" for="wipe-input">
          Type <strong>WIPE</strong> to confirm
        </label>
        <input
          class="form-input wipe-confirm-input"
          id="wipe-input"
          type="text"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          placeholder="WIPE"
          maxlength="4"
        />
      </div>
      <div class="wipe-dialog-btns">
        <button class="btn btn-danger btn-full" id="confirm-wipe" disabled>Wipe All Data</button>
        <button class="btn btn-secondary btn-full" id="cancel-wipe">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const input   = overlay.querySelector('#wipe-input');
  const wipeBtn = overlay.querySelector('#confirm-wipe');

  input.addEventListener('input', () => {
    const valid = input.value.trim().toUpperCase() === 'WIPE';
    wipeBtn.disabled = !valid;
    input.classList.toggle('valid', valid);
  });

  input.focus();

  overlay.querySelector('#cancel-wipe').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#confirm-wipe').addEventListener('click', async () => {
    wipeBtn.disabled    = true;
    wipeBtn.textContent = 'Wiping…';
    await _performWipe();
  });
}

async function _performWipe() {
  disconnectAll();
  localStorage.clear();
  sessionStorage.clear();

  // Close the open IDB connection before deleting (prevents 'blocked' state)
  try {
    const db = await dbPromise;
    db.close();
  } catch {}

  const dbs = ['meshdrop-db', 'meshdrop-dm'];
  await Promise.all(dbs.map((name) =>
    new Promise((resolve) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = resolve;
      req.onerror   = resolve;
      req.onblocked = resolve;
    })
  ));

  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }

  location.reload();
}

// ─── Disguise Lock Screen ────────────────────────────────────────

function _showDisguiseLock(correctPin) {
  const overlay = document.createElement('div');
  overlay.id = 'disguise-overlay';
  overlay.innerHTML = `
    <div class="disguise-wrap">
      <div class="disguise-title">Enter PIN</div>
      <div class="disguise-dots" id="d-dots">
        <span class="d-dot"></span><span class="d-dot"></span>
        <span class="d-dot"></span><span class="d-dot"></span>
      </div>
      <div class="disguise-grid">
        ${[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map((k) => `
          <button class="d-key" data-key="${k}">${k}</button>
        `).join('')}
      </div>
      <div class="disguise-hint" id="d-hint"></div>
    </div>
  `;
  document.getElementById('app').appendChild(overlay);

  let entered = '';

  function _updateDots() {
    const dots = overlay.querySelectorAll('.d-dot');
    dots.forEach((d, i) => d.classList.toggle('filled', i < entered.length));
  }

  function _shake() {
    overlay.querySelector('.disguise-dots')?.classList.add('shake');
    setTimeout(() => overlay.querySelector('.disguise-dots')?.classList.remove('shake'), 500);
  }

  overlay.addEventListener('click', (e) => {
    const key = e.target.closest('.d-key')?.dataset.key;
    if (key === undefined || key === '') return;
    if (key === '⌫') {
      entered = entered.slice(0, -1);
    } else if (entered.length < correctPin.length) {
      entered += key;
    }
    _updateDots();
    if (entered.length === correctPin.length) {
      if (entered === correctPin) {
        overlay.classList.add('disguise-out');
        setTimeout(() => overlay.remove(), 400);
      } else {
        _shake();
        entered = '';
        setTimeout(_updateDots, 500);
      }
    }
  });
}

// ─── Initialization ──────────────────────────────────────────────

dbPromise.then(async () => {
  // Show TRINETRA splash while initialising
  const splash = _showSplash();

  await generateSessionKeypair();
  startScheduler();
  initSync();
  pruneExpiredDMs().catch(() => {});
  initApp();
  _initGlobalDMListener();

  // Restore blackout mode
  if (localStorage.getItem(BLACKOUT_KEY) === '1') {
    document.body.classList.add('blackout-mode');
  }

  // Init beacon (resumes broadcasting if was enabled)
  initBeacon();

  // Init dead man's switch (fires onFire if already past due)
  initDeadMan(async (message) => {
    const { saveMessage: _save } = await import('./lib/db.js');
    const { generateBundleId: _bid } = await import('./lib/crypto.js');
    const { pushMessage: _push } = await import('./lib/sync.js');
    const now  = Date.now();
    const id   = await _bid(message, now, 'dms');
    const msg  = {
      id, rootId: id, revision: 1, replaces: null,
      type: 'emergency', priority: 100,
      title: 'DEAD MAN\'S SWITCH TRIGGERED',
      body: message,
      bodyPreview: message.slice(0, 160), bodyState: 'full',
      fragments: [], fragmentCount: 1,
      createdAt: now, expiresAt: now + 4 * 3_600_000,
      ttl: 80, hops: 0, seenCount: 1, localSessionOwned: true,
    };
    await _save(msg, { mode: 'origin', localSessionOwned: true });
    const open = getPeers().filter((p) => p.status === 'open');
    await Promise.all(open.map((p) => _push(p.peerId, msg)));
    window.dispatchEvent(new CustomEvent('meshdrop:bundles-updated', { detail: { source: 'deadman' } }));
    showToast('⚠ Dead man\'s switch broadcast sent!', 6000);
  });

  // Disguise mode — show PIN lock if enabled
  try {
    const disguiseCfg = JSON.parse(localStorage.getItem(DISGUISE_KEY) || 'null');
    if (disguiseCfg?.enabled && disguiseCfg?.pin) {
      _showDisguiseLock(disguiseCfg.pin);
    }
  } catch {}

  if (_wasReloadNavigation()) {
    setTimeout(() => showToast(SESSION_REFRESH_MESSAGE, 5200), 250);
  }

  // Navigate to DM thread from notification tap
  window.addEventListener('meshdrop:open-dm-thread', (e) => {
    const { shortId } = e.detail || {};
    if (!shortId) return;
    if (currentScreen !== 'dm') {
      _setActiveNav('dm');
      navigateTo('dm');
    }
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('meshdrop:open-dm-thread-ready', { detail: { shortId } }));
    }, 150);
  });

  // Fade out splash after a short hold
  setTimeout(() => {
    splash.classList.add('splash-out');
    setTimeout(() => splash.remove(), 750);
  }, 1800);
}).catch((err) => {
  console.error('[TRINETRA] Init error:', err);
  document.getElementById('app').innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:100vh;padding:24px;text-align:center;">
      <div>
        <p style="color:#ff3b5c;font-size:1rem;font-weight:700;margin-bottom:8px;">Failed to start</p>
        <p style="color:#7986ab;font-size:0.875rem;">${err.message}</p>
      </div>
    </div>
  `;
});

window.addEventListener('beforeunload', _handleSessionUnload);
window.addEventListener('pagehide', _handleSessionUnload);

async function _cleanupAppServiceWorkers() {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  } catch {}

  if (!('caches' in window)) return;

  try {
    const cacheKeys = await caches.keys();
    const appCacheKeys = cacheKeys.filter((key) => /trinetra|workbox/i.test(key));
    await Promise.all(appCacheKeys.map((key) => caches.delete(key)));
  } catch {}
}

// Register the PWA service worker only in production. In development, the PWA
// plugin is disabled, so attempting to register /dev-sw.js only creates noise.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
    const isSecureOrigin = window.isSecureContext || isLocalhost;

    if (!isSecureOrigin) {
      console.info('[TRINETRA] Skipping service worker on non-secure origin:', window.location.origin);
      return;
    }

    if (!import.meta.env.PROD) {
      await _cleanupAppServiceWorkers();
      console.info('[TRINETRA] Skipping service worker registration in development mode.');
      return;
    }

    const swUrl = '/sw.js';

    try {
      const check = await fetch(swUrl, {
        method: 'HEAD',
        cache: 'no-store',
      });

      if (!check.ok) {
        console.info('[TRINETRA] Skipping service worker; script not available:', swUrl);
        return;
      }
    } catch {
      console.info('[TRINETRA] Skipping service worker; script could not be reached:', swUrl);
      return;
    }

    try {
      await navigator.serviceWorker.register(swUrl, { type: 'classic' });
    } catch (err) {
      console.warn('[TRINETRA] Service worker registration skipped:', err?.message || err);
    }
  });
}

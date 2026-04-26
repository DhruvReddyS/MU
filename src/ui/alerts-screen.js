/**
 * TRINETRA — Emergency Banner
 * Shows a persistent banner when type='emergency' messages are active.
 * Clicking opens a full-screen alert overlay.
 */
import { getMessages } from '../lib/db.js';
import { icon } from './icons.js';

let _bannerContainer = null;
let _overlayEl = null;

export function initAlertsScreen(container) {
  _bannerContainer = container;

  container.innerHTML = `
    <div class="emergency-banner hidden" id="emergency-banner" role="alert" aria-live="assertive">
      <div class="banner-scan"></div>
      <div class="banner-ttl-bar">
        <div class="banner-ttl-fill" id="banner-ttl-fill" style="width:100%"></div>
        <span class="banner-ttl-label" id="banner-ttl-label"></span>
      </div>
      <div class="banner-live-wrap">
        <span class="banner-live-dot"></span>
        <span class="banner-live-label">Live</span>
      </div>
      <div class="banner-body">
        <div class="banner-tag">Emergency Alert</div>
        <div class="banner-text" id="banner-text"></div>
      </div>
      <span class="banner-chevron">${icon('back')}</span>
    </div>
  `;

  // Replace any stale overlay so the alerts modal stays singleton-safe.
  _overlayEl?.remove();

  // Overlay is appended to body so it truly covers the full screen
  const overlay = document.createElement('div');
  overlay.className = 'emergency-overlay hidden';
  overlay.id = 'emergency-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div class="emergency-overlay-dialog">
      <div class="emergency-overlay-header">
        <div class="emergency-overlay-title">
          <span style="color:#ffa0a0;display:flex;align-items:center;">${icon('alert')}</span>
          <h3 style="font-size:1rem;font-weight:900;letter-spacing:0.04em;text-transform:uppercase;">Active Emergencies</h3>
        </div>
        <button class="emergency-overlay-close" id="emergency-close" aria-label="Close">
          ${icon('close')}
        </button>
      </div>
      <div class="emergency-overlay-body">
        <div id="emergency-list"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  _overlayEl = overlay;

  container.querySelector('#emergency-banner').addEventListener('click', async () => {
    overlay.classList.remove('hidden');
    requestAnimationFrame(() => overlay.classList.add('anim-in'));
    await _renderEmergencyList(overlay);
  });

  overlay.querySelector('#emergency-close').addEventListener('click', () => {
    overlay.classList.add('hidden');
    overlay.classList.remove('anim-in');
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.classList.add('hidden');
      overlay.classList.remove('anim-in');
    }
  });

  // Swipe down to close
  let _touchStartY = 0;
  const dialog = overlay.querySelector('.emergency-overlay-dialog');
  dialog.addEventListener('touchstart', (e) => { _touchStartY = e.touches[0].clientY; }, { passive: true });
  dialog.addEventListener('touchend', (e) => {
    const dy = e.changedTouches[0].clientY - _touchStartY;
    if (dy > 80) { overlay.classList.add('hidden'); overlay.classList.remove('anim-in'); }
  }, { passive: true });
}

export async function refreshAlertsScreen() {
  if (!_bannerContainer) return;

  const now      = Date.now();
  const all      = await getMessages({ type: 'emergency' });
  const active   = all
    .filter((m) => m.expiresAt > now)
    .sort((a, b) => (b.priority - a.priority) || (b.createdAt - a.createdAt));

  const banner   = _bannerContainer.querySelector('#emergency-banner');
  const bannerTxt = _bannerContainer.querySelector('#banner-text');
  if (!banner || !bannerTxt) return;

  if (active.length === 0) {
    banner.classList.add('hidden');
    if (_overlayEl) {
      _overlayEl.classList.add('hidden');
      _overlayEl.classList.remove('anim-in');
    }
    return;
  }

  // Show highest priority emergency
  const top      = active[0];
  const ttlMs    = top.expiresAt - now;
  const totalMs  = top.expiresAt - top.createdAt;
  const ttlPct   = Math.max(2, Math.min(100, Math.round((ttlMs / totalMs) * 100)));
  const ttlLabel = ttlMs < 3_600_000
    ? `${Math.floor(ttlMs / 60_000)}m left`
    : `${Math.floor(ttlMs / 3_600_000)}h left`;

  bannerTxt.textContent = top.title
    + (top.body ? ` — ${top.body.slice(0, 80)}` : '')
    + (top.bodyState === 'partial' ? ' [scoped copy]' : '');

  const ttlFill  = _bannerContainer.querySelector('#banner-ttl-fill');
  const ttlLabelEl = _bannerContainer.querySelector('#banner-ttl-label');
  if (ttlFill) ttlFill.style.width = ttlPct + '%';
  if (ttlLabelEl) ttlLabelEl.textContent = `${active.length > 1 ? active.length + ' active · ' : ''}${ttlLabel}`;

  // Update the tag to show count
  const tagEl = _bannerContainer.querySelector('.banner-tag');
  if (tagEl) tagEl.textContent = `Emergency${active.length > 1 ? ` (${active.length})` : ''}`;

  banner.classList.remove('hidden');

  if (_overlayEl && !_overlayEl.classList.contains('hidden')) {
    await _renderEmergencyList(_overlayEl);
  }
}

async function _renderEmergencyList(container) {
  const listEl = container.querySelector('#emergency-list');
  if (!listEl) return;

  const now    = Date.now();
  const all    = await getMessages({ type: 'emergency' });
  const active = all
    .filter((m) => m.expiresAt > now)
    .sort((a, b) => (b.priority - a.priority) || (b.createdAt - a.createdAt));

  if (active.length === 0) {
    listEl.innerHTML = `<p class="text-muted text-sm text-center" style="padding:20px;">No active emergencies.</p>`;
    return;
  }

  listEl.innerHTML = active.map((msg) => `
    <div class="msg-card type-emergency" style="margin-bottom:10px;">
      <div class="msg-card-header">
        <span class="msg-type-badge">EMERGENCY</span>
        <span class="priority-pill high">Priority ${msg.priority}</span>
        ${msg.bodyState === 'partial' ? `<span class="priority-pill">Scoped copy</span>` : ''}
        <div style="flex:1;"></div>
        <span class="expiry-badge urgent">${_ttlLabel(msg.expiresAt)}</span>
      </div>
      <div class="msg-card-title">${_esc(msg.title)}</div>
      ${msg.body ? `<div class="msg-card-body">${_esc(msg.body)}</div>` : ''}
    </div>
  `).join('');
}

function _ttlLabel(expiresAt) {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return 'Expired';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m left`;
  return `${Math.floor(mins / 60)}h left`;
}

function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

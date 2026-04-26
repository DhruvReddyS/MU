/**
 * TRINETRA — Settings Screen
 * Storage stats, privacy info, session identity, language, emergency wipe.
 * + Beacon toggle, Blackout mode, Disguise mode (PIN lock), Dead Man's Switch, Web Share
 */
import { getMessages, deleteExpiredMessages } from '../lib/db.js';
import { generateSessionKeypair, getSessionPublicKey } from '../lib/crypto.js';
import { getDeviceShortId, getDeviceAlias, setDeviceAlias } from '../lib/identity.js';
import { seedDemoData } from '../lib/demo-data.js';
import { isBeaconEnabled, setBeaconEnabled } from '../lib/beacon.js';
import {
  getConfig as getDMConfig,
  activate   as activateDM,
  deactivate as deactivateDM,
  getTimeRemaining,
  checkIn,
} from '../lib/deadman.js';
import { icon } from './icons.js';

const BLACKOUT_KEY  = 'trinetra_blackout';
const DISGUISE_KEY  = 'trinetra_disguise';

// ─── Public API ──────────────────────────────────────────────────

export async function renderSettingsScreen(container) {
  const alias   = getDeviceAlias();
  const nodeId  = getDeviceShortId();
  const pubKey  = await getSessionPublicKey();
  const fp      = pubKey ? pubKey.slice(0, 16) + '…' : '—';

  const blackoutOn  = localStorage.getItem(BLACKOUT_KEY) === '1';
  const disguiseCfg = _loadDisguise();
  const dmCfg       = getDMConfig();

  container.innerHTML = `
    <div class="settings-screen animate-in">

      <!-- Storage -->
      <div class="card settings-section">
        <div class="settings-section-title">Storage</div>
        <div class="stat-grid" id="stat-grid">
          <div class="stat-item">
            <div class="stat-item-value" id="stat-total">—</div>
            <div class="stat-item-label">Total messages</div>
          </div>
          <div class="stat-item">
            <div class="stat-item-value" id="stat-emergency" style="color:var(--red);">—</div>
            <div class="stat-item-label">Emergencies</div>
          </div>
          <div class="stat-item">
            <div class="stat-item-value" id="stat-alerts" style="color:var(--amber);">—</div>
            <div class="stat-item-label">Alerts</div>
          </div>
          <div class="stat-item">
            <div class="stat-item-value" id="stat-info" style="color:var(--cyan);">—</div>
            <div class="stat-item-label">Info</div>
          </div>
          <div class="stat-item">
            <div class="stat-item-value" id="stat-size">—</div>
            <div class="stat-item-label">Approx. size</div>
          </div>
          <div class="stat-item">
            <div class="stat-item-value" id="stat-oldest" style="font-size:0.8rem;">—</div>
            <div class="stat-item-label">Oldest message</div>
          </div>
        </div>
        <div class="settings-action-row">
          <button class="btn btn-secondary btn-sm" id="clear-expired-btn">Clear expired</button>
          <button class="btn btn-secondary btn-sm" id="load-demo-btn">Load demo data</button>
        </div>
      </div>

      <!-- Device -->
      <div class="card settings-section">
        <div class="settings-section-title">Device</div>
        <div class="stat-row">
          <span class="text-muted">Session node ID</span>
          <code style="font-family:monospace;font-size:0.875rem;color:var(--cyan-text);">
            ${_esc(nodeId)}
          </code>
        </div>
        <div class="form-group" style="margin-top:14px;margin-bottom:0;">
          <label class="form-label" for="alias-input">Session alias</label>
          <div class="settings-inline-row">
            <input class="form-input" id="alias-input"
                   value="${_esc(alias)}" maxlength="32" placeholder="Anonymous Node" />
            <button class="btn btn-secondary" id="save-alias-btn">Save</button>
          </div>
          <p class="text-muted text-sm" style="margin-top:5px;">Lives only for this page session and is shared only while you are connected.</p>
          <span class="hidden text-success text-sm" id="alias-saved">✓ Saved</span>
        </div>
      </div>

      <!-- Session identity -->
      <div class="card settings-section">
        <div class="settings-section-title">Session Identity</div>
        <p class="text-muted text-sm" style="margin-bottom:12px;line-height:1.55;">
          Session keys, node IDs, aliases, and peer labels reset on reload. This makes tracking across sessions much harder.
        </p>
        <div class="stat-row">
          <span class="text-muted">Key fingerprint</span>
          <code style="font-family:monospace;font-size:0.78rem;color:var(--text-secondary);" id="key-fp">
            ${_esc(fp)}
          </code>
        </div>
        <button class="btn btn-secondary btn-sm" id="regen-key-btn" style="margin-top:12px;">
          Rotate session key
        </button>
        <p class="text-muted text-sm" style="margin-top:6px;">
          Current DM contacts won't be able to reach you until they re-exchange keys.
        </p>
      </div>

      <!-- Tactical Operations -->
      <div class="card settings-section">
        <div class="settings-section-title">Tactical Operations</div>

        <div class="settings-toggle-row">
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.9rem;font-weight:700;color:var(--text);">${icon('beacon')} Live Location Beacon</div>
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;line-height:1.4;">Broadcast GPS to connected peers every 30s. Appears as dots on their map.</div>
          </div>
          <label class="settings-toggle">
            <input type="checkbox" id="beacon-toggle" ${isBeaconEnabled() ? 'checked' : ''} />
            <span class="settings-toggle-slider"></span>
          </label>
        </div>

        <div class="divider"></div>

        <div class="settings-toggle-row">
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.9rem;font-weight:700;color:var(--text);">${icon('blackout')} Blackout Mode</div>
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;line-height:1.4;">Dims screen to minimum brightness for battery conservation and concealment.</div>
          </div>
          <label class="settings-toggle">
            <input type="checkbox" id="blackout-toggle" ${blackoutOn ? 'checked' : ''} />
            <span class="settings-toggle-slider"></span>
          </label>
        </div>
      </div>

      <!-- Security -->
      <div class="card settings-section">
        <div class="settings-section-title">Security</div>

        <!-- Disguise Mode -->
        <div style="padding-bottom:14px;margin-bottom:14px;border-bottom:1px solid var(--border);">
          <div class="settings-toggle-row" style="margin-bottom:0;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:0.9rem;font-weight:700;color:var(--text);">${icon('disguise')} Disguise Mode</div>
              <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;line-height:1.4;">Shows a PIN lock screen when the app opens. Enter PIN to reveal TRINETRA.</div>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" id="disguise-toggle" ${disguiseCfg?.enabled ? 'checked' : ''} />
              <span class="settings-toggle-slider"></span>
            </label>
          </div>
          <div id="disguise-pin-row" style="margin-top:10px;${disguiseCfg?.enabled ? '' : 'display:none;'}">
            <div class="settings-inline-row">
              <input class="form-input" id="disguise-pin-input" type="password"
                     inputmode="numeric" pattern="[0-9]*" maxlength="8"
                     placeholder="Enter PIN (4–8 digits)"
                     value="${disguiseCfg?.pin ? '•'.repeat(disguiseCfg.pin.length) : ''}" />
              <button class="btn btn-secondary" id="disguise-pin-save">Set PIN</button>
            </div>
            <span class="hidden text-success text-sm" id="disguise-pin-saved" style="margin-top:4px;display:block;">✓ PIN saved</span>
          </div>
        </div>

        <!-- Dead Man's Switch -->
        <div>
          <div style="font-size:0.9rem;font-weight:700;color:var(--text);margin-bottom:4px;">${icon('deadman')} Dead Man's Switch</div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:12px;line-height:1.4;">
            Auto-broadcasts an emergency if you don't check in before the timer runs out.
          </div>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
            <span class="dms-badge ${dmCfg?.active ? 'dms-active' : 'dms-inactive'}" id="dms-status-badge">
              ${dmCfg?.active ? 'ACTIVE' : 'INACTIVE'}
            </span>
            <span class="text-muted text-sm" id="dms-time-remaining" style="${dmCfg?.active ? '' : 'display:none;'}">
              ${dmCfg?.active ? _fmtRemaining(getTimeRemaining()) + ' remaining' : ''}
            </span>
          </div>
          <div class="form-group" style="margin-bottom:10px;">
            <label class="form-label">Trigger after</label>
            <select class="form-input" id="dms-interval" ${dmCfg?.active ? 'disabled' : ''}>
              <option value="1800000"  ${dmCfg?.intervalMs === 1800000  ? 'selected' : ''}>30 minutes</option>
              <option value="3600000"  ${dmCfg?.intervalMs === 3600000  ? 'selected' : ''}>1 hour</option>
              <option value="7200000"  ${dmCfg?.intervalMs === 7200000  ? 'selected' : ''}>2 hours</option>
              <option value="21600000" ${dmCfg?.intervalMs === 21600000 ? 'selected' : ''}>6 hours</option>
              <option value="43200000" ${dmCfg?.intervalMs === 43200000 ? 'selected' : ''}>12 hours</option>
              <option value="86400000" ${dmCfg?.intervalMs === 86400000 ? 'selected' : ''}>24 hours</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom:12px;">
            <label class="form-label">Broadcast message</label>
            <textarea class="form-input" id="dms-message" rows="2" maxlength="200"
              placeholder="e.g. Node offline — last known location…" ${dmCfg?.active ? 'disabled' : ''}>${_esc(dmCfg?.message || '')}</textarea>
          </div>
          <div style="display:flex;gap:10px;">
            <button class="btn btn-secondary" id="dms-checkin-btn" style="${dmCfg?.active ? '' : 'display:none;'}flex:1;">
              ✓ Check In
            </button>
            <button class="btn ${dmCfg?.active ? 'btn-danger' : 'btn-primary'}" id="dms-toggle-btn" style="flex:2;">
              ${dmCfg?.active ? 'Deactivate' : 'Activate'}
            </button>
          </div>
        </div>
      </div>

      <!-- Privacy -->
      <div class="card settings-section">
        <div class="settings-section-title">Privacy</div>
        <ul class="privacy-list">
          <li>No accounts, no sign-up, no tracking</li>
          <li>Node IDs and aliases rotate on each session reload</li>
          <li>Peer/contact labels are kept only for the current runtime</li>
          <li>Messages auto-delete after they expire</li>
          <li>Relayed non-emergency messages keep scoped fragments instead of full detail</li>
          <li>No servers, remote fonts, or remote map tiles required</li>
        </ul>
      </div>

      <!-- Danger zone -->
      <div class="card settings-section danger-zone">
        <div class="settings-section-title" style="color:var(--red);">Danger Zone</div>
        <p class="text-muted text-sm" style="margin-bottom:14px;line-height:1.55;">
          Permanently erases all messages, keys, settings, and service worker cache from this device.
          Connected peers keep their own copies. Cannot be undone.
        </p>
        <button class="btn btn-danger btn-full" id="wipe-btn">
          ${icon('wipe')} Emergency Wipe
        </button>
      </div>

      <!-- About -->
      <div class="card settings-section">
        <div class="settings-section-title">About</div>
        <div class="stat-row">
          <span class="text-muted">Version</span>
          <span>TRINETRA v3.0</span>
        </div>
        <div class="stat-row">
          <span class="text-muted">Mode</span>
          <span>Offline local P2P + QR</span>
        </div>
        <button class="btn btn-secondary btn-full" id="share-app-btn" style="margin-top:12px;">
          Share App Link
        </button>
        <p class="text-muted text-sm" style="margin-top:10px;line-height:1.55;">
          No servers or external network assets are required. Serve it locally or install it once, then it runs fully offline.
        </p>
      </div>

    </div>
  `;

  await _loadStats(container);
  _wireAlias(container);
  _wireClearExpired(container);
  _wireRegenKey(container);
  _wireWipeBtn(container);
  _wireDemoData(container);
  _wireBeaconToggle(container);
  _wireBlackoutToggle(container);
  _wireDisguiseMode(container);
  _wireDeadManSwitch(container);
  _wireShareApp(container);
}

export function cleanupSettingsScreen() {}

// ─── Storage Stats ───────────────────────────────────────────────

async function _loadStats(container) {
  try {
    const all  = await getMessages();
    const now  = Date.now();
    const live = all.filter((m) => m.expiresAt > now);

    const counts = { emergency: 0, alert: 0, info: 0 };
    let oldestTs = Infinity;
    for (const m of live) {
      if (counts[m.type] !== undefined) counts[m.type]++;
      if (m.createdAt < oldestTs) oldestTs = m.createdAt;
    }

    const bytes = new TextEncoder().encode(JSON.stringify(all)).length;
    const kb    = (bytes / 1024).toFixed(1);
    const oldestStr = oldestTs === Infinity ? '—' : _timeAgo(oldestTs);

    container.querySelector('#stat-total').textContent     = String(live.length);
    container.querySelector('#stat-emergency').textContent = String(counts.emergency);
    container.querySelector('#stat-alerts').textContent    = String(counts.alert);
    container.querySelector('#stat-info').textContent      = String(counts.info);
    container.querySelector('#stat-size').textContent      = `~${kb} KB`;
    container.querySelector('#stat-oldest').textContent    = oldestStr;
  } catch (err) {
    console.warn('[TRINETRA] Stats error:', err.message);
  }
}

// ─── Alias ───────────────────────────────────────────────────────

function _wireAlias(container) {
  container.querySelector('#save-alias-btn').addEventListener('click', () => {
    const val    = container.querySelector('#alias-input').value.trim();
    const confirm = container.querySelector('#alias-saved');
    setDeviceAlias(val);
    confirm.classList.remove('hidden');
    setTimeout(() => confirm.classList.add('hidden'), 2000);
  });
}

// ─── Clear Expired ───────────────────────────────────────────────

function _wireClearExpired(container) {
  const btn = container.querySelector('#clear-expired-btn');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Clearing…';
    const count = await deleteExpiredMessages();
    await _loadStats(container);
    btn.textContent = count > 0 ? `Cleared ${count}` : 'Nothing to clear';
    setTimeout(() => { btn.textContent = 'Clear expired'; btn.disabled = false; }, 2500);
  });
}

// ─── Regen Key ───────────────────────────────────────────────────

function _wireRegenKey(container) {
  const btn = container.querySelector('#regen-key-btn');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    await generateSessionKeypair();
    const newKey = await getSessionPublicKey();
    const fp     = newKey ? newKey.slice(0, 16) + '…' : '—';
    container.querySelector('#key-fp').textContent = fp;
    btn.textContent = '✓ Key rotated';
    setTimeout(() => { btn.textContent = 'Rotate session key'; btn.disabled = false; }, 2500);
  });
}

// ─── Wipe Button ─────────────────────────────────────────────────

function _wireWipeBtn(container) {
  container.querySelector('#wipe-btn').addEventListener('click', () => {
    window._showEmergencyWipe?.();
  });
}

// ─── Demo Data ───────────────────────────────────────────────────

function _wireDemoData(container) {
  const btn = container.querySelector('#load-demo-btn');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Loading…';
    const added = await seedDemoData({ force: true });
    window.dispatchEvent(new CustomEvent('meshdrop:bundles-updated', {
      detail: { source: 'demo', count: added },
    }));
    await _loadStats(container);
    btn.textContent = added > 0 ? `Loaded ${added} messages` : 'Already loaded';
    setTimeout(() => { btn.textContent = 'Load demo data'; btn.disabled = false; }, 3000);
  });
}

// ─── Beacon Toggle ───────────────────────────────────────────────

function _wireBeaconToggle(container) {
  const toggle = container.querySelector('#beacon-toggle');
  toggle?.addEventListener('change', () => {
    setBeaconEnabled(toggle.checked);
  });
}

// ─── Blackout Mode ───────────────────────────────────────────────

function _wireBlackoutToggle(container) {
  const toggle = container.querySelector('#blackout-toggle');
  toggle?.addEventListener('change', () => {
    const on = toggle.checked;
    try { localStorage.setItem(BLACKOUT_KEY, on ? '1' : '0'); } catch {}
    document.body.classList.toggle('blackout-mode', on);
  });
}

// ─── Disguise Mode ───────────────────────────────────────────────

function _loadDisguise() {
  try { return JSON.parse(localStorage.getItem(DISGUISE_KEY) || 'null'); } catch { return null; }
}

function _saveDisguise(cfg) {
  try { localStorage.setItem(DISGUISE_KEY, JSON.stringify(cfg)); } catch {}
}

function _wireDisguiseMode(container) {
  const toggle   = container.querySelector('#disguise-toggle');
  const pinRow   = container.querySelector('#disguise-pin-row');
  const pinInput = container.querySelector('#disguise-pin-input');
  const pinSave  = container.querySelector('#disguise-pin-save');
  const pinSaved = container.querySelector('#disguise-pin-saved');

  toggle?.addEventListener('change', () => {
    const cfg = _loadDisguise() || { enabled: false, pin: '' };
    cfg.enabled = toggle.checked;
    _saveDisguise(cfg);
    if (pinRow) pinRow.style.display = toggle.checked ? '' : 'none';
  });

  pinSave?.addEventListener('click', () => {
    const pin = pinInput?.value.trim().replace(/[^0-9]/g, '');
    if (!pin || pin.length < 4) {
      pinInput?.focus();
      return;
    }
    const cfg = _loadDisguise() || { enabled: true };
    cfg.pin = pin;
    _saveDisguise(cfg);
    if (pinInput) pinInput.value = '•'.repeat(pin.length);
    pinSaved?.classList.remove('hidden');
    setTimeout(() => pinSaved?.classList.add('hidden'), 2000);
  });

  pinInput?.addEventListener('focus', () => {
    if (pinInput.value.startsWith('•')) pinInput.value = '';
  });
}

// ─── Dead Man's Switch ───────────────────────────────────────────

let _dmsRefreshTimer = null;

function _wireDeadManSwitch(container) {
  const toggleBtn  = container.querySelector('#dms-toggle-btn');
  const checkinBtn = container.querySelector('#dms-checkin-btn');
  const intervalSel = container.querySelector('#dms-interval');
  const messageTa  = container.querySelector('#dms-message');

  function _refreshDMSUI() {
    const cfg         = getDMConfig();
    const badge       = container.querySelector('#dms-status-badge');
    const timeEl      = container.querySelector('#dms-time-remaining');
    const isActive    = !!(cfg?.active);

    if (badge) {
      badge.textContent = isActive ? 'ACTIVE' : 'INACTIVE';
      badge.className   = `dms-badge ${isActive ? 'dms-active' : 'dms-inactive'}`;
    }
    if (timeEl) {
      if (isActive) {
        const rem = getTimeRemaining();
        timeEl.textContent = rem !== null ? _fmtRemaining(rem) + ' remaining' : '';
        timeEl.style.display = '';
      } else {
        timeEl.style.display = 'none';
      }
    }
    if (toggleBtn) {
      toggleBtn.textContent = isActive ? 'Deactivate' : 'Activate';
      toggleBtn.className   = `btn ${isActive ? 'btn-danger' : 'btn-primary'}`;
      toggleBtn.style.flex  = '2';
    }
    if (checkinBtn) {
      checkinBtn.style.display = isActive ? '' : 'none';
    }
    if (intervalSel) intervalSel.disabled = isActive;
    if (messageTa)   messageTa.disabled   = isActive;
  }

  toggleBtn?.addEventListener('click', () => {
    const cfg = getDMConfig();
    if (cfg?.active) {
      deactivateDM();
      clearInterval(_dmsRefreshTimer);
      _dmsRefreshTimer = null;
    } else {
      const intervalMs = parseInt(intervalSel?.value || '3600000', 10);
      const message    = messageTa?.value.trim() || 'Dead man\'s switch triggered — node may be offline.';
      activateDM(intervalMs, message);
      _dmsRefreshTimer = setInterval(_refreshDMSUI, 10_000);
    }
    _refreshDMSUI();
  });

  checkinBtn?.addEventListener('click', () => {
    checkIn();
    _refreshDMSUI();
    const orig = checkinBtn.textContent;
    checkinBtn.textContent = '✓ Checked in!';
    setTimeout(() => { checkinBtn.textContent = orig; }, 2000);
  });

  // Live refresh if active on mount
  if (getDMConfig()?.active) {
    _dmsRefreshTimer = setInterval(_refreshDMSUI, 10_000);
  }
}

// ─── Share App ───────────────────────────────────────────────────

function _wireShareApp(container) {
  container.querySelector('#share-app-btn')?.addEventListener('click', async () => {
    const url = window.location.origin + window.location.pathname;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'TRINETRA — Offline Mesh Network', url });
      } catch {}
    } else {
      try {
        await navigator.clipboard.writeText(url);
        window.dispatchEvent(new CustomEvent('meshdrop:show-toast', {
          detail: { message: 'App URL copied to clipboard.' },
        }));
      } catch {}
    }
  });
}

// ─── Helpers ─────────────────────────────────────────────────────

function _timeAgo(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function _fmtRemaining(ms) {
  if (ms === null) return '';
  const m = Math.ceil(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

function _esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

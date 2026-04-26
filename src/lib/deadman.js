/**
 * TRINETRA — Dead Man's Switch
 * If the user does not check in within the configured interval,
 * an emergency message is broadcast to all connected peers.
 */

const DM_CFG_KEY = 'trinetra_deadman_cfg';

let _timer    = null;
let _onFire   = null;

// ─── Public API ──────────────────────────────────────────────────

export function getConfig() {
  try { return JSON.parse(localStorage.getItem(DM_CFG_KEY) || 'null'); } catch { return null; }
}

export function setConfig(cfg) {
  try {
    if (cfg === null) localStorage.removeItem(DM_CFG_KEY);
    else              localStorage.setItem(DM_CFG_KEY, JSON.stringify(cfg));
  } catch {}
}

export function isActive() {
  const cfg = getConfig();
  return !!(cfg?.active);
}

/**
 * Activate the switch. Starts the countdown.
 * @param {number} intervalMs - milliseconds until trigger
 * @param {string} message    - broadcast message text
 */
export function activate(intervalMs, message) {
  const cfg = { active: true, intervalMs, message, lastCheckIn: Date.now() };
  setConfig(cfg);
  _schedule(cfg);
}

export function deactivate() {
  clearTimeout(_timer);
  _timer = null;
  setConfig(null);
}

/** Reset the countdown without changing settings. */
export function checkIn() {
  const cfg = getConfig();
  if (!cfg?.active) return;
  cfg.lastCheckIn = Date.now();
  setConfig(cfg);
  _schedule(cfg);
}

export function getTimeRemaining() {
  const cfg = getConfig();
  if (!cfg?.active) return null;
  const elapsed = Date.now() - (cfg.lastCheckIn || Date.now());
  return Math.max(0, cfg.intervalMs - elapsed);
}

/**
 * Call once on app start. Resumes any active switch.
 * @param {function} onFire - called when switch triggers
 */
export function initDeadMan(onFire) {
  _onFire = onFire;
  const cfg = getConfig();
  if (!cfg?.active) return;

  const remaining = getTimeRemaining();
  if (remaining === 0) {
    // Already past due — fire immediately
    _fire(cfg);
    return;
  }
  _schedule(cfg);
}

// ─── Private ─────────────────────────────────────────────────────

function _schedule(cfg) {
  clearTimeout(_timer);
  const remaining = getTimeRemaining();
  if (remaining === null || remaining === 0) return;
  _timer = setTimeout(() => _fire(cfg), remaining);
}

function _fire(cfg) {
  deactivate();
  _onFire?.(cfg?.message || 'Dead man\'s switch triggered — node may be offline.');
}

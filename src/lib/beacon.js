/**
 * TRINETRA — Live Location Beacons
 * Opt-in periodic GPS broadcast to connected peers every 30 seconds.
 * Peer beacon data is held in memory and exposed via getBeacons().
 * Dispatches 'meshdrop:beacon-update' when beacon data changes.
 */

import { getPeers, sendToPeer } from './webrtc.js';
import { getDeviceShortId } from './identity.js';

export const BEACON_MSG  = 'BEACON';
const BEACON_ENABLED_KEY = 'trinetra_beacon_enabled';
const BEACON_INTERVAL_MS = 30_000;
const BEACON_MAX_AGE_MS  = 120_000; // remove peers not seen in 2 min

let _broadcastTimer = null;
const _peerBeacons  = new Map(); // shortId → { lat, lng, ts, shortId, alias }

// ─── Public API ──────────────────────────────────────────────────

export function isBeaconEnabled() {
  try { return localStorage.getItem(BEACON_ENABLED_KEY) === '1'; } catch { return false; }
}

export function setBeaconEnabled(val) {
  try { localStorage.setItem(BEACON_ENABLED_KEY, val ? '1' : '0'); } catch {}
  if (val) _startBroadcast();
  else _stopBroadcast();
}

export function getBeacons() {
  const now = Date.now();
  for (const [id, b] of _peerBeacons.entries()) {
    if (now - b.ts > BEACON_MAX_AGE_MS) _peerBeacons.delete(id);
  }
  return [..._peerBeacons.values()];
}

// Called from main.js on app start
export function initBeacon() {
  if (isBeaconEnabled()) _startBroadcast();
}

// Called from sync.js / main.js when a BEACON message arrives from a peer
export function handleIncomingBeacon(shortId, payload) {
  // Allow valid 0 coordinates; reject only null/undefined / non-finite.
  const lat = payload?.lat;
  const lng = payload?.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  _peerBeacons.set(shortId, {
    shortId: payload.shortId || shortId,
    lat,
    lng,
    ts:      payload.ts || Date.now(),
    alias:   payload.alias || `Node ${shortId}`,
  });
  window.dispatchEvent(new CustomEvent('meshdrop:beacon-update', {
    detail: { shortId, lat, lng },
  }));
}

// ─── Private ─────────────────────────────────────────────────────

function _broadcast(lat, lng) {
  const openPeers = getPeers().filter((p) => p.status === 'open');
  if (!openPeers.length) return;
  const payload = { shortId: getDeviceShortId(), lat, lng, ts: Date.now() };
  openPeers.forEach((p) => sendToPeer(p.peerId, { type: BEACON_MSG, payload }));
}

function _tick() {
  navigator.geolocation.getCurrentPosition(
    (pos) => _broadcast(pos.coords.latitude, pos.coords.longitude),
    () => {},
    { enableHighAccuracy: false, timeout: 5_000 }
  );
}

function _startBroadcast() {
  _stopBroadcast();
  if (!navigator.geolocation) return;
  _tick(); // immediate first tick
  _broadcastTimer = setInterval(_tick, BEACON_INTERVAL_MS);
}

function _stopBroadcast() {
  clearInterval(_broadcastTimer);
  _broadcastTimer = null;
}

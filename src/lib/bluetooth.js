/**
 * MeshDrop — Bluetooth Proximity Discovery
 *
 * Uses Web Bluetooth API (Central / GATT Client) to detect nearby BLE devices.
 * Discovery only — pairing and data transfer still happen via QR + local P2P.
 *
 * Privacy-first design: nearby-device hints live in memory only and are cleared
 * whenever the page reloads, so the app does not keep a durable local record of
 * who was nearby in prior sessions.
 *
 * Availability:
 *   ✅ Chrome on Android
 *   ✅ Chrome on desktop (macOS, Windows, Linux)
 *   ❌ iOS Safari — Web Bluetooth not supported
 *   ❌ Firefox — not implemented
 *
 * Browser limitation: cannot passively scan. requestDevice() ALWAYS opens a
 * browser modal. getDevices() (Chrome 85+) returns previously granted devices
 * without a modal — we use this as an optional hint source on load.
 */

const MAX_STORED = 20;
const _nearbyDevices = new Map();

// ─── Support checks ──────────────────────────────────────────────

function isBluetoothSupported() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

async function isBluetoothAvailable() {
  if (!isBluetoothSupported()) return false;
  try {
    return await navigator.bluetooth.getAvailability();
  } catch {
    return false;
  }
}

// ─── Session-only nearby device list ─────────────────────────────

function getStoredNearbyDevices() {
  return [..._nearbyDevices.values()].sort((a, b) => b.lastSeen - a.lastSeen);
}

function storeNearbyDevice(name, id) {
  if (!id) return;

  _nearbyDevices.set(id, {
    name: name || 'Unknown Device',
    id,
    lastSeen: Date.now(),
  });

  const ordered = getStoredNearbyDevices();
  if (ordered.length > MAX_STORED) {
    for (const stale of ordered.slice(MAX_STORED)) {
      _nearbyDevices.delete(stale.id);
    }
  }
}

function clearStoredDevices() {
  _nearbyDevices.clear();
}

// ─── Active discovery ────────────────────────────────────────────

/**
 * Return all known nearby devices:
 *   1. Previously granted devices via getDevices() — no popup in Chrome 85+
 *   2. Devices discovered during this page session
 * Deduplicates by id. Never shows a browser modal.
 */
async function getKnownNearbyDevices() {
  const known  = new Map(getStoredNearbyDevices().map((d) => [d.id, d]));

  // Chrome 85+: get previously paired/granted devices without a picker
  if (isBluetoothSupported() && navigator.bluetooth.getDevices) {
    try {
      const granted = await navigator.bluetooth.getDevices();
      for (const d of granted) {
        const entry = { name: d.name || 'Unknown Device', id: d.id, lastSeen: Date.now() };
        known.set(d.id, entry);
        storeNearbyDevice(entry.name, entry.id);
      }
    } catch {
      // getDevices not available or permission denied — silent fallback
    }
  }

  return [...known.values()].sort((a, b) => b.lastSeen - a.lastSeen);
}

/**
 * Open the browser's native BLE device picker so the user can select a
 * nearby device. Stores the result and returns { name, id }.
 * Returns null if the user cancels.
 */
async function pickNearbyDevice() {
  if (!isBluetoothSupported()) {
    throw new Error('Web Bluetooth is not supported in this browser.');
  }
  const available = await isBluetoothAvailable();
  if (!available) {
    throw new Error('Bluetooth is off or unavailable. Enable Bluetooth and try again.');
  }

  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: ['generic_access', 'device_information'],
  });

  if (!device) return null;

  storeNearbyDevice(device.name || 'Unknown Device', device.id);
  return { name: device.name || 'Unknown Device', id: device.id };
}

/**
 * @deprecated Use getKnownNearbyDevices() instead.
 */
async function getPairedDevices() {
  if (!isBluetoothSupported() || !navigator.bluetooth.getDevices) return [];
  try {
    const devices = await navigator.bluetooth.getDevices();
    return devices.map((d) => ({ name: d.name || 'Unknown', id: d.id }));
  } catch {
    return [];
  }
}

export {
  isBluetoothSupported,
  isBluetoothAvailable,
  pickNearbyDevice,
  getPairedDevices,
  getKnownNearbyDevices,
  getStoredNearbyDevices,
  storeNearbyDevice,
  clearStoredDevices,
};

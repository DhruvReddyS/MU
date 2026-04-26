/**
 * MeshDrop — Event Bus
 * Lightweight pub/sub for decoupled communication between modules.
 */

const listeners = {};

/**
 * Subscribe to an event.
 * @param {string} event
 * @param {Function} callback
 * @returns {Function} Unsubscribe function
 */
function on(event, callback) {
  if (!listeners[event]) listeners[event] = [];
  listeners[event].push(callback);
  return () => off(event, callback);
}

/**
 * Unsubscribe from an event.
 */
function off(event, callback) {
  if (!listeners[event]) return;
  listeners[event] = listeners[event].filter(cb => cb !== callback);
}

/**
 * Emit an event with optional data.
 */
function emit(event, data) {
  if (!listeners[event]) return;
  listeners[event].forEach(cb => {
    try { cb(data); } catch (e) { console.error(`[Event:${event}]`, e); }
  });
}

export { on, off, emit };

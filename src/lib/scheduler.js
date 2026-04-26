/**
 * MeshDrop — TTL Expiry Scheduler
 * Periodically removes expired messages from IndexedDB.
 * Expiry is checked via message.expiresAt (absolute timestamp).
 */
import { deleteExpiredMessages } from './db.js';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let intervalId = null;

function startScheduler(intervalMs = DEFAULT_INTERVAL_MS) {
  if (intervalId !== null) return;

  deleteExpiredMessages();

  intervalId = setInterval(() => {
    deleteExpiredMessages();
  }, intervalMs);
}

function stopScheduler() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

// Legacy alias
const deleteExpiredBundles = deleteExpiredMessages;

export { startScheduler, stopScheduler, deleteExpiredBundles };

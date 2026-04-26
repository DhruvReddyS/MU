/**
 * MeshDrop — Global DM Store
 * Always-on in-memory store so DM messages are never lost regardless of
 * which screen is active. Also handles optional IDB persistence with TTL.
 */
import { openDB } from 'idb';

const DB_NAME    = 'meshdrop-dm';
const DB_VERSION = 1;

const _dbPromise = openDB(DB_NAME, DB_VERSION, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('messages')) {
      const s = db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
      s.createIndex('shortId',   'shortId',   { unique: false });
      s.createIndex('expiresAt', 'expiresAt', { unique: false });
    }
    if (!db.objectStoreNames.contains('thread_meta')) {
      db.createObjectStore('thread_meta', { keyPath: 'shortId' });
    }
  },
});

// ─── In-memory layer (session cache, always active) ───────────────

const _threads = new Map();   // shortId → [{id,text,from,ts,isSent,persisted}]
const _unread  = new Map();   // shortId → count

function _shortFromPeer(peerId) {
  return peerId.replace(/-/g,'').slice(0, 8).toUpperCase();
}

export function storeMessage(shortId, entry) {
  if (!_threads.has(shortId)) _threads.set(shortId, []);
  _threads.get(shortId).push(entry);
}

export function getThread(shortId) {
  return _threads.get(shortId) || [];
}

export function clearThread(shortId) {
  _threads.delete(shortId);
  _unread.delete(shortId);
}

export function incrementUnread(shortId) {
  _unread.set(shortId, (_unread.get(shortId) || 0) + 1);
}

export function clearUnread(shortId) {
  _unread.delete(shortId);
}

export function getUnread(shortId) {
  return _unread.get(shortId) || 0;
}

export function getTotalUnread() {
  let t = 0;
  for (const n of _unread.values()) t += n;
  return t;
}

// ─── IDB persistence (optional, per thread) ───────────────────────

export async function getThreadMeta(shortId) {
  const db = await _dbPromise;
  return db.get('thread_meta', shortId);
}

export async function setThreadMeta(shortId, meta) {
  const db = await _dbPromise;
  await db.put('thread_meta', { shortId, ...meta });
}

export async function persistMessage(shortId, entry) {
  const db = await _dbPromise;
  const id = await db.add('messages', { ...entry, shortId });
  return id;
}

export async function loadPersistedThread(shortId) {
  const db  = await _dbPromise;
  const now = Date.now();
  const all = await db.getAllFromIndex('messages', 'shortId', shortId);
  return all.filter((m) => !m.expiresAt || m.expiresAt > now)
            .sort((a, b) => a.ts - b.ts);
}

export async function pruneExpiredDMs() {
  const db  = await _dbPromise;
  const now = Date.now();
  const all = await db.getAll('messages');
  const tx  = db.transaction('messages', 'readwrite');
  for (const m of all) {
    if (m.expiresAt && m.expiresAt <= now) await tx.store.delete(m.id);
  }
  await tx.done;
}

export async function clearPersistedThread(shortId) {
  const db  = await _dbPromise;
  const all = await db.getAllFromIndex('messages', 'shortId', shortId);
  const tx  = db.transaction('messages', 'readwrite');
  for (const m of all) await tx.store.delete(m.id);
  await tx.done;
  await db.delete('thread_meta', shortId);
}

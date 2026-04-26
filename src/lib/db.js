/**
 * MeshDrop — IndexedDB Data Layer v3
 * Database: meshdrop-db v3
 * Stores: messages, keys
 *
 * v3 adds:
 *   - revisioned messages with rootId/replaces/isCurrent
 *   - partial relay copies using scoped body fragments
 *   - exact-message merges so complementary fragments can accumulate locally
 */
import { openDB } from 'idb';

const DB_NAME    = 'meshdrop-db';
const DB_VERSION = 3;

const dbPromise = openDB(DB_NAME, DB_VERSION, {
  upgrade(db, oldVersion, _newVersion, transaction) {
    if (oldVersion < 2 && db.objectStoreNames.contains('messages')) {
      db.deleteObjectStore('messages');
    }

    let store;
    if (!db.objectStoreNames.contains('messages')) {
      store = db.createObjectStore('messages', { keyPath: 'id' });
      store.createIndex('type',      'type',      { unique: false });
      store.createIndex('createdAt', 'createdAt', { unique: false });
      store.createIndex('priority',  'priority',  { unique: false });
      store.createIndex('expiresAt', 'expiresAt', { unique: false });
    } else {
      store = transaction.objectStore('messages');
    }

    if (!store.indexNames.contains('rootId')) {
      store.createIndex('rootId', 'rootId', { unique: false });
    }
    if (!store.indexNames.contains('isCurrent')) {
      store.createIndex('isCurrent', 'isCurrent', { unique: false });
    }

    if (!db.objectStoreNames.contains('keys')) {
      db.createObjectStore('keys', { keyPath: 'name' });
    }
  },
});

const VALID_TYPES           = ['info', 'alert', 'emergency', 'safe-route', 'medical', 'shelter', 'resource'];
const MAX_TITLE_LENGTH      = 80;
const MAX_BODY_LENGTH       = 500;
const MAX_HOPS              = 100;
const BODY_PREVIEW_LENGTH   = 160;
const BODY_FRAGMENT_LENGTH  = 120;
const MAX_RELAY_FRAGMENTS   = 2;
const RELAY_PARTIAL_TYPES   = new Set(['info', 'alert', 'safe-route', 'medical', 'shelter', 'resource']);

function validateMessage(msg) {
  if (!msg || typeof msg !== 'object') throw new Error('Message must be an object');

  if (!msg.id || typeof msg.id !== 'string') throw new Error('Message must have a string id');
  if (!VALID_TYPES.includes(msg.type)) throw new Error(`type must be one of: ${VALID_TYPES.join(', ')}`);
  if (typeof msg.priority !== 'number' || msg.priority < 0 || msg.priority > 100) {
    throw new Error('priority must be 0–100');
  }
  if (!msg.title || typeof msg.title !== 'string') throw new Error('title is required');
  if (msg.title.length > MAX_TITLE_LENGTH) throw new Error(`title exceeds ${MAX_TITLE_LENGTH} chars`);
  if (typeof msg.createdAt !== 'number') throw new Error('createdAt must be a number');
  if (typeof msg.expiresAt !== 'number') throw new Error('expiresAt must be a number');
  if (typeof msg.ttl !== 'number' || msg.ttl < 0 || msg.ttl > MAX_HOPS) {
    throw new Error('ttl must be a non-negative number');
  }
  if (typeof msg.hops !== 'number' || msg.hops < 0) throw new Error('hops must be a non-negative number');
  if (typeof msg.rootId !== 'string' || !msg.rootId) throw new Error('rootId is required');
  if (typeof msg.revision !== 'number' || msg.revision < 1) throw new Error('revision must be >= 1');
  if (msg.bodyPreview && msg.bodyPreview.length > MAX_BODY_LENGTH) {
    throw new Error(`body preview exceeds ${MAX_BODY_LENGTH} chars`);
  }
  if (!Array.isArray(msg.fragments)) throw new Error('fragments must be an array');
  if (typeof msg.fragmentCount !== 'number' || msg.fragmentCount < 0) {
    throw new Error('fragmentCount must be a non-negative number');
  }
}

function _sanitizeFragments(fragments) {
  if (!Array.isArray(fragments)) return [];

  const byIndex = new Map();
  for (const fragment of fragments) {
    if (!fragment || typeof fragment !== 'object') continue;
    const index = Number(fragment.index);
    const text  = typeof fragment.text === 'string' ? fragment.text : '';
    if (!Number.isInteger(index) || index < 0 || !text) continue;

    const prev = byIndex.get(index);
    if (!prev || prev.text.length < text.length) {
      byIndex.set(index, { index, text: text.slice(0, BODY_FRAGMENT_LENGTH) });
    }
  }

  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

function _splitBody(body) {
  if (!body) return [];

  const fragments = [];
  for (let i = 0; i < body.length; i += BODY_FRAGMENT_LENGTH) {
    fragments.push({
      index: fragments.length,
      text: body.slice(i, i + BODY_FRAGMENT_LENGTH),
    });
  }
  return fragments;
}

function _bodyPreview(body, fallback = '') {
  const src = String(body || fallback || '').trim();
  return src.slice(0, BODY_PREVIEW_LENGTH);
}

function _pickRelayFragments(fragments) {
  if (fragments.length <= MAX_RELAY_FRAGMENTS) return fragments;

  const picked = [fragments[0], fragments[fragments.length - 1]];
  return _sanitizeFragments(picked);
}

function _applyExposurePolicy(msg, fragments, mode) {
  if (mode !== 'relay') return fragments;
  if (!RELAY_PARTIAL_TYPES.has(msg.type)) return fragments;
  return _pickRelayFragments(fragments);
}

function _renderBody(bodyPreview, fragments, fragmentCount) {
  if (!fragments.length) return bodyPreview || '';
  if (fragmentCount > 0 && fragments.length >= fragmentCount) {
    return fragments.map((fragment) => fragment.text).join('');
  }

  const excerpt = fragments.map((fragment) => fragment.text).join(' … ');
  if (!excerpt) return bodyPreview || '';
  if (bodyPreview && !excerpt.startsWith(bodyPreview)) {
    return `${bodyPreview}\n\n[Relay excerpt]\n${excerpt}`;
  }
  return `${excerpt}\n\n[Partial relay copy]`;
}

function _toStoredMessage(msg, options = {}) {
  const mode = options.mode || 'origin';
  const rawBody = typeof msg.body === 'string' ? msg.body : '';
  const incomingFragments = _sanitizeFragments(
    Array.isArray(msg.fragments) ? msg.fragments
    : Array.isArray(msg.bodyFragments) ? msg.bodyFragments
    : _splitBody(rawBody)
  );
  const fragmentCount = Math.max(
    Number(msg.fragmentCount) || 0,
    incomingFragments.length,
    rawBody ? Math.ceil(rawBody.length / BODY_FRAGMENT_LENGTH) : 0
  );
  const storedFragments = _applyExposurePolicy(msg, incomingFragments, mode);
  const bodyPreview = _bodyPreview(msg.bodyPreview || rawBody, rawBody);
  const body = _renderBody(bodyPreview, storedFragments, fragmentCount);

  const normalized = {
    ...msg,
    rootId: msg.rootId || msg.id,
    revision: Number.isInteger(msg.revision) ? msg.revision : 1,
    replaces: msg.replaces || null,
    bodyPreview,
    fragments: storedFragments,
    fragmentCount,
    bodyState: fragmentCount > storedFragments.length ? 'partial' : 'full',
    body,
    isCurrent: msg.isCurrent !== false,
    seenCount: Number.isFinite(msg.seenCount) && msg.seenCount > 0 ? msg.seenCount : 1,
    localSessionOwned: Boolean(options.localSessionOwned || msg.localSessionOwned),
  };

  validateMessage(normalized);
  return normalized;
}

function _mergeSameRevision(existing, incoming) {
  const mergedFragments = _sanitizeFragments([...(existing.fragments || []), ...(incoming.fragments || [])]);
  const fragmentCount = Math.max(existing.fragmentCount || 0, incoming.fragmentCount || 0, mergedFragments.length);
  const bodyPreview = _bodyPreview(
    incoming.bodyPreview && incoming.bodyPreview.length >= (existing.bodyPreview || '').length
      ? incoming.bodyPreview
      : existing.bodyPreview,
    existing.body || incoming.body || ''
  );

  return {
    ...existing,
    ...incoming,
    bodyPreview,
    fragments: mergedFragments,
    fragmentCount,
    bodyState: fragmentCount > mergedFragments.length ? 'partial' : 'full',
    body: _renderBody(bodyPreview, mergedFragments, fragmentCount),
    ttl: Math.max(existing.ttl ?? 0, incoming.ttl ?? 0),
    hops: Math.min(existing.hops ?? incoming.hops ?? 0, incoming.hops ?? existing.hops ?? 0),
    expiresAt: Math.min(existing.expiresAt ?? incoming.expiresAt, incoming.expiresAt ?? existing.expiresAt),
    priority: Math.max(existing.priority ?? 0, incoming.priority ?? 0),
    lat: incoming.lat ?? existing.lat,
    lng: incoming.lng ?? existing.lng,
    seenCount: Math.max(existing.seenCount || 1, incoming.seenCount || 1) + 1,
    localSessionOwned: Boolean(existing.localSessionOwned || incoming.localSessionOwned),
    isCurrent: true,
  };
}

function _isIncomingNewer(incoming, current) {
  if ((incoming.revision || 1) !== (current.revision || 1)) {
    return (incoming.revision || 1) > (current.revision || 1);
  }
  return (incoming.createdAt || 0) > (current.createdAt || 0);
}

async function _getCurrentRootRecord(db, rootId) {
  const siblings = await db.getAllFromIndex('messages', 'rootId', rootId);
  return siblings.find((msg) => msg.isCurrent !== false) || null;
}

async function saveMessage(msg, options = {}) {
  const candidate = _toStoredMessage(msg, options);
  const db = await dbPromise;

  const exact = await db.get('messages', candidate.id);
  if (exact) {
    const merged = _mergeSameRevision(exact, candidate);
    await db.put('messages', merged);
    return {
      id: merged.id,
      status:
        merged.bodyState !== exact.bodyState
        || merged.fragments.length !== (exact.fragments || []).length
        || merged.ttl !== exact.ttl
        || merged.hops !== exact.hops
          ? 'merged'
          : 'duplicate',
    };
  }

  const current = await _getCurrentRootRecord(db, candidate.rootId);
  if (current && current.id !== candidate.id) {
    if (!_isIncomingNewer(candidate, current)) {
      return { id: current.id, status: 'stale' };
    }

    await db.put('messages', {
      ...current,
      isCurrent: false,
      supersededBy: candidate.id,
    });
    await db.put('messages', candidate);
    return { id: candidate.id, status: 'updated' };
  }

  await db.put('messages', candidate);
  return { id: candidate.id, status: 'created' };
}

async function getMessages(filter = {}) {
  const db = await dbPromise;
  let msgs;

  if (filter.rootId) {
    msgs = await db.getAllFromIndex('messages', 'rootId', filter.rootId);
  } else if (filter.type) {
    msgs = await db.getAllFromIndex('messages', 'type', filter.type);
  } else {
    msgs = await db.getAll('messages');
  }

  if (!filter.includeSuperseded) {
    msgs = msgs.filter((msg) => msg.isCurrent !== false);
  }

  msgs.sort((a, b) => {
    const pd = (b.priority || 0) - (a.priority || 0);
    return pd !== 0 ? pd : (b.createdAt || 0) - (a.createdAt || 0);
  });

  return msgs;
}

async function getMessageIds(filter = {}) {
  const msgs = await getMessages(filter);
  return msgs.map((msg) => msg.id);
}

async function deleteExpiredMessages() {
  const db = await dbPromise;
  const now = Date.now();
  const all = await db.getAll('messages');
  let count = 0;

  const tx = db.transaction('messages', 'readwrite');
  for (const msg of all) {
    if (msg.expiresAt <= now) {
      await tx.store.delete(msg.id);
      count++;
    }
  }
  await tx.done;

  if (count > 0) {
    window.dispatchEvent(new CustomEvent('meshdrop:bundles-updated', {
      detail: { source: 'expiry', count },
    }));
  }

  return count;
}

async function purgeMessage(id) {
  const db = await dbPromise;
  await db.delete('messages', id);
}

const saveBundle           = saveMessage;
const getBundles           = getMessages;
const getBundleIds         = getMessageIds;
const deleteExpiredBundles = deleteExpiredMessages;
const purgeBundle          = purgeMessage;

export {
  dbPromise,
  DB_NAME,
  VALID_TYPES,
  MAX_TITLE_LENGTH,
  MAX_BODY_LENGTH,
  MAX_HOPS,
  BODY_PREVIEW_LENGTH,
  BODY_FRAGMENT_LENGTH,
  MAX_RELAY_FRAGMENTS,
  saveMessage,
  getMessages,
  getMessageIds,
  deleteExpiredMessages,
  purgeMessage,
  saveBundle,
  getBundles,
  getBundleIds,
  deleteExpiredBundles,
  purgeBundle,
};

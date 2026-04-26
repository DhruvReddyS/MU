/**
 * MeshDrop — Differential Sync Protocol v2
 * Syncs messages between peers using delta comparison.
 * TTL in v2 = hops remaining (decrements per relay).
 * expiresAt = absolute timestamp (not derived from TTL).
 */
import { getMessageIds, getMessages, saveMessage } from './db.js';
import { sendToPeer, onMessage, getPeers, setAlias } from './webrtc.js';
import { getDisplayName, getDeviceShortId, saveContact } from './identity.js';

let _syncInitialised = false;
const MSG_HAVE     = 'MSG_HAVE';
const MSG_REQUEST  = 'MSG_REQUEST';
const MSG_BUNDLES  = 'MSG_BUNDLES';
const MSG_IDENTITY = 'IDENTITY';

function initSync() {
  if (_syncInitialised) return;
  _syncInitialised = true;

  onMessage(async (peerId, message) => {
    switch (message.type) {
      case MSG_IDENTITY:
        _handleIdentity(peerId, message.payload || {});
        break;
      case MSG_HAVE:
        await _handleHave(peerId, message.payload?.ids ?? []);
        break;
      case MSG_REQUEST:
        await _handleRequest(peerId, message.payload?.ids ?? []);
        break;
      case MSG_BUNDLES:
        await _handleIncoming(message.payload?.bundles ?? []);
        break;
      default:
        // Forward to any other listeners (e.g. ephemeral DM)
        window.dispatchEvent(new CustomEvent('meshdrop:peer-message', {
          detail: { peerId, message },
        }));
    }
  });

  window.addEventListener('meshdrop:peer-connected', (e) => {
    const peerId = e.detail?.peerId;
    if (!peerId) return;
    // Send our identity first so they know our alias
    sendToPeer(peerId, {
      type: MSG_IDENTITY,
      payload: { alias: getDisplayName(), shortId: getDeviceShortId() },
    });
    requestSync(peerId);
  });
}

function _handleIdentity(peerId, { alias, shortId }) {
  if (alias) {
    setAlias(peerId, alias);
    if (shortId) saveContact(shortId, alias);
  }
  window.dispatchEvent(new CustomEvent('meshdrop:peer-alias', {
    detail: { peerId, alias, shortId },
  }));
}

async function requestSync(peerId) {
  const myIds = await getMessageIds();
  window.dispatchEvent(new CustomEvent('meshdrop:sync-start', { detail: { peerId } }));
  sendToPeer(peerId, { type: MSG_HAVE, payload: { ids: myIds } });
}

async function _handleHave(peerId, theirIds) {
  const myIds  = new Set(await getMessageIds());
  const missing = theirIds.filter((id) => !myIds.has(id));

  if (missing.length === 0) {
    window.dispatchEvent(new CustomEvent('meshdrop:sync-complete', { detail: { peerId, count: 0 } }));
    return;
  }
  sendToPeer(peerId, { type: MSG_REQUEST, payload: { ids: missing } });
}

async function _handleRequest(peerId, requestedIds) {
  if (requestedIds.length === 0) {
    window.dispatchEvent(new CustomEvent('meshdrop:sync-complete', { detail: { peerId, count: 0 } }));
    return;
  }

  const requestedSet = new Set(requestedIds);
  const now = Date.now();
  const all  = await getMessages();
  const msgs = all
    .filter((m) => requestedSet.has(m.id) && m.ttl > 0 && m.expiresAt > now)
    .map((m)  => ({ ...m, ttl: m.ttl - 1, hops: m.hops + 1 }));

  sendToPeer(peerId, { type: MSG_BUNDLES, payload: { bundles: msgs } });
  window.dispatchEvent(new CustomEvent('meshdrop:sync-complete', { detail: { peerId, count: msgs.length } }));
}

async function _handleIncoming(bundles) {
  let saved = 0;
  const now = Date.now();

  for (const bundle of bundles) {
    // Skip expired messages. Allow ttl=0 — it means "save but don't relay further".
    // Blocking on ttl <= 0 was an off-by-one: a message sent with ttl=1 arrives as
    // ttl=0 (decremented by sender) and should still be saved by the recipient.
    if (!bundle.expiresAt || bundle.expiresAt <= now) continue;
    if (bundle.ttl < 0) continue;

    try {
      const result = await saveMessage(bundle, { mode: 'relay' });
      if (result.status === 'created' || result.status === 'updated' || result.status === 'merged') {
        saved++;
      }
    } catch (err) {
      console.warn('[TRINETRA] Rejected bundle:', err.message);
    }
  }

  if (saved > 0) {
    window.dispatchEvent(new CustomEvent('meshdrop:bundles-updated', {
      detail: { source: 'p2p-sync', count: saved },
    }));

    // Multi-hop fanout: relay to all peers if messages still have hops left
    const openPeers = getPeers().filter((p) => p.status === 'open');
    await Promise.all(openPeers.map((p) => requestSync(p.peerId)));
  }

  window.dispatchEvent(new CustomEvent('meshdrop:sync-complete', { detail: { count: saved } }));
}

// Direct push: send a single message to a specific peer without MSG_HAVE handshake
function pushMessage(peerId, msg) {
  if (!msg || msg.ttl < 0) return;
  if (typeof msg.expiresAt === 'number' && msg.expiresAt <= Date.now()) return;
  const pushed = { ...msg, ttl: msg.ttl - 1, hops: msg.hops + 1 };
  sendToPeer(peerId, { type: MSG_BUNDLES, payload: { bundles: [pushed] } });
}

// Push message to all currently open peers
async function broadcastMessage(msg) {
  const openPeers = getPeers().filter((p) => p.status === 'open');
  openPeers.forEach((p) => pushMessage(p.peerId, msg));
}

// legacy alias
const handleIncomingBundles = _handleIncoming;

export {
  initSync,
  requestSync,
  pushMessage,
  broadcastMessage,
  handleIncomingBundles,
  MSG_HAVE,
  MSG_REQUEST,
  MSG_BUNDLES,
  MSG_IDENTITY,
};

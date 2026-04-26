/**
 * MeshDrop — WebRTC P2P Engine
 * LAN-only DataChannel connections. No STUN, no TURN, no signaling server.
 * SDP exchange happens out-of-band via QR codes.
 * Trickle-less ICE: gather all candidates before encoding SDP to QR.
 */
import { compressToBase64, decompressFromBase64 } from 'lz-string';
import QRCode from 'qrcode';

/** SDP QR prefix — distinct from bundle QR prefix 'MD:' */
const SDP_PREFIX = 'MDSDP:';

/** Per-peer state: Map<peerId, { pc, channel, status }> */
const peers = new Map();

/** Global message handler registered by sync.js */
let _onMessageCallback = null;

// ─── ICE Gathering ───────────────────────────────────────────────

/**
 * Wait for ICE gathering to complete or timeout after 8s.
 * 8s is necessary for mobile hotspot (no internet) where the OS takes
 * a few seconds to surface the hotspot network interface candidate.
 * Without enough time, the SDP encodes before the LAN candidate is ready,
 * and the connection fails with a timeout on the other side.
 * @param {RTCPeerConnection} pc
 * @returns {Promise<void>}
 */
function waitForIceGatheringComplete(pc) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }
    const timeout = setTimeout(resolve, 8000);
    pc.addEventListener('icegatheringstatechange', function handler() {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timeout);
        pc.removeEventListener('icegatheringstatechange', handler);
        resolve();
      }
    });
  });
}

/**
 * Strip non-host ICE candidates from an SDP string.
 * Removes srflx (STUN-reflexive) and relay (TURN) candidates that are
 * useless on a purely local network and waste QR payload space.
 * Only 'host' type candidates carry the actual LAN IP needed for
 * direct device-to-device connections on a hotspot or LAN.
 */
function _filterHostCandidates(sdp) {
  return sdp.split('\r\n')
    .filter((line) => {
      if (!line.startsWith('a=candidate:')) return true;
      // Keep only host-type candidates (4th space-delimited field is type)
      const parts = line.split(' ');
      const typeIdx = parts.indexOf('typ');
      return typeIdx === -1 || parts[typeIdx + 1] === 'host';
    })
    .join('\r\n');
}

// ─── Channel Setup ───────────────────────────────────────────────

/**
 * Wire up DataChannel events for a connected peer.
 * @param {string} peerId
 * @param {RTCPeerConnection} pc
 * @param {RTCDataChannel} channel
 */
function _setupChannel(peerId, pc, channel) {
  const existing = peers.get(peerId);
  peers.set(peerId, { pc, channel, status: 'connecting', alias: existing?.alias || null });

  channel.onopen = () => {
    const peer = peers.get(peerId);
    if (peer) peer.status = 'open';
    console.log(`[TRINETRA] DataChannel open: ${peerId}`);
    window.dispatchEvent(new CustomEvent('meshdrop:peer-connected', { detail: { peerId } }));
  };

  channel.onclose = () => {
    const peer = peers.get(peerId);
    if (peer) peer.status = 'closed';
    console.log(`[TRINETRA] DataChannel closed: ${peerId}`);
    window.dispatchEvent(new CustomEvent('meshdrop:peer-disconnected', { detail: { peerId } }));
  };

  channel.onerror = (err) => {
    console.warn(`[TRINETRA] DataChannel error (${peerId}):`, err);
  };

  channel.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      if (_onMessageCallback) _onMessageCallback(peerId, message);
    } catch (err) {
      console.warn('[TRINETRA] Bad message from peer:', err.message);
    }
  };

  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;
    if (state === 'failed' || state === 'disconnected') {
      console.warn(`[TRINETRA] ICE ${state} for peer ${peerId}`);
      const peer = peers.get(peerId);
      if (peer) peer.status = 'closed';
      window.dispatchEvent(new CustomEvent('meshdrop:peer-disconnected', { detail: { peerId } }));
    }
  };
}

// ─── Host Flow ───────────────────────────────────────────────────

/**
 * Host: create an offer SDP.
 * @param {string} peerId - Unique ID for this connection
 * @returns {Promise<string>} JSON string ready to QR-encode
 */
async function createHostOffer(peerId) {
  const pc = new RTCPeerConnection({ iceServers: [], iceTransportPolicy: 'all' });
  const channel = pc.createDataChannel('meshdrop', { ordered: false, maxRetransmits: 0 });

  _setupChannel(peerId, pc, channel);

  await pc.setLocalDescription(await pc.createOffer());
  await waitForIceGatheringComplete(pc);

  const sdp = _filterHostCandidates(pc.localDescription.sdp);
  return JSON.stringify({ type: 'offer', sdp, peerId });
}

/**
 * Host: apply the joiner's answer after scanning their QR.
 * @param {string} answerJSON - JSON string from the joiner's answer QR
 */
async function acceptJoinerAnswer(answerJSON) {
  const { sdp, peerId } = JSON.parse(answerJSON);
  const peer = peers.get(peerId);
  if (!peer) throw new Error(`No pending host connection for peerId: ${peerId}`);
  await peer.pc.setRemoteDescription({ type: 'answer', sdp });
}

// ─── Join Flow ───────────────────────────────────────────────────

/**
 * Joiner: receive host's offer and produce an answer SDP.
 * @param {string} offerJSON - JSON string from the host's offer QR
 * @returns {Promise<string>} JSON string ready to QR-encode as answer
 */
async function createJoinerAnswer(offerJSON) {
  const { sdp, peerId } = JSON.parse(offerJSON);
  const pc = new RTCPeerConnection({ iceServers: [], iceTransportPolicy: 'all' });

  // Joiner receives the DataChannel
  pc.ondatachannel = (event) => {
    _setupChannel(peerId, pc, event.channel);
  };

  await pc.setRemoteDescription({ type: 'offer', sdp });
  await pc.setLocalDescription(await pc.createAnswer());
  await waitForIceGatheringComplete(pc);

  // Store pc before channel is open (channel arrives via ondatachannel)
  if (!peers.has(peerId)) {
    peers.set(peerId, { pc, channel: null, status: 'connecting', alias: null });
  }

  const answerSdp = _filterHostCandidates(pc.localDescription.sdp);
  return JSON.stringify({ type: 'answer', sdp: answerSdp, peerId });
}

async function createOffer() {
  const peerId = crypto.randomUUID?.() ?? Date.now().toString(36);
  const offerJSON = await createHostOffer(peerId);
  return _toBase64(offerJSON);
}

async function createAnswer(offerBase64) {
  const offerJSON = _fromBase64(offerBase64);
  const answerJSON = await createJoinerAnswer(offerJSON);
  return _toBase64(answerJSON);
}

async function completeConnection(answerBase64) {
  const answerJSON = _fromBase64(answerBase64);
  await acceptJoinerAnswer(answerJSON);
}

// ─── Messaging ───────────────────────────────────────────────────

/**
 * Send a typed message to a specific peer over DataChannel.
 * @param {string} peerId
 * @param {{ type: string, payload: any }} message
 */
function sendToPeer(peerId, message) {
  const peer = peers.get(peerId);
  if (!peer || peer.status !== 'open') {
    console.warn(`[TRINETRA] Peer ${peerId} not open`);
    return;
  }
  try {
    peer.channel.send(JSON.stringify(message));
  } catch (err) {
    console.warn(`[TRINETRA] Send failed for ${peerId}:`, err.message);
  }
}

/**
 * Register a global handler for all incoming peer messages.
 * @param {Function} callback - (peerId: string, message: { type, payload }) => void
 */
function onMessage(callback) {
  _onMessageCallback = callback;
}

function setAlias(peerId, alias) {
  const peer = peers.get(peerId);
  if (peer) peer.alias = alias;
}

function getPeers() {
  return Array.from(peers.entries()).map(([peerId, peer]) => ({
    peerId,
    status: peer.status,
    alias: peer.alias || null,
  }));
}

/**
 * Disconnect a specific peer.
 * @param {string} peerId
 */
function disconnectPeer(peerId) {
  const peer = peers.get(peerId);
  if (!peer) return;
  try { peer.channel?.close(); } catch (_) {}
  try { peer.pc.close(); } catch (_) {}
  peers.delete(peerId);
  window.dispatchEvent(new CustomEvent('meshdrop:peer-disconnected', { detail: { peerId } }));
}

/**
 * Disconnect all peers (called during emergency wipe).
 */
function disconnectAll() {
  for (const peerId of peers.keys()) {
    disconnectPeer(peerId);
  }
}

// ─── SDP QR Encoding ─────────────────────────────────────────────

// Optional SDP lines that are safe to strip for a DataChannel-only connection.
// Each line is a fixed string that adds bytes without changing connection behaviour.
const _SDP_STRIP = [
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'a=ice-options:trickle',
  'a=max-message-size:262144',
  'c=IN IP4 0.0.0.0',
];

function _minifySDP(sdp) {
  return sdp.split('\r\n')
    .filter((line) => !_SDP_STRIP.includes(line.trim()))
    .join('\r\n');
}

/**
 * Encode an SDP JSON string into a QR code canvas.
 * Strips optional SDP lines to reduce QR module count.
 * @param {string} sdpJSON
 * @returns {Promise<HTMLCanvasElement>}
 */
async function sdpToQR(sdpJSON) {
  const obj = JSON.parse(sdpJSON);
  if (obj.sdp) obj.sdp = _minifySDP(obj.sdp);
  const payload = SDP_PREFIX + compressToBase64(JSON.stringify(obj));
  const canvas = document.createElement('canvas');
  await QRCode.toCanvas(canvas, payload, {
    errorCorrectionLevel: 'L',
    margin: 2,
    width: 420,
    color: { dark: '#000000', light: '#ffffff' },
  });
  canvas.style.cssText = 'max-width:100%;height:auto;display:block;border-radius:4px;';
  return canvas;
}

/**
 * Decode an MDSDP: QR payload back to SDP JSON string.
 * @param {string} payload - Raw QR string
 * @returns {string} SDP JSON string
 */
function decodeSdpPayload(payload) {
  if (!payload.startsWith(SDP_PREFIX)) throw new Error('Not a TRINETRA SDP QR');
  const json = decompressFromBase64(payload.slice(SDP_PREFIX.length));
  if (!json) throw new Error('Failed to decompress SDP payload');
  return json;
}

export {
  createOffer,
  createAnswer,
  completeConnection,
  createHostOffer,
  acceptJoinerAnswer,
  createJoinerAnswer,
  sendToPeer,
  onMessage,
  getPeers,
  setAlias,
  disconnectPeer,
  disconnectAll,
  sdpToQR,
  decodeSdpPayload,
  SDP_PREFIX,
};

function _toBase64(value) {
  return btoa(unescape(encodeURIComponent(value)));
}

function _fromBase64(value) {
  return decodeURIComponent(escape(atob(value)));
}

/**
 * TRINETRA — Peer Public Key Registry
 * In-memory store mapping peerId → ECDH public key (base64).
 * Populated during key exchange immediately after WebRTC DataChannel opens.
 * Used by dm-screen (encrypt outgoing) and main (decrypt incoming).
 */

const _keys = new Map(); // peerId → publicKeyB64

export const getPeerPublicKey = (peerId) => _keys.get(peerId) ?? null;
export const setPeerPublicKey = (peerId, key) => { _keys.set(peerId, key); };
export const clearPeerKey     = (peerId) => { _keys.delete(peerId); };

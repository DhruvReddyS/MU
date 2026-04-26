/**
 * MeshDrop — Crypto Layer
 * Uses WebCrypto API (window.crypto.subtle) when available (secure context).
 * Falls back gracefully when running over HTTP on a network IP.
 * - ECDH P-256 for key exchange
 * - AES-256-GCM for DM encryption
 * - SHA-256 for bundle ID generation
 */
import { dbPromise } from './db.js';

/** In-memory private key — never stored to disk/DB */
let sessionPrivateKey = null;

/** True when Web Crypto is available (HTTPS or localhost) */
const CRYPTO_AVAILABLE = !!(window?.crypto?.subtle);

/** Random hex string from getRandomValues (works in all contexts) */
function _randomHex(byteCount) {
  const buf = crypto.getRandomValues(new Uint8Array(byteCount));
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate an ECDH P-256 session keypair.
 * Falls back to a random token when crypto.subtle is unavailable.
 */
async function generateSessionKeypair() {
  if (!CRYPTO_AVAILABLE) {
    const publicKeyB64 = btoa(_randomHex(32));
    const db = await dbPromise;
    await db.put('keys', { name: 'session_public', key: publicKeyB64, createdAt: Date.now() });
    return { publicKey: publicKeyB64, privateKey: null };
  }

  const keyPair = await window.crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );

  // Export public key to raw bytes, then base64
  const publicKeyRaw = await window.crypto.subtle.exportKey('raw', keyPair.publicKey);
  const publicKeyB64 = arrayBufferToBase64(publicKeyRaw);

  // Store public key in IndexedDB
  const db = await dbPromise;
  await db.put('keys', {
    name: 'session_public',
    key: publicKeyB64,
    createdAt: Date.now(),
  });

  // Keep private key in memory only
  sessionPrivateKey = keyPair.privateKey;

  console.log('[TRINETRA] Session keypair generated');
  return {
    publicKey: publicKeyB64,
    privateKey: keyPair.privateKey,
  };
}

async function ensureSessionKeypair() {
  if (sessionPrivateKey) {
    return getSessionPublicKey();
  }

  const pair = await generateSessionKeypair();
  return pair.publicKey;
}

/**
 * Get the in-memory session private key.
 * @returns {CryptoKey|null}
 */
function getSessionPrivateKey() {
  return sessionPrivateKey;
}

/**
 * Get the stored session public key from IndexedDB.
 * @returns {Promise<string|null>} Base64 public key or null
 */
async function getSessionPublicKey() {
  const db = await dbPromise;
  const entry = await db.get('keys', 'session_public');
  return entry ? entry.key : null;
}

// ─── Utility functions ───────────────────────────────────────────

/**
 * Convert ArrayBuffer to base64 string.
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert base64 string to ArrayBuffer.
 * @param {string} base64
 * @returns {ArrayBuffer}
 */
function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ─── DM Encryption (ECDH + AES-256-GCM) ─────────────────────────

/**
 * Import a raw ECDH public key from base64.
 * @param {string} publicKeyB64 - Base64-encoded raw public key
 * @returns {Promise<CryptoKey>}
 */
async function importPublicKey(publicKeyB64) {
  const rawKey = base64ToArrayBuffer(publicKeyB64);
  return window.crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
}

/**
 * Derive an AES-256-GCM key from ECDH shared secret.
 * @param {CryptoKey} privateKey - Our ECDH private key
 * @param {CryptoKey} publicKey - Recipient's ECDH public key
 * @returns {Promise<CryptoKey>} AES-GCM key
 */
async function deriveSharedKey(privateKey, publicKey) {
  return window.crypto.subtle.deriveKey(
    { name: 'ECDH', public: publicKey },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a plaintext string for a DM recipient.
 * Uses ECDH to derive shared secret, then AES-256-GCM to encrypt.
 * @param {string} plaintext - The message to encrypt
 * @param {string} recipientPublicKeyB64 - Recipient's base64 public key
 * @returns {Promise<{ciphertext: string, iv: string}>} Base64-encoded ciphertext and IV
 */
async function encryptDM(plaintext, recipientPublicKeyB64) {
  if (!CRYPTO_AVAILABLE) {
    throw new Error('Encryption unavailable — open the app over HTTPS or localhost');
  }
  if (!sessionPrivateKey) {
    throw new Error('No session keypair — call generateSessionKeypair() first');
  }

  const recipientPublicKey = await importPublicKey(recipientPublicKeyB64);
  const sharedKey = await deriveSharedKey(sessionPrivateKey, recipientPublicKey);

  // Generate random 12-byte IV
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  // Encode plaintext to bytes
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  // Encrypt with AES-256-GCM
  const encrypted = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    sharedKey,
    data
  );

  return {
    ciphertext: arrayBufferToBase64(encrypted),
    iv: arrayBufferToBase64(iv.buffer),
  };
}

/**
 * Decrypt a DM ciphertext from a sender.
 * Uses ECDH to derive shared secret, then AES-256-GCM to decrypt.
 * @param {string} ciphertextB64 - Base64-encoded ciphertext
 * @param {string} ivB64 - Base64-encoded IV
 * @param {string} senderPublicKeyB64 - Sender's base64 public key
 * @returns {Promise<string>} Decrypted plaintext
 */
async function decryptDM(ciphertextB64, ivB64, senderPublicKeyB64) {
  if (!CRYPTO_AVAILABLE) {
    throw new Error('Encryption unavailable — open the app over HTTPS or localhost');
  }
  if (!sessionPrivateKey) {
    throw new Error('No session keypair — call generateSessionKeypair() first');
  }

  const senderPublicKey = await importPublicKey(senderPublicKeyB64);
  const sharedKey = await deriveSharedKey(sessionPrivateKey, senderPublicKey);

  const iv = new Uint8Array(base64ToArrayBuffer(ivB64));
  const ciphertext = base64ToArrayBuffer(ciphertextB64);

  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    sharedKey,
    ciphertext
  );

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

// ─── Bundle ID Generation (SHA-256) ──────────────────────────────

/**
 * Generate a deterministic bundle ID using SHA-256.
 * Hash of: content + timestamp + nonce
 * @param {string} content - The bundle content
 * @param {number} timestamp - The bundle timestamp
 * @param {string} [nonce] - Optional nonce (random string if not provided)
 * @returns {Promise<string>} Hex-encoded SHA-256 hash
 */
async function generateBundleId(content, timestamp, nonce) {
  const n = nonce || _randomHex(8);

  if (!CRYPTO_AVAILABLE) {
    // Fallback: combine inputs into a deterministic-ish hex ID without SHA-256
    return _randomHex(16) + n;
  }

  const input = `${content}|${timestamp}|${n}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(input);

  const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);

  return hashArray.reduce((s, b) => s + b.toString(16).padStart(2, '0'), '');
}

export {
  ensureSessionKeypair,
  generateSessionKeypair,
  getSessionPrivateKey,
  getSessionPublicKey,
  encryptDM,
  decryptDM,
  generateBundleId,
  arrayBufferToBase64,
  base64ToArrayBuffer,
};

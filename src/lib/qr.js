/**
 * MeshDrop — QR System
 *
 * Generation:
 *   - Error correction 'L' (7%) = fewest modules = biggest cells = easiest to scan
 *   - 300px canvas — compact enough to keep modules large on a phone screen
 *   - Bundles stripped to essential fields before encoding
 *   - Max 200 compressed bytes per QR chunk → ≤QR v9 (53×53 modules)
 *     → ~5.7 px/module on a phone → laptop camera reads it reliably
 *
 * Scanner (startVideoScanner / startQRScanner):
 *   - ONE global scanner at a time — starting a new one always stops the old
 *   - Raw imageData passed to _findQR; preprocessing functions return NEW ImageData
 *     (never mutate the original — avoids the double-enhance bug)
 *   - Six decode attempts per frame: raw, enhanced, binarized, 72%-crop×2, 50%-crop
 *   - Payload debounce: same QR text only fires onDecode once while in frame;
 *     resets when frame goes blank so the same code can fire again after removal
 *   - Event-based video-ready wait (no polling)
 */
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { compressToBase64, decompressFromBase64 } from 'lz-string';

const MAX_QR_BYTES    = 200;
const QR_PREFIX       = 'MD:';
const QR_MULTI_PREFIX = 'MDm:';

const MAX_SCAN_DIM  = 1280; // higher res capture → more pixels per QR module
const SCAN_INTERVAL = 80;   // faster polling → catches a steady frame quicker

// ─── Global scanner state (one camera at a time) ──────────────────
let _scanStream = null;
let _scanTimer  = null;
let _torchOn    = false;

// ─── QR Generation ───────────────────────────────────────────────

async function _renderQR(payload) {
  const canvas = document.createElement('canvas');
  await QRCode.toCanvas(canvas, payload, {
    errorCorrectionLevel: 'L',
    margin: 2,
    width: 460,
    color: { dark: '#000000', light: '#ffffff' },
  });
  canvas.style.cssText = 'max-width:100%;height:auto;display:block;border-radius:4px;';
  return canvas;
}

function _stripBundle(b) {
  return {
    id:        b.id,
    rootId:    b.rootId,
    revision:  b.revision,
    replaces:  b.replaces || null,
    type:      b.type,
    priority:  b.priority,
    title:     b.title,
    body:      b.bodyState === 'full' ? b.body : '',
    bodyPreview: b.bodyPreview,
    fragments: b.fragments,
    fragmentCount: b.fragmentCount,
    createdAt: b.createdAt,
    expiresAt: b.expiresAt,
    ttl:       b.ttl,
    hops:      b.hops,
    ...(b.lat != null && b.lng != null ? { lat: b.lat, lng: b.lng } : {}),
    ...(Array.isArray(b.waypoints) && b.waypoints.length > 0 ? { waypoints: b.waypoints } : {}),
  };
}

/**
 * Convert an array of bundles into one or more QR code canvases.
 * Large sets are automatically split; always returns at least one canvas.
 */
async function bundlesToQR(bundles) {
  if (!Array.isArray(bundles) || bundles.length === 0) {
    throw new Error('bundlesToQR requires a non-empty array');
  }

  const slim = bundles.map(_stripBundle);

  const single = QR_PREFIX + compressToBase64(JSON.stringify(slim));
  if (new TextEncoder().encode(single).length <= MAX_QR_BYTES) {
    return [await _renderQR(single)];
  }

  const chunks = _splitBundles(slim);
  const total  = chunks.length;
  const out    = [];
  for (let i = 0; i < chunks.length; i++) {
    const payload = QR_MULTI_PREFIX + `${i + 1}/${total}:` + compressToBase64(JSON.stringify(chunks[i]));
    out.push(await _renderQR(payload));
  }
  return out;
}

function _splitBundles(bundles) {
  const groups = [];
  let current  = [];

  for (const bundle of bundles) {
    const candidate = [...current, bundle];
    const payload   = QR_MULTI_PREFIX + '1/1:' + compressToBase64(JSON.stringify(candidate));
    if (new TextEncoder().encode(payload).length > MAX_QR_BYTES && current.length > 0) {
      groups.push(current);
      current = [bundle];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/**
 * Decode a raw QR text string → { bundles, part, total }
 * Handles both single (MD:) and multi-part (MDm:) payloads.
 */
function decodeQRPayload(payload) {
  if (payload.startsWith(QR_MULTI_PREFIX)) {
    const rest     = payload.slice(QR_MULTI_PREFIX.length);
    const slashIdx = rest.indexOf('/');
    const colonIdx = rest.indexOf(':');
    if (slashIdx < 0 || colonIdx < 0) throw new Error('Malformed multi-QR header');
    const part  = parseInt(rest.slice(0, slashIdx), 10);
    const total = parseInt(rest.slice(slashIdx + 1, colonIdx), 10);
    const json  = decompressFromBase64(rest.slice(colonIdx + 1));
    if (!json) throw new Error('Failed to decompress multi-QR payload');
    return { bundles: JSON.parse(json), part, total };
  }

  if (payload.startsWith(QR_PREFIX)) {
    const json = decompressFromBase64(payload.slice(QR_PREFIX.length));
    if (!json) throw new Error('Failed to decompress QR payload');
    const bundles = JSON.parse(json);
    if (!Array.isArray(bundles)) throw new Error('QR payload is not a bundles array');
    return { bundles, part: 1, total: 1 };
  }

  throw new Error('Not a TRINETRA QR code');
}

// ─── Image preprocessing (all return NEW ImageData, never mutate) ─

function _enhanceContrast(imageData) {
  const src = imageData.data;
  const out = new ImageData(imageData.width, imageData.height);
  const dst = out.data;
  for (let i = 0; i < src.length; i += 4) {
    const g = src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114;
    const e = g < 128 ? Math.max(0, g - 60) : Math.min(255, g + 60);
    dst[i] = dst[i + 1] = dst[i + 2] = e;
    dst[i + 3] = 255;
  }
  return out;
}

function _binarize(imageData) {
  const src = imageData.data;
  const out = new ImageData(imageData.width, imageData.height);
  const dst = out.data;
  for (let i = 0; i < src.length; i += 4) {
    const g = src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114;
    const v = g < 128 ? 0 : 255;
    dst[i] = dst[i + 1] = dst[i + 2] = v;
    dst[i + 3] = 255;
  }
  return out;
}

function _strongEnhance(imageData) {
  const src = imageData.data;
  const out = new ImageData(imageData.width, imageData.height);
  const dst = out.data;
  for (let i = 0; i < src.length; i += 4) {
    const g = src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114;
    const e = g < 128 ? Math.max(0, g - 100) : Math.min(255, g + 100);
    dst[i] = dst[i + 1] = dst[i + 2] = e;
    dst[i + 3] = 255;
  }
  return out;
}

function _sharpen(imageData) {
  const { width, height, data } = imageData;
  const out = new ImageData(width, height);
  const dst = out.data;
  const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let g = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const py = Math.min(height - 1, Math.max(0, y + ky));
          const px = Math.min(width  - 1, Math.max(0, x + kx));
          const idx = (py * width + px) * 4;
          const lum = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
          g += lum * kernel[(ky + 1) * 3 + (kx + 1)];
        }
      }
      const v = Math.min(255, Math.max(0, g));
      const i = (y * width + x) * 4;
      dst[i] = dst[i + 1] = dst[i + 2] = v;
      dst[i + 3] = 255;
    }
  }
  return out;
}

function _cropCenter(imageData, ratio) {
  const cw = Math.round(imageData.width  * ratio);
  const ch = Math.round(imageData.height * ratio);
  if (cw < 80 || ch < 80) return null;
  const sx = Math.round((imageData.width  - cw) / 2);
  const sy = Math.round((imageData.height - ch) / 2);
  const out = new ImageData(cw, ch);
  for (let y = 0; y < ch; y++) {
    const s = ((sy + y) * imageData.width + sx) * 4;
    out.data.set(imageData.data.subarray(s, s + cw * 4), y * cw * 4);
  }
  return out;
}

function _tryDecode(imageData) {
  return jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'attemptBoth',
  });
}

/**
 * Try multiple preprocessing strategies on a raw (unmodified) frame.
 * Ordered: fastest / most-likely first to minimise CPU on easy frames.
 * Each helper returns a NEW ImageData — raw is never mutated.
 */
function _findQR(raw) {
  let r;

  r = _tryDecode(raw);                            if (r) return r;
  r = _tryDecode(_enhanceContrast(raw));          if (r) return r;
  r = _tryDecode(_strongEnhance(raw));            if (r) return r;
  r = _tryDecode(_binarize(raw));                 if (r) return r;
  r = _tryDecode(_sharpen(raw));                  if (r) return r;

  for (const ratio of [0.90, 0.85, 0.72, 0.60, 0.50]) {
    const crop = _cropCenter(raw, ratio);
    if (!crop) continue;
    r = _tryDecode(crop);                         if (r) return r;
    r = _tryDecode(_enhanceContrast(crop));       if (r) return r;
    r = _tryDecode(_strongEnhance(crop));         if (r) return r;
    r = _tryDecode(_binarize(crop));              if (r) return r;
    r = _tryDecode(_sharpen(crop));               if (r) return r;
  }

  return null;
}

// ─── Camera helpers ───────────────────────────────────────────────

async function _openCamera() {
  const tries = [
    { video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
    { video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
    { video: { facingMode: 'environment' }, audio: false },
    { video: { width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
    { video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
    { video: true, audio: false },
  ];
  let lastErr;
  for (const c of tries) {
    try { return await navigator.mediaDevices.getUserMedia(c); } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error('Camera not available');
}

function _attachVideo(videoEl, stream) {
  videoEl.playsInline    = true;
  videoEl.muted          = true;
  videoEl.autoplay       = true;
  videoEl.setAttribute('playsinline', '');
  videoEl.setAttribute('webkit-playsinline', '');
  videoEl.srcObject = stream;
}

function _waitVideoReady(videoEl) {
  if (videoEl.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      videoEl.removeEventListener('canplay', ok);
      videoEl.removeEventListener('error',   bad);
      reject(new Error('Camera did not start within 8 s — check permissions'));
    }, 8000);
    function ok()  { clearTimeout(t); videoEl.removeEventListener('error', bad);  resolve(); }
    function bad() { clearTimeout(t); videoEl.removeEventListener('canplay', ok); reject(new Error('Camera stream error')); }
    videoEl.addEventListener('canplay', ok,  { once: true });
    videoEl.addEventListener('error',   bad, { once: true });
  });
}

// ─── Core scan engine ─────────────────────────────────────────────

/**
 * Start the shared video scanner.
 *
 * Calls onDecode(rawText) the first time each unique QR text is detected.
 * When the QR leaves the frame (no QR found for one tick), the last-seen
 * payload is cleared so the same code can fire again when re-shown.
 *
 * Always stops any existing scanner first — only one camera open at a time.
 *
 * @param {HTMLVideoElement} videoEl
 * @param {function(string): void} onDecode  receives raw QR text
 */
async function startVideoScanner(videoEl, onDecode) {
  stopVideoScanner();

  _scanStream = await _openCamera();
  _attachVideo(videoEl, _scanStream);

  try { await videoEl.play(); } catch { /* autoplay restriction — canplay fires anyway */ }
  await _waitVideoReady(videoEl);

  const canvas = document.createElement('canvas');
  const ctx    = canvas.getContext('2d', { willReadFrequently: true });
  let lastPayload = null;

  function tick() {
    if (!_scanStream) return;

    if (videoEl.readyState >= 2 && videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
      try {
        const scale = Math.min(1, MAX_SCAN_DIM / Math.max(videoEl.videoWidth, videoEl.videoHeight));
        const w = Math.round(videoEl.videoWidth  * scale);
        const h = Math.round(videoEl.videoHeight * scale);

        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }

        ctx.drawImage(videoEl, 0, 0, w, h);
        const raw   = ctx.getImageData(0, 0, w, h);
        const found = _findQR(raw);

        if (found) {
          if (found.data !== lastPayload) {
            lastPayload = found.data;
            try { onDecode(found.data); } catch (e) { console.warn('[QR onDecode]', e); }
          }
        } else {
          lastPayload = null; // QR left frame — allow same code to fire again
        }
      } catch { /* frame error during screen transitions, ignore */ }
    }

    _scanTimer = setTimeout(tick, SCAN_INTERVAL);
  }

  tick();
}

/**
 * Stop the scanner and release the camera.
 */
function stopVideoScanner() {
  if (_scanTimer)  { clearTimeout(_scanTimer); _scanTimer = null; }
  if (_scanStream) { _scanStream.getTracks().forEach((t) => t.stop()); _scanStream = null; }
  _torchOn = false;
}

// ─── High-level QR scanner (filters for MD: / MDm: prefix) ───────

/**
 * Convenience wrapper: starts the scanner and calls onResult only for
 * valid TRINETRA bundle QR codes (MD: / MDm: prefix).
 *
 * @param {HTMLVideoElement} videoEl
 * @param {function({ bundles, part, total }): void} onResult
 */
async function startQRScanner(videoEl, onResult) {
  await startVideoScanner(videoEl, (text) => {
    if (text.startsWith(QR_PREFIX) || text.startsWith(QR_MULTI_PREFIX)) {
      try { onResult(decodeQRPayload(text)); } catch { /* malformed payload, keep scanning */ }
    }
  });
}

function stopQRScanner() {
  stopVideoScanner();
}

// ─── Torch / Flashlight ───────────────────────────────────────────

async function toggleTorch() {
  if (!_scanStream) return false;
  const track = _scanStream.getVideoTracks()[0];
  if (!track) return false;
  const caps = track.getCapabilities?.() || {};
  if (!caps.torch) return false;
  _torchOn = !_torchOn;
  try {
    await track.applyConstraints({ advanced: [{ torch: _torchOn }] });
  } catch {
    _torchOn = !_torchOn;
  }
  return _torchOn;
}

function isTorchAvailable() {
  if (!_scanStream) return false;
  const track = _scanStream.getVideoTracks()[0];
  return !!(track?.getCapabilities?.()?.torch);
}

export {
  bundlesToQR,
  decodeQRPayload,
  startVideoScanner,
  stopVideoScanner,
  startQRScanner,
  stopQRScanner,
  toggleTorch,
  isTorchAvailable,
  MAX_QR_BYTES,
  QR_PREFIX,
  QR_MULTI_PREFIX,
};

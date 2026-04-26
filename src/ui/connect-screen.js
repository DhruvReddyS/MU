/**
 * MeshDrop — Connect Screen
 * - Shows connected WebRTC peers with alias names
 * - Keeps session-scoped peer labels for the current runtime only
 * - LAN peer discovery via BroadcastChannel
 * - Web Bluetooth proximity hints
 * - Two-step QR WebRTC handshake (Host / Join flows)
 */
import {
  createHostOffer,
  acceptJoinerAnswer,
  createJoinerAnswer,
  getPeers,
  disconnectPeer,
  sdpToQR,
  decodeSdpPayload,
  SDP_PREFIX,
} from '../lib/webrtc.js';
import QRCode from 'qrcode';
import { requestSync } from '../lib/sync.js';
import { getDeviceShortId, getDisplayName, getAllContacts, getContactAlias, removeContact } from '../lib/identity.js';
import {
  isBluetoothSupported,
  isBluetoothAvailable,
  pickNearbyDevice,
  getKnownNearbyDevices,
} from '../lib/bluetooth.js';
import { startVideoScanner, stopVideoScanner } from '../lib/qr.js';
import { icon } from './icons.js';

const PAIRING_TIMEOUT = 90_000;

const BC_CHANNEL  = 'meshdrop-presence';
const BC_ANNOUNCE = 'announce';
const BC_REPLY    = 'reply';

let _pairingTimeout  = null;
let _wakeLock        = null;
let _peerContainer   = null;
let _bc              = null;
let _handoffOverlay  = null;
let _relayedCount    = 0;
let _maxHopsObserved = 0;

const _lanPeers = new Map();

function _shouldShowRefreshReconnectNote() {
  const navEntry = performance.getEntriesByType?.('navigation')?.[0];
  if (navEntry?.type) return navEntry.type === 'reload';

  const legacyNavigation = performance.navigation;
  return legacyNavigation?.type === legacyNavigation?.TYPE_RELOAD;
}

function _isLoopbackHost(hostname = window.location.hostname) {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname === '[::1]';
}

function _isPrivateIpv4(hostname = window.location.hostname) {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)\d{1,3}\.\d{1,3}$/.test(hostname);
}

function _getAccessUrl() {
  try {
    const url = new URL(window.location.href);
    url.hash = '';
    return url.toString();
  } catch {
    return window.location.href;
  }
}

function _getTransportState() {
  const hostname = window.location.hostname;
  const secure = window.isSecureContext;
  const cameraReady = !!navigator.mediaDevices?.getUserMedia;
  const bluetoothReady = isBluetoothSupported();
  const crossDeviceReady = secure && !_isLoopbackHost(hostname);
  const localOriginHint = _isPrivateIpv4(hostname) ? 'LAN-ready origin' : _isLoopbackHost(hostname) ? 'Loopback only' : 'Reachability depends on this host';

  return {
    accessUrl: _getAccessUrl(),
    hostname,
    secure,
    cameraReady,
    bluetoothReady,
    crossDeviceReady,
    localOriginHint,
  };
}

// ─── Public API ──────────────────────────────────────────────────

export function renderConnectScreen(container) {
  _peerContainer = container;
  const shouldShowReconnectNote = _shouldShowRefreshReconnectNote() && getAllContacts().length > 0;

  container.innerHTML = `
    <div class="connect-screen animate-in">

      <div id="peer-list-section"></div>
      <div id="discovery-section"></div>

      ${shouldShowReconnectNote ? `
        <div class="session-reset-note">
          <div class="session-reset-note-icon">${icon('signal')}</div>
          <div class="session-reset-note-body">
            <div class="session-reset-note-title">Session Refreshed</div>
            <div class="session-reset-note-text">
              Live connections were cleared for safety. Use <strong>Re-pair</strong> below or start a new QR connection.
            </div>
          </div>
        </div>
      ` : ''}

        <div id="mode-selector">
          <div class="connect-hero">
          <div style="display:flex;align-items:center;justify-content:center;margin-bottom:8px;color:var(--brand-light);">${icon('radar')}</div>
          <h2>Connect Devices</h2>
          <p class="text-muted text-sm" style="margin-top:6px;line-height:1.6;">
            QR-negotiated local peer links with no servers and no internet.
          </p>
        </div>

        <!-- ── Zero-network offline transfer callout ── -->
        <div style="display:flex;align-items:flex-start;gap:12px;padding:14px;margin-bottom:14px;background:rgba(52,199,89,0.07);border:1px solid rgba(52,199,89,0.28);border-radius:var(--radius);line-height:1.5;">
          <span style="font-size:1.3rem;flex-shrink:0;margin-top:1px;">📴</span>
          <div>
            <div style="font-size:0.85rem;font-weight:800;color:#34c759;letter-spacing:0.04em;margin-bottom:4px;">NO WIFI? NO HOTSPOT? NO PROBLEM</div>
            <div style="font-size:0.8rem;color:var(--text-secondary);line-height:1.6;">
              Use the <strong style="color:var(--text);">QR Drop tab</strong> to transfer messages
              directly between screens — zero network required, works completely offline.
            </div>
            <div style="font-size:0.78rem;color:var(--text-muted);margin-top:6px;">
              ↓ The live peer link below needs both devices on the same Wi-Fi or hotspot.
            </div>
          </div>
        </div>

        <div class="connect-mode-grid" style="margin-top:4px;">
          <button class="connect-mode-card primary-action" id="btn-host">
            <div class="connect-mode-icon">${icon('broadcast')}</div>
            <div class="connect-mode-info">
              <div class="connect-mode-title">Start Connection</div>
            <div class="connect-mode-sub">Show your QR, other device scans it</div>
          </div>
          <span class="connect-mode-arrow">${icon('back')}</span>
          </button>

          <button class="connect-mode-card" id="btn-join">
            <div class="connect-mode-icon">${icon('camera')}</div>
            <div class="connect-mode-info">
              <div class="connect-mode-title">Join Connection</div>
              <div class="connect-mode-sub">Scan the host's QR code to connect</div>
            </div>
            <span class="connect-mode-arrow">${icon('back')}</span>
          </button>
        </div>

        ${_renderHotspotGuide()}

        ${_renderTransportToolkit()}

        <div id="bt-panel" style="margin-top:14px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <span style="font-size:0.8rem;font-weight:700;color:var(--text-muted);letter-spacing:0.06em;text-transform:uppercase;">Bluetooth Proximity Hints</span>
            <button class="btn btn-secondary btn-sm" id="btn-bt-scan">+ Scan New</button>
          </div>
          <div id="bt-device-list">
            <div class="loading-row" id="bt-loading"><div class="spinner"></div><span class="text-muted" style="font-size:0.85rem;">Loading…</span></div>
          </div>
          <div id="bt-no-support" class="hidden" style="padding:10px 14px;font-size:0.82rem;color:var(--text-muted);background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);line-height:1.55;">
            Web Bluetooth not available.<br>
            <strong style="color:var(--text-secondary);">Use Chrome on Android or Chrome desktop</strong> for optional proximity hints.
          </div>
        </div>

        <div id="saved-contacts-section" style="margin-top:14px;"></div>
      </div>

      <!-- Host wizard -->
      <div class="hidden" id="host-wizard">
        <div class="wizard-header">
          <button class="btn-back" id="host-back">${icon('back')} Back</button>
          <h3>Start Connection</h3>
        </div>

        <div id="host-step-1">
          <div class="stepper" style="margin-bottom:20px;">
            <div class="stepper-step active"><span class="step-num">1</span><span class="step-label">Show QR</span></div>
            <div class="stepper-step"><span class="step-num">2</span><span class="step-label">Scan Response</span></div>
            <div class="stepper-step"><span class="step-num">3</span><span class="step-label">Done</span></div>
          </div>
          <p class="text-secondary text-sm" style="margin-bottom:14px;line-height:1.55;">
            Show this QR to the other device. Keep the screen bright and held steady.
          </p>
          <div class="qr-box" id="offer-qr-box">
            <div class="loading-row"><div class="spinner"></div><span class="text-muted">Generating…</span></div>
          </div>
          <div class="timeout-bar" style="margin-top:10px;">
            <div class="timeout-fill" id="host-timeout-fill" style="width:100%;"></div>
          </div>
          <p class="text-muted text-sm text-center" style="margin-top:4px;" id="host-step1-time">90s remaining</p>
          <button class="btn btn-primary btn-full" id="host-next-btn" style="margin-top:14px;" disabled>
            ${icon('camera')} Scan Their Response
          </button>
        </div>

        <div class="hidden" id="host-step-2">
          <div class="stepper" style="margin-bottom:20px;">
            <div class="stepper-step done"><span class="step-num">${icon('check')}</span><span class="step-label">Show QR</span></div>
            <div class="stepper-step active"><span class="step-num">2</span><span class="step-label">Scan Response</span></div>
            <div class="stepper-step"><span class="step-num">3</span><span class="step-label">Done</span></div>
          </div>
          <div id="host-cam-prompt" class="cam-permission-prompt" style="margin-bottom:14px;">
            <div class="cam-permission-icon">📷</div>
            <div class="cam-permission-title">Camera Needed</div>
            <div class="cam-permission-sub">Point your camera at the other device's response QR code to complete the connection.</div>
            <button class="btn btn-primary" id="host-grant-cam" style="margin-top:10px;width:100%;">Allow Camera</button>
          </div>
          <div class="hidden" id="host-scanner-wrap">
            <div class="scanner-wrap">
              <video id="host-video" class="scanner-video" playsinline muted autoplay></video>
              <div class="scanner-overlay">
                <div class="scanner-frame"></div>
                <div class="scan-line"></div>
              </div>
            </div>
            <p class="text-muted text-sm text-center" style="margin-top:8px;">Scanning for response QR…</p>
          </div>
        </div>
      </div>

      <!-- Join wizard -->
      <div class="hidden" id="join-wizard">
        <div class="wizard-header">
          <button class="btn-back" id="join-back">${icon('back')} Back</button>
          <h3>Join Connection</h3>
        </div>

        <!-- Shared stepper (state mutated by JS) -->
        <div class="stepper" id="join-stepper" style="margin-bottom:20px;">
          <div class="stepper-step" id="join-stp-1"><span class="step-num">1</span><span class="step-label">Scan Host</span></div>
          <div class="stepper-step" id="join-stp-2"><span class="step-num">2</span><span class="step-label">Show Response</span></div>
          <div class="stepper-step" id="join-stp-3"><span class="step-num">3</span><span class="step-label">Done</span></div>
        </div>

        <!-- Step 0: Intent card (shown first, no camera yet) -->
        <div id="join-step-0">
          <div class="join-intent-card">
            <div class="join-intent-icon">${icon('qr')}</div>
            <div class="join-intent-title">Scan Host's QR Code</div>
            <div class="join-intent-body">
              The other device will display a QR code. Open your camera to scan it and establish a secure P2P connection.
            </div>
          </div>
          <button class="btn btn-primary btn-full" id="join-start-scan" style="margin-top:14px;">
            ${icon('camera')} Open Camera &amp; Scan
          </button>
        </div>

        <!-- Step 1: Camera permission + scanner -->
        <div class="hidden" id="join-step-1">
          <div id="join-cam-prompt" class="cam-permission-prompt" style="margin-bottom:14px;">
            <div class="cam-permission-icon">📷</div>
            <div class="cam-permission-title">Allow Camera</div>
            <div class="cam-permission-sub">Point your camera at the QR code on the host device to connect.</div>
            <button class="btn btn-primary" id="join-grant-cam" style="margin-top:10px;width:100%;">Allow Camera &amp; Scan</button>
          </div>
          <div class="hidden" id="join-scanner-wrap">
            <div class="scanner-wrap">
              <video id="join-video" class="scanner-video" playsinline muted autoplay></video>
              <div class="scanner-overlay">
                <div class="scanner-frame"></div>
                <div class="scan-line"></div>
              </div>
            </div>
            <p class="text-muted text-sm text-center" style="margin-top:8px;">Scanning for host QR…</p>
          </div>
        </div>

        <!-- Step 2: Show answer QR -->
        <div class="hidden" id="join-step-2">
          <p class="text-secondary text-sm" style="margin-bottom:14px;line-height:1.55;">
            Show this QR to the host device. Connection activates automatically once they scan.
          </p>
          <div class="qr-box" id="answer-qr-box">
            <div class="loading-row"><div class="spinner"></div><span class="text-muted">Generating response…</span></div>
          </div>
        </div>
      </div>

    </div>
  `;

  _renderPeerList(container);
  _renderDiscovery(container);
  _renderSavedContacts(container);
  _initLanBroadcast();

  _wireHotspotGuide(container);
  _wireTransportToolkit(container);
  container.querySelector('#btn-host').addEventListener('click', () => _startHostFlow(container));
  container.querySelector('#btn-join').addEventListener('click', () => _startJoinFlow(container));
  container.querySelector('#btn-bt-scan').addEventListener('click', () => _scanNewBTDevice(container));

  _loadKnownBTDevices(container);

  window.addEventListener('meshdrop:peer-connected',    _onPeerChange);
  window.addEventListener('meshdrop:peer-disconnected', _onPeerChange);
  window.addEventListener('meshdrop:peer-alias',        _onAliasUpdate);
  window.addEventListener('meshdrop:bundles-updated',   _onBundlesRelayed);
}

export function cleanupConnectScreen() {
  stopVideoScanner();
  _stopTimeout();
  _releaseWakeLock();
  _teardownLanBroadcast();
  _handoffOverlay?.remove();
  _handoffOverlay = null;
  window.removeEventListener('meshdrop:peer-connected',    _onPeerChange);
  window.removeEventListener('meshdrop:peer-disconnected', _onPeerChange);
  window.removeEventListener('meshdrop:peer-alias',        _onAliasUpdate);
  window.removeEventListener('meshdrop:bundles-updated',   _onBundlesRelayed);
  _peerContainer = null;
}

export function updateConnectionBadge(count) {
  const dot  = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  if (!dot || !text) return;
  if (count === 0) {
    dot.className    = 'status-dot standalone';
    text.textContent = 'READY';
  } else {
    dot.className    = 'status-dot connected';
    text.textContent = `${count} NODE${count > 1 ? 'S' : ''}`;
  }
}

// ─── Hotspot Network Setup Guide ──────────────────────────────────

function _renderHotspotGuide() {
  return `
    <div class="hotspot-guide" id="hotspot-guide">
      <div class="hotspot-guide-header" id="hotspot-guide-header" role="button" tabindex="0"
           aria-expanded="false" aria-controls="hotspot-guide-body">
        <div class="hotspot-guide-title">
          ${icon('hotspot')} Network Setup — Required for Live Peer Link (no internet needed)
        </div>
        <span class="hotspot-guide-toggle" id="hotspot-guide-chevron">Show ▾</span>
      </div>
      <div class="hotspot-guide-body hidden" id="hotspot-guide-body">
        <div class="hotspot-guide-step">
          <div class="hotspot-step-num">1</div>
          <div>
            <strong style="color:var(--text);">One device creates a mobile hotspot</strong><br>
            Android: Settings → Connections → Mobile Hotspot &amp; Tethering → Mobile Hotspot<br>
            iPhone: Settings → Personal Hotspot → Allow Others to Join<br>
            <span style="color:var(--text-muted);font-size:0.75rem;">No internet plan needed — hotspot only needs to be on, data is never sent to the internet.</span>
          </div>
        </div>
        <div class="hotspot-guide-step">
          <div class="hotspot-step-num">2</div>
          <div>
            <strong style="color:var(--text);">All other devices join that hotspot WiFi</strong><br>
            Connect to the hotspot network in your device's WiFi settings. You do not need internet access — just the local network.
          </div>
        </div>
        <div class="hotspot-guide-step">
          <div class="hotspot-step-num">3</div>
          <div>
            <strong style="color:var(--text);">Open this same URL on all devices</strong><br>
            Use the <em>Copy Link</em> or <em>Show QR</em> buttons below to share this app's local URL. Then pair devices using the QR handshake below.
          </div>
        </div>
        <div class="hotspot-guide-note">
          ${icon('lock')} All communication stays on the local network — no data ever reaches the internet or any server. Even if the hotspot has no data plan, this works.
        </div>
      </div>
    </div>
  `;
}

function _wireHotspotGuide(container) {
  const header  = container.querySelector('#hotspot-guide-header');
  const body    = container.querySelector('#hotspot-guide-body');
  const chevron = container.querySelector('#hotspot-guide-chevron');
  if (!header || !body) return;

  const toggle = () => {
    const isOpen = !body.classList.contains('hidden');
    body.classList.toggle('hidden', isOpen);
    header.setAttribute('aria-expanded', String(!isOpen));
    if (chevron) chevron.textContent = isOpen ? 'Show ▾' : 'Hide ▴';
  };
  header.addEventListener('click', toggle);
  header.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  });
}

function _renderTransportToolkit() {
  const state = _getTransportState();
  const linkStatusClass = state.crossDeviceReady ? 'ready' : 'warn';
  const secureLabel = state.secure ? 'HTTPS Ready' : 'HTTPS Needed';
  const cameraLabel = state.cameraReady ? 'Camera Ready' : 'No Camera API';
  const bluetoothLabel = state.bluetoothReady ? 'Bluetooth Hints' : 'No Web Bluetooth';
  const hostHint = state.crossDeviceReady
    ? 'This origin can be opened on nearby devices on the same hotspot or LAN.'
    : _isLoopbackHost(state.hostname)
      ? 'Other devices cannot open localhost. Run `npm run dev:host` and open the LAN URL on both devices.'
      : 'Cross-device reachability depends on whether this host is visible on the local network.';

  return `
    <div class="transport-toolkit">
      <div class="transport-toolkit-head">
        <div>
          <div class="transport-toolkit-title">${icon('signal')} Local Transport Toolkit</div>
          <div class="transport-toolkit-sub">Make this device discoverable and hand the app off to the next phone fast.</div>
        </div>
        <span class="transport-link-status ${linkStatusClass}">${_esc(state.localOriginHint)}</span>
      </div>

      <div class="transport-chip-row">
        <span class="transport-chip ${state.secure ? 'ok' : 'warn'}">${icon('lock')} ${secureLabel}</span>
        <span class="transport-chip ${state.cameraReady ? 'ok' : 'warn'}">${icon('camera')} ${cameraLabel}</span>
        <span class="transport-chip ${state.bluetoothReady ? 'ok' : 'warn'}">${icon('bluetooth')} ${bluetoothLabel}</span>
        <span class="transport-chip ok">${icon('qr')} QR Relay</span>
      </div>

      <div class="transport-url-block">
        <div class="transport-url-label">Current access URL</div>
        <code class="transport-url-value">${_esc(state.accessUrl)}</code>
        <p class="transport-url-help">${hostHint}</p>
      </div>

      <div class="transport-action-row">
        <button class="btn btn-secondary btn-sm" id="copy-access-link">${icon('share')} Copy Link</button>
        <button class="btn btn-secondary btn-sm" id="share-access-link"${navigator.share ? '' : ' disabled'}>${icon('send')} Share Link</button>
        <button class="btn btn-primary btn-sm" id="show-access-qr">${icon('qr')} Show Link QR</button>
      </div>

      <div class="transport-checklist">
        <div class="transport-checklist-title">Fastest real-world flow</div>
        <ol>
          <li>Put both phones on the same hotspot or local Wi-Fi.</li>
          <li>Open this exact URL on both devices.</li>
          <li>Use QR pairing below, then relay messages live over the local link.</li>
        </ol>
      </div>
    </div>
  `;
}

function _wireTransportToolkit(container) {
  const copyBtn = container.querySelector('#copy-access-link');
  const shareBtn = container.querySelector('#share-access-link');
  const qrBtn = container.querySelector('#show-access-qr');
  const accessUrl = _getAccessUrl();

  copyBtn?.addEventListener('click', async () => {
    const original = copyBtn.innerHTML;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(accessUrl);
      } else {
        const tmp = document.createElement('textarea');
        tmp.value = accessUrl;
        document.body.appendChild(tmp);
        tmp.select();
        document.execCommand('copy');
        tmp.remove();
      }
      copyBtn.innerHTML = `${icon('check')} Copied`;
    } catch {
      copyBtn.innerHTML = 'Copy failed';
    }
    setTimeout(() => { copyBtn.innerHTML = original; }, 1800);
  });

  shareBtn?.addEventListener('click', async () => {
    if (!navigator.share) return;
    try {
      await navigator.share({
        title: 'TRINETRA Local Link',
        text: 'Open this local TRINETRA link, then pair by QR.',
        url: accessUrl,
      });
    } catch {}
  });

  qrBtn?.addEventListener('click', async () => {
    await _showAccessQr(accessUrl);
  });
}

// ─── Connected Peer List ──────────────────────────────────────────

function _onPeerChange() {
  if (_peerContainer) {
    _renderPeerList(_peerContainer);
    _renderDiscovery(_peerContainer);
  }
}

function _onAliasUpdate() {
  if (_peerContainer) _renderPeerList(_peerContainer);
}

function _onBundlesRelayed(e) {
  const count = e.detail?.count || 0;
  if (count > 0 && e.detail?.source === 'p2p-sync') {
    _relayedCount += count;
    if (e.detail?.maxHops && e.detail.maxHops > _maxHopsObserved) {
      _maxHopsObserved = e.detail.maxHops;
    }
    _updateMeshStats();
  }
}

function _updateMeshStats() {
  const nodesEl   = document.getElementById('mesh-stat-nodes');
  const relayedEl = document.getElementById('mesh-stat-relayed');
  const hopsEl    = document.getElementById('mesh-stat-hops');
  const open = getPeers().filter((p) => p.status === 'open');
  if (nodesEl)   nodesEl.textContent   = open.length + 1;
  if (relayedEl) relayedEl.textContent = _relayedCount;
  if (hopsEl)    hopsEl.textContent    = _maxHopsObserved;
}

function _buildMeshSVG(peers) {
  const W = 220, H = 130, cx = 110, cy = 65, R = 58;
  const n = Math.min(peers.length, 5);

  const angleStart = Math.PI * 0.78;
  const angleEnd   = Math.PI * 2.22;
  const step       = n <= 1 ? 0 : (angleEnd - angleStart) / (n - 1);

  const peerNodes = peers.slice(0, 5).map((p, i) => {
    const angle = n === 1 ? Math.PI * 1.5 : angleStart + step * i;
    const nx = cx + R * Math.cos(angle);
    const ny = cy + R * Math.sin(angle);
    const label = (p.alias || 'PEER').slice(0, 4).toUpperCase();
    return { nx, ny, label };
  });

  const lines = peerNodes.map(({ nx, ny }, i) => `
    <line class="mesh-line" x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="rgba(196,26,26,0.35)" stroke-width="1.2" stroke-dasharray="4 3"/>
    <circle class="mesh-pulse-dot" cx="${cx}" cy="${cy}" r="3" fill="#c41a1a" opacity="0.9">
      <animateMotion dur="${1.2 + i * 0.3}s" repeatCount="indefinite" begin="${i * 0.4}s">
        <mpath href="#mesh-path-${i}"/>
      </animateMotion>
    </circle>
    <path id="mesh-path-${i}" d="M${cx},${cy} L${nx},${ny}" fill="none"/>
  `).join('');

  const peerCircles = peerNodes.map(({ nx, ny, label }) => `
    <circle cx="${nx}" cy="${ny}" r="18" fill="rgba(30,30,35,0.95)" stroke="rgba(196,26,26,0.45)" stroke-width="1.4"/>
    <text x="${nx}" y="${ny + 1}" text-anchor="middle" dominant-baseline="middle"
      style="font-size:7px;font-family:Arial Narrow,Impact,sans-serif;font-weight:900;fill:#f0f0f0;letter-spacing:0.5px;">${label}</text>
    <text x="${nx}" y="${ny + 10}" text-anchor="middle" dominant-baseline="middle"
      style="font-size:5.5px;fill:rgba(255,255,255,0.4);font-family:Arial,sans-serif;">PEER</text>
  `).join('');

  return `
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="mesh-topology-svg" aria-label="Mesh network topology">
      ${lines}
      <!-- Center pulse rings -->
      <circle cx="${cx}" cy="${cy}" r="28" fill="none" stroke="rgba(196,26,26,0.12)" stroke-width="1">
        <animate attributeName="r" values="24;32;24" dur="2.4s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.6;0;0.6" dur="2.4s" repeatCount="indefinite"/>
      </circle>
      <circle cx="${cx}" cy="${cy}" r="20" fill="rgba(196,26,26,0.1)" stroke="rgba(196,26,26,0.35)" stroke-width="1.6"/>
      <circle cx="${cx}" cy="${cy}" r="12" fill="rgba(196,26,26,0.18)" stroke="#c41a1a" stroke-width="1.8"/>
      <text x="${cx}" y="${cy + 1}" text-anchor="middle" dominant-baseline="middle"
        style="font-size:6.5px;font-family:Arial Narrow,Impact,sans-serif;font-weight:900;fill:#ff4444;letter-spacing:0.8px;">YOU</text>
      ${peerCircles}
    </svg>
  `;
}

function _renderPeerList(container) {
  const section = container.querySelector('#peer-list-section');
  if (!section) return;

  const open = getPeers().filter((p) => p.status === 'open');
  if (open.length === 0) { section.innerHTML = ''; return; }

  section.innerHTML = `
    <div class="mesh-topology-card">
      <div class="mesh-topology-header">
        <div class="mesh-topology-title">
          <span class="mesh-live-dot"></span>
          MESH NETWORK ACTIVE
        </div>
        <span class="mesh-node-count">${open.length + 1} NODES</span>
      </div>
      <div class="mesh-topology-vis">
        ${_buildMeshSVG(open.map((p) => ({
          alias: p.alias || getContactAlias(p.peerId.replace(/-/g,'').slice(0, 8).toUpperCase()),
        })))}
      </div>
      <div class="mesh-stats-row">
        <div class="mesh-stat-item">
          <span class="mesh-stat-val" id="mesh-stat-nodes">${open.length + 1}</span>
          <span class="mesh-stat-label">NODES</span>
        </div>
        <div class="mesh-stat-divider"></div>
        <div class="mesh-stat-item">
          <span class="mesh-stat-val" id="mesh-stat-relayed">${_relayedCount}</span>
          <span class="mesh-stat-label">RELAYED</span>
        </div>
        <div class="mesh-stat-divider"></div>
        <div class="mesh-stat-item">
          <span class="mesh-stat-val" id="mesh-stat-hops">${_maxHopsObserved}</span>
          <span class="mesh-stat-label">MAX HOPS</span>
        </div>
      </div>
    </div>

    <div class="section-title" style="margin-top:14px;">Connected Peers (${open.length})</div>
    <div class="peer-list" style="padding:0 0 10px;">
      ${open.map((p) => {
        const shortId = p.peerId.replace(/-/g,'').slice(0, 8).toUpperCase();
        const alias   = p.alias || getContactAlias(shortId);
        return `
          <div class="peer-card">
            <div class="peer-card-info">
              <span class="status-dot connected"></span>
              <div>
                <div class="peer-card-alias">${_esc(alias)}</div>
                <div class="peer-card-id">${shortId}</div>
              </div>
              <span class="peer-status">Live</span>
            </div>
            <div class="peer-card-actions">
              <button class="btn btn-secondary btn-sm peer-disc-btn" data-id="${_esc(p.peerId)}" title="Remove connection">✕</button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
    <div class="divider"></div>
    <p class="text-muted text-sm text-center" style="margin-bottom:10px;font-size:0.8rem;">Add another device</p>
  `;

  section.querySelectorAll('.peer-disc-btn').forEach((btn) => {
    btn.addEventListener('click', () => _confirmDisconnect(container, btn.dataset.id));
  });
}

function _confirmDisconnect(container, peerId) {
  const shortId = peerId.replace(/-/g,'').slice(0, 8).toUpperCase();
  const peers   = getPeers();
  const peer    = peers.find((p) => p.peerId === peerId);
  const alias   = peer?.alias || getContactAlias(shortId);

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML = `
    <div style="background:var(--bg-elevated);border:1px solid var(--border-strong);border-radius:var(--radius);padding:24px;max-width:320px;width:100%;text-align:center;">
      <div style="display:flex;align-items:center;justify-content:center;margin-bottom:12px;color:var(--brand-light);">${icon('radar')}</div>
      <h3 style="font-size:1rem;font-weight:700;margin-bottom:8px;color:var(--text);">Remove Connection?</h3>
      <p style="font-size:0.87rem;color:var(--text-muted);margin-bottom:20px;line-height:1.55;">
        This will disconnect <strong style="color:var(--text);">${_esc(alias)}</strong> (${shortId}).<br>
        You can reconnect via QR at any time.
      </p>
      <div style="display:flex;gap:10px;">
        <button id="disc-cancel" class="btn btn-secondary" style="flex:1;">Cancel</button>
        <button id="disc-confirm" class="btn btn-danger" style="flex:1;">Remove</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#disc-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#disc-confirm').addEventListener('click', () => {
    overlay.remove();
    disconnectPeer(peerId);
    _renderPeerList(container);
  });
}

// ─── Session Contacts ─────────────────────────────────────────────

function _renderSavedContacts(container) {
  const section = container.querySelector('#saved-contacts-section');
  if (!section) return;

  const contacts = getAllContacts();
  if (contacts.length === 0) { section.innerHTML = ''; return; }

  const now = Date.now();
  const DAY = 86_400_000;

  section.innerHTML = `
    <div class="saved-contacts-block">
      <div class="saved-contacts-hdr">
        ${icon('connect')}
        <span>Session Contacts</span>
        <span class="saved-contacts-count">${contacts.length}</span>
      </div>
      ${contacts.slice(0, 8).map((c) => {
        const ago = now - c.lastSeen;
        const agoLabel = ago < 3600000 ? `${Math.floor(ago/60000)}m ago` :
                         ago < DAY     ? `${Math.floor(ago/3600000)}h ago` :
                                         `${Math.floor(ago/DAY)}d ago`;
        return `
          <div class="saved-contact-row">
            <div class="saved-contact-avatar">${_esc(c.shortId.slice(0,2))}</div>
            <div class="saved-contact-info">
              <div class="saved-contact-alias">${_esc(c.alias)}</div>
              <div class="saved-contact-meta">${c.shortId} · ${agoLabel}</div>
            </div>
            <div class="saved-contact-actions">
              <button class="contact-btn contact-repair-btn" data-shortid="${_esc(c.shortId)}" title="Re-pair via QR">
                ${icon('signal')} Re-pair
              </button>
              <button class="contact-btn contact-delete-btn" data-shortid="${_esc(c.shortId)}" data-alias="${_esc(c.alias)}" title="Remove contact">
                ${icon('trash')}
              </button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  section.querySelectorAll('.contact-repair-btn').forEach((btn) => {
    btn.addEventListener('click', () => _startHostFlow(container));
  });

  section.querySelectorAll('.contact-delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => _confirmDeleteContact(container, btn.dataset.shortid, btn.dataset.alias));
  });
}

function _confirmDeleteContact(container, shortId, alias) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-dialog">
      <div class="confirm-dialog-icon">${icon('trash')}</div>
      <h3 class="confirm-dialog-title">Remove Contact?</h3>
      <p class="confirm-dialog-body">
        This will delete <strong>${_esc(alias)}</strong> (${shortId}) from this session's contact list.
        You can re-pair via QR at any time.
      </p>
      <div class="confirm-dialog-btns">
        <button class="btn btn-secondary" id="del-cancel" style="flex:1;">Cancel</button>
        <button class="btn btn-danger" id="del-confirm" style="flex:1;">Remove</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#del-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#del-confirm').addEventListener('click', () => {
    removeContact(shortId);
    overlay.remove();
    _renderSavedContacts(container);
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

// ─── LAN Broadcast Discovery ──────────────────────────────────────

let _bcPruneInterval = null;

function _initLanBroadcast() {
  if (!window.BroadcastChannel) return;
  _bc = new BroadcastChannel(BC_CHANNEL);

  _bc.onmessage = (e) => {
    const { type, shortId, alias } = e.data || {};
    if (!shortId || shortId === getDeviceShortId()) return;

    if (type === BC_ANNOUNCE || type === BC_REPLY) {
      _lanPeers.set(shortId, { shortId, alias: alias || `Node ${shortId}`, ts: Date.now() });
      if (_peerContainer) _renderDiscovery(_peerContainer);
      if (type === BC_ANNOUNCE) {
        _bc.postMessage({ type: BC_REPLY, shortId: getDeviceShortId(), alias: getDisplayName() });
      }
    }
  };

  _bc.postMessage({ type: BC_ANNOUNCE, shortId: getDeviceShortId(), alias: getDisplayName() });

  _bcPruneInterval = setInterval(() => {
    const cutoff = Date.now() - 60_000;
    for (const [k, v] of _lanPeers) {
      if (v.ts < cutoff) _lanPeers.delete(k);
    }
    if (_peerContainer) _renderDiscovery(_peerContainer);
  }, 15_000);
}

function _teardownLanBroadcast() {
  if (_bc)              { _bc.close(); _bc = null; }
  if (_bcPruneInterval) { clearInterval(_bcPruneInterval); _bcPruneInterval = null; }
  _lanPeers.clear();
}

function _renderDiscovery(container) {
  const section = container.querySelector('#discovery-section');
  if (!section) return;

  const myId    = getDeviceShortId();
  const connIds = new Set(getPeers().filter((p) => p.status === 'open').map((p) =>
    p.peerId.replace(/-/g,'').slice(0, 8).toUpperCase()
  ));

  const available = [..._lanPeers.values()].filter((p) => p.shortId !== myId && !connIds.has(p.shortId));

  if (available.length === 0) { section.innerHTML = ''; return; }

  section.innerHTML = `
    <div class="discovery-section">
      <div class="discovery-header">
        <span class="discovery-title">📶 Same Device (other tabs)</span>
        <span class="text-muted text-xs">${available.length} found</span>
      </div>
      ${available.map((p) => `
        <div class="discovery-device-row">
          <div class="discovery-device-avatar">${p.shortId.slice(0,2)}</div>
          <div class="discovery-device-info">
            <div class="discovery-device-name">${_esc(p.alias)}</div>
            <div class="discovery-device-sub">${p.shortId} · this device</div>
          </div>
          <div class="discovery-device-actions">
            <button class="btn btn-secondary btn-sm" disabled>—</button>
          </div>
        </div>
      `).join('')}
      <div style="padding:10px 14px;font-size:0.75rem;color:var(--text-muted);line-height:1.5;">
        Cross-device: tap <strong style="color:var(--green);">Start Connection</strong> or <strong style="color:var(--green);">Join Connection</strong> to pair via QR.
      </div>
    </div>
  `;
}

// ─── Bluetooth Device List ────────────────────────────────────────

async function _loadKnownBTDevices(container) {
  const noSupp  = container.querySelector('#bt-no-support');
  const loading = container.querySelector('#bt-loading');

  if (!isBluetoothSupported()) {
    if (loading) loading.classList.add('hidden');
    if (noSupp)  noSupp.classList.remove('hidden');
    return;
  }

  try {
    const devices = await getKnownNearbyDevices();
    _renderBTList(container, devices);
  } catch {
    _renderBTList(container, []);
  }
  _bindBTListClicks(container);
}

function _bindBTListClicks(container) {
  const list = container.querySelector('#bt-device-list');
  if (!list) return;
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.bt-connectable');
    if (!row) return;
    // Start the QR host flow so the nearby BT device can scan it
    _startHostFlow(container);
  });
}

async function _scanNewBTDevice(container) {
  const btn = container.querySelector('#btn-bt-scan');
  if (btn) { btn.disabled = true; btn.textContent = 'Scanning…'; }

  try {
    if (!isBluetoothSupported()) {
      _showBTError(container, 'Web Bluetooth is not available. Use Chrome on Android or Chrome desktop.');
      return;
    }
    const available = await isBluetoothAvailable();
    if (!available) {
      _showBTError(container, 'Bluetooth is off. Enable Bluetooth and try again.');
      return;
    }

    const device = await pickNearbyDevice();
    if (device) {
      const devices = await getKnownNearbyDevices();
      _renderBTList(container, devices);
      _bindBTListClicks(container);
    }
  } catch (err) {
    if (err.name === 'NotFoundError' || (err.message && err.message.toLowerCase().includes('cancel'))) {
      const devices = await getKnownNearbyDevices();
      _renderBTList(container, devices);
      _bindBTListClicks(container);
    } else {
      _showBTError(container, err.message || 'Bluetooth scan failed.');
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '+ Scan New'; }
  }
}

function _renderBTList(container, devices) {
  const list    = container.querySelector('#bt-device-list');
  const loading = container.querySelector('#bt-loading');
  if (!list) return;
  if (loading) loading.classList.add('hidden');

  if (devices.length === 0) {
    list.innerHTML = `
      <div style="padding:12px 14px;font-size:0.83rem;color:var(--text-muted);background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);line-height:1.6;">
        No nearby Bluetooth hints yet.<br>
        Tap <strong style="color:var(--text-secondary);">+ Scan New</strong> to ask the browser for nearby devices.
      </div>`;
    return;
  }

  list.innerHTML = devices.map((d) => {
    const shortId = d.id ? d.id.slice(0, 8).toUpperCase() : '????????';
    const ago     = d.lastSeen ? _timeAgo(d.lastSeen) : '';
    return `
      <div class="bt-device-item bt-connectable" data-btid="${_esc(d.id || '')}" style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:6px;cursor:pointer;transition:background var(--t),border-color var(--t);">
        <div style="display:flex;align-items:center;justify-content:center;color:var(--blue);flex-shrink:0;">${icon('bluetooth')}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:0.9rem;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_esc(d.name)}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">${shortId}${ago ? ' · ' + ago : ''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;font-size:0.72rem;color:var(--green);font-weight:700;flex-shrink:0;">
          ${icon('qr')} Connect
        </div>
      </div>`;
  }).join('') + `
    <div style="padding:8px 14px;font-size:0.75rem;color:var(--text-muted);line-height:1.55;">
      Tap a device to begin QR pairing
    </div>`;
}

function _showBTError(container, msg) {
  const list = container.querySelector('#bt-device-list');
  if (!list) return;
  list.innerHTML = `<div style="padding:10px 14px;font-size:0.83rem;color:var(--red);background:rgba(255,45,85,0.08);border:1px solid rgba(255,45,85,0.25);border-radius:var(--radius-sm);">${_esc(msg)}</div>`;
}

// ─── Host Flow ────────────────────────────────────────────────────

async function _startHostFlow(container) {
  _show(container, '#host-wizard');
  _hide(container, '#mode-selector');
  await _acquireWakeLock();

  _startTimeout(container, '#host-step1-time', '#host-timeout-fill', () => {
    stopVideoScanner();
    _hide(container, '#host-wizard');
    _show(container, '#mode-selector');
    _releaseWakeLock();
  });

  const qrBox   = container.querySelector('#offer-qr-box');
  const nextBtn = container.querySelector('#host-next-btn');
  const peerId  = crypto.randomUUID?.() ?? Date.now().toString(36);

  container.querySelector('#host-back').addEventListener('click', () => {
    stopVideoScanner(); _stopTimeout(); _releaseWakeLock();
    _hide(container, '#host-wizard'); _show(container, '#mode-selector');
  }, { once: true });

  try {
    const offerJSON = await createHostOffer(peerId);
    const canvas    = await sdpToQR(offerJSON);
    qrBox.innerHTML = '';
    qrBox.appendChild(canvas);
    nextBtn.disabled = false;
  } catch (err) {
    qrBox.innerHTML = `<p class="text-danger text-sm text-center" style="padding:16px;">${_esc(err.message)}</p>`;
    return;
  }

  nextBtn.addEventListener('click', () => {
    _hide(container, '#host-step-1'); _show(container, '#host-step-2');
    _stopTimeout();

    const grantBtn  = container.querySelector('#host-grant-cam');
    const camPrompt = container.querySelector('#host-cam-prompt');
    const scanWrap  = container.querySelector('#host-scanner-wrap');
    const video     = container.querySelector('#host-video');

    grantBtn.addEventListener('click', async () => {
      if (!window.isSecureContext) {
        _showCamError(camPrompt, '⚠ Camera requires HTTPS. Open this app via https:// on mobile.');
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        _showCamError(camPrompt, '❌ Camera not supported. Use Chrome or Safari.');
        return;
      }
      grantBtn.disabled = true; grantBtn.textContent = 'Starting camera…';

      const { started, error } = await _startSDPScanner(video, async (sdpJSON) => {
        try {
          const { peerId: answerPeerId } = JSON.parse(sdpJSON);
          await acceptJoinerAnswer(sdpJSON);

          // Show "establishing link…" while waiting for DataChannel to open
          const step2El = container.querySelector('#host-step-2');
          if (step2El) {
            step2El.innerHTML = `
              <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;gap:16px;">
                <div class="spinner" style="width:28px;height:28px;border-width:3px;"></div>
                <div style="font-size:0.9rem;font-weight:700;color:var(--text-secondary);">Establishing secure link…</div>
                <div style="font-size:0.78rem;color:var(--text-muted);text-align:center;max-width:260px;line-height:1.55;">
                  Both devices must be on the same Wi-Fi or hotspot.<br>
                  <span style="color:rgba(255,255,255,0.35);">No internet needed — just the same local network.</span>
                </div>
              </div>
            `;
            step2El.classList.remove('hidden');
          }

          // Wait for the DataChannel to actually open (up to 30s — mobile hotspot ICE
          // negotiation can take time even after both SDPs are exchanged).
          const connectedPeerId = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              window.removeEventListener('meshdrop:peer-connected', handler);
              reject(new Error('Connection timed out. Make sure both devices are on the same hotspot or Wi-Fi network.'));
            }, 30_000);
            const handler = (e) => {
              const pid = e.detail?.peerId || '';
              // Accept any peer connection (we only have one pending)
              clearTimeout(timeout);
              window.removeEventListener('meshdrop:peer-connected', handler);
              resolve(pid);
            };
            window.addEventListener('meshdrop:peer-connected', handler);
          });

          const shortId = connectedPeerId.replace(/-/g,'').slice(0, 8).toUpperCase();
          const alias   = getContactAlias(shortId) || shortId;
          await _showDoneAnimation(container, '#host-wizard', alias);
        } catch (err) {
          console.error('[TRINETRA] Host answer error:', err.message);
          _releaseWakeLock();
          _hide(container, '#host-wizard');
          _show(container, '#mode-selector');
          // Show error toast
          window.dispatchEvent(new CustomEvent('meshdrop:show-toast', {
            detail: { message: `Connect failed: ${err.message}` },
          }));
        }
      });

      if (started) {
        camPrompt.classList.add('hidden');
        scanWrap.classList.remove('hidden');
      } else {
        grantBtn.disabled = false;
        grantBtn.textContent = 'Allow Camera';
        _showCamError(camPrompt, error || '❌ Camera permission denied. Check site settings.');
      }
    }, { once: true });
  }, { once: true });
}

// ─── Join Flow ────────────────────────────────────────────────────

async function _startJoinFlow(container) {
  _show(container, '#join-wizard');
  _hide(container, '#mode-selector');
  // Start on intent screen; camera NOT open yet
  _show(container, '#join-step-0');
  _hide(container, '#join-step-1');
  _hide(container, '#join-step-2');
  await _acquireWakeLock();

  container.querySelector('#join-back').addEventListener('click', () => {
    stopVideoScanner(); _releaseWakeLock();
    _hide(container, '#join-wizard'); _show(container, '#mode-selector');
  }, { once: true });

  // Step 0 → 1: user confirms they want to scan
  container.querySelector('#join-start-scan').addEventListener('click', () => {
    _hide(container, '#join-step-0');
    _show(container, '#join-step-1');
    // Mark step 1 active in stepper
    container.querySelector('#join-stp-1')?.classList.add('active');
    _startJoinScan(container);
  }, { once: true });
}

async function _startJoinScan(container) {
  const grantBtn  = container.querySelector('#join-grant-cam');
  const camPrompt = container.querySelector('#join-cam-prompt');
  const scanWrap  = container.querySelector('#join-scanner-wrap');
  const video     = container.querySelector('#join-video');
  const answerBox = container.querySelector('#answer-qr-box');

  grantBtn.addEventListener('click', async () => {
    if (!window.isSecureContext) {
      _showCamError(camPrompt, '⚠ Camera requires HTTPS. Open this app via https:// on mobile.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      _showCamError(camPrompt, '❌ Camera not supported. Use Chrome or Safari.');
      return;
    }
    grantBtn.disabled = true; grantBtn.textContent = 'Starting camera…';

    const { started, error } = await _startSDPScanner(video, async (offerJSON) => {
      // Flash step 1 as done, then reveal step 2
      const stp1 = container.querySelector('#join-stp-1');
      if (stp1) { stp1.classList.remove('active'); stp1.classList.add('done'); }
      await new Promise((r) => setTimeout(r, 380));

      _hide(container, '#join-step-1');
      _show(container, '#join-step-2');
      container.querySelector('#join-stp-2')?.classList.add('active');

      answerBox.innerHTML = `<div class="loading-row"><div class="spinner"></div><span class="text-muted">Generating response…</span></div>`;
      try {
        const answerJSON = await createJoinerAnswer(offerJSON);
        const canvas     = await sdpToQR(answerJSON);
        answerBox.innerHTML = '';
        answerBox.appendChild(canvas);

        const _onJoinerConnected = async (e) => {
          window.removeEventListener('meshdrop:peer-connected', _onJoinerConnected);
          const peerId  = e.detail?.peerId || '';
          const shortId = peerId.replace(/-/g,'').slice(0, 8).toUpperCase();
          const alias   = getContactAlias(shortId) || shortId;
          container.querySelector('#join-stp-2')?.classList.remove('active');
          container.querySelector('#join-stp-2')?.classList.add('done');
          await _showDoneAnimation(container, '#join-wizard', alias);
        };
        window.addEventListener('meshdrop:peer-connected', _onJoinerConnected);
      } catch (err) {
        answerBox.innerHTML = `<p class="text-danger text-sm text-center">${_esc(err.message)}</p>`;
        _releaseWakeLock();
      }
    });

    if (started) {
      camPrompt.classList.add('hidden');
      scanWrap.classList.remove('hidden');
    } else {
      grantBtn.disabled = false;
      grantBtn.textContent = 'Allow Camera & Scan';
      _showCamError(camPrompt, error || '❌ Camera permission denied. Check site settings.');
    }
  }, { once: true });
}

// ─── SDP Scanner ─────────────────────────────────────────────────

async function _startSDPScanner(videoEl, onResult) {
  stopVideoScanner();

  try {
    let _fired = false;

    await startVideoScanner(videoEl, (text) => {
      if (_fired) return;
      if (!text.startsWith(SDP_PREFIX)) return;

      let sdpJSON;
      try {
        sdpJSON = decodeSdpPayload(text);
      } catch (err) {
        console.warn('[TRINETRA] SDP decode error:', err.message);
        return;
      }

      _fired = true;
      stopVideoScanner();
      onResult(sdpJSON);
    });

    return { started: true };
  } catch (err) {
    return { started: false, error: _cameraErrorMsg(err) };
  }
}

function _cameraErrorMsg(err) {
  if (!err) return '❌ Unknown camera error.';
  if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
    return '❌ Camera access denied. Tap Allow when prompted, or enable Camera in site settings.';
  if (err.name === 'NotFoundError')
    return '❌ No camera found on this device.';
  if (err.name === 'NotReadableError')
    return '❌ Camera is in use by another app. Close it and try again.';
  return `❌ Camera error: ${err.message}`;
}

// ─── Pairing Timeout ──────────────────────────────────────────────

function _startTimeout(container, timeEl, fillEl, onExpire) {
  _stopTimeout();
  const start = Date.now();
  const fill  = container.querySelector(fillEl);
  const txt   = container.querySelector(timeEl);

  function tick() {
    const elapsed   = Date.now() - start;
    const remaining = Math.max(0, PAIRING_TIMEOUT - elapsed);
    const pct       = (remaining / PAIRING_TIMEOUT) * 100;
    if (fill) {
      fill.style.width = pct + '%';
      fill.classList.toggle('urgent', remaining < 20_000);
    }
    if (txt) txt.textContent = Math.ceil(remaining / 1000) + 's remaining';
    if (remaining <= 0) { onExpire(); return; }
    _pairingTimeout = setTimeout(tick, 1000);
  }
  tick();
}

function _stopTimeout() {
  if (_pairingTimeout) { clearTimeout(_pairingTimeout); _pairingTimeout = null; }
}

// ─── Wake Lock ────────────────────────────────────────────────────

async function _acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try { _wakeLock = await navigator.wakeLock.request('screen'); } catch {}
}
async function _releaseWakeLock() {
  if (_wakeLock) { try { await _wakeLock.release(); } catch {} _wakeLock = null; }
}

// ─── Done Animation ───────────────────────────────────────────────

async function _showDoneAnimation(container, wizardSel, peerAlias) {
  const wizard = container.querySelector(wizardSel);
  if (!wizard) return;

  wizard.innerHTML = `
    <div class="connect-done-wrap">
      <div class="connect-done-icon-ring">
        <div class="connect-done-ring"></div>
        <div class="connect-done-ring-2"></div>
        ${icon('check', 'Connected')}
      </div>
      <div class="connect-done-title">Connected</div>
      ${peerAlias ? `<div class="connect-done-peer">${_esc(peerAlias)}</div>` : ''}
      <div class="connect-done-badge">
        ${icon('signal')} Secure P2P Link Active
      </div>
    </div>
  `;

  await new Promise((r) => setTimeout(r, 2400));
  wizard.classList.add('hidden');
  _show(container, '#mode-selector');
  _renderPeerList(container);
  _renderSavedContacts(container);
  _releaseWakeLock();

  // Scroll to top so the peer list card is the first thing they see
  const appMain = document.getElementById('app-main');
  if (appMain) appMain.scrollTo({ top: 0, behavior: 'smooth' });
  const connectScreen = container.closest('.connect-screen') || container;
  connectScreen.scrollTo?.({ top: 0, behavior: 'smooth' });
}

async function _showAccessQr(accessUrl) {
  _handoffOverlay?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'transport-overlay';
  overlay.innerHTML = `
    <div class="transport-dialog">
      <div class="transport-dialog-head">
        <div>
          <div class="transport-dialog-title">Open On Another Device</div>
          <div class="transport-dialog-sub">Scan this QR to load the same local TRINETRA app URL.</div>
        </div>
        <button class="transport-dialog-close" aria-label="Close">${icon('close')}</button>
      </div>
      <div class="transport-dialog-qr">
        <div class="loading-row"><div class="spinner"></div><span class="text-muted">Generating QR…</span></div>
      </div>
      <code class="transport-dialog-url">${_esc(accessUrl)}</code>
      <p class="transport-dialog-help">
        Best on the same hotspot or LAN. After opening the app, use the pairing flow below to start live sync.
      </p>
    </div>
  `;

  document.body.appendChild(overlay);
  _handoffOverlay = overlay;

  const close = () => {
    overlay.remove();
    if (_handoffOverlay === overlay) _handoffOverlay = null;
  };

  overlay.querySelector('.transport-dialog-close')?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const qrMount = overlay.querySelector('.transport-dialog-qr');
  try {
    const canvas = document.createElement('canvas');
    await QRCode.toCanvas(canvas, accessUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320,
      color: { dark: '#000000', light: '#ffffff' },
    });
    qrMount.innerHTML = '';
    qrMount.appendChild(canvas);
  } catch (err) {
    qrMount.innerHTML = `<p class="text-danger text-sm text-center">${_esc(err.message || 'QR generation failed.')}</p>`;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

function _showCamError(promptEl, msg) {
  let err = promptEl.querySelector('.cam-error-msg');
  if (!err) {
    err = document.createElement('p');
    err.className = 'cam-error-msg';
    err.style.cssText = 'margin-top:10px;padding:10px 14px;border-radius:8px;background:rgba(255,45,85,0.12);color:#ff2d55;font-size:0.85rem;font-weight:600;line-height:1.5;text-align:center;';
    promptEl.appendChild(err);
  }
  err.textContent = msg;
}

function _timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)   return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function _show(container, sel) { container.querySelector(sel)?.classList.remove('hidden'); }
function _hide(container, sel) { container.querySelector(sel)?.classList.add('hidden'); }
function _esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

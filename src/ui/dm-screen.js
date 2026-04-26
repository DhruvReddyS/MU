/**
 * MeshDrop — Direct Messages
 * Uses the global dm-store so messages are never lost when the screen is unmounted.
 * Supports optional IDB persistence with configurable TTL (4h / 24h / 48h / 7d / session).
 */
import { getPeers, sendToPeer } from '../lib/webrtc.js';
import { getDeviceShortId, getContactAlias, getAllContacts } from '../lib/identity.js';
import {
  getThread, storeMessage, clearUnread, getUnread, getTotalUnread,
  getThreadMeta, setThreadMeta, persistMessage, loadPersistedThread,
  clearPersistedThread,
} from '../lib/dm-store.js';
import { encryptDM } from '../lib/crypto.js';
import { getPeerPublicKey } from '../lib/peer-keys.js';
import { icon } from './icons.js';
import { isVoiceSupported, startRecording, stopRecording } from '../lib/voice.js';

const _CRYPTO = !!(window?.crypto?.subtle);

const MSG_DM     = 'DM_SEND';
const MSG_TYPING = 'DM_TYPING';
const MSG_VOICE  = 'DM_VOICE';

const EXPIRY_OPTS = [
  { label: 'Session only (disappears on disconnect)', ms: 0 },
  { label: '4 hours',  ms:  14_400_000 },
  { label: '24 hours', ms:  86_400_000 },
  { label: '48 hours', ms: 172_800_000 },
  { label: '7 days',   ms: 604_800_000 },
];

let _dmContainer  = null;
let _activeThread = null; // shortId of open thread

// ─── Public API ──────────────────────────────────────────────────

export function renderDMScreen(container) {
  _dmContainer = container;

  container.innerHTML = `
    <div class="dm-screen animate-in">
      <div id="dm-content" style="flex:1;display:flex;flex-direction:column;overflow:hidden;"></div>
    </div>
  `;

  _renderPeerList(container);

  window.addEventListener('meshdrop:peer-connected',      _onPeerEvent);
  window.addEventListener('meshdrop:peer-disconnected',   _onPeerDisconnect);
  window.addEventListener('meshdrop:peer-alias',          _onAliasUpdate);
  window.addEventListener('meshdrop:dm-message-stored',   _onMessageStored);
}

export function cleanupDMScreen() {
  window.removeEventListener('meshdrop:peer-connected',      _onPeerEvent);
  window.removeEventListener('meshdrop:peer-disconnected',   _onPeerDisconnect);
  window.removeEventListener('meshdrop:peer-alias',          _onAliasUpdate);
  window.removeEventListener('meshdrop:dm-message-stored',   _onMessageStored);
  _dmContainer  = null;
  _activeThread = null;
}

// ─── Events ──────────────────────────────────────────────────────

function _onPeerEvent() {
  if (_dmContainer && !_activeThread) _renderPeerList(_dmContainer);
}

function _onAliasUpdate() {
  if (_dmContainer && !_activeThread) _renderPeerList(_dmContainer);
}

function _onPeerDisconnect(e) {
  const peerId  = e.detail?.peerId;
  const shortId = peerId?.replace(/-/g,'').slice(0, 8).toUpperCase();

  if (_activeThread === shortId) {
    _activeThread = null;
    if (_dmContainer) _renderPeerList(_dmContainer);
  } else if (_dmContainer && !_activeThread) {
    _renderPeerList(_dmContainer);
  }
}

function _onMessageStored(e) {
  const { shortId, entry } = e.detail || {};
  if (!shortId) return;

  if (_activeThread === shortId && _dmContainer) {
    // Append to open thread
    _appendMessage(_dmContainer, entry);
  } else if (_dmContainer && !_activeThread) {
    _renderPeerList(_dmContainer);
  }
}

// ─── Peer List ────────────────────────────────────────────────────

async function _renderPeerList(container) {
  const content = container.querySelector('#dm-content');
  if (!content) return;

  const open  = getPeers().filter((p) => p.status === 'open');
  const myId  = getDeviceShortId();

  // Build list of persisted (offline) threads — contacts with IDB messages
  const contacts = getAllContacts();
  const persistedEntries = [];
  for (const c of contacts) {
    const meta = await getThreadMeta(c.shortId).catch(() => null);
    if (!meta?.expiryMs || meta.expiryMs === 0) continue;
    // Only include if not already in the live list
    const isLive = open.some(
      (p) => p.peerId.replace(/-/g,'').slice(0, 8).toUpperCase() === c.shortId
    );
    if (isLive) continue;
    const msgs = await loadPersistedThread(c.shortId).catch(() => []);
    if (msgs.length > 0) persistedEntries.push({ shortId: c.shortId, alias: c.alias, msgs });
  }

  if (open.length === 0 && persistedEntries.length === 0) {
    content.innerHTML = `
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 24px;text-align:center;">
        <div style="font-size:2.5rem;margin-bottom:16px;opacity:0.35;">${icon('connect')}</div>
        <h3 style="font-size:1rem;font-weight:700;color:var(--text-secondary);margin-bottom:8px;">No connected devices</h3>
        <p style="font-size:0.85rem;color:var(--text-muted);max-width:240px;line-height:1.6;">
          Go to <strong style="color:var(--green);">Connect</strong> to pair with another device first.
        </p>
        <div style="margin-top:16px;padding:12px 16px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:0.8rem;color:var(--text-muted);line-height:1.6;max-width:260px;">
          ⚡ After pairing, messages flow directly device-to-device via WebRTC — no internet.
        </div>
      </div>
    `;
    return;
  }

  const livePeerRows = open.map((p) => {
    const shortId  = p.peerId.replace(/-/g,'').slice(0, 8).toUpperCase();
    const alias    = p.alias || getContactAlias(shortId);
    const thread   = getThread(shortId);
    const unread   = getUnread(shortId);
    const last     = thread.length > 0 ? thread[thread.length - 1] : null;
    const preview  = last ? (last.isSent ? 'You: ' : '') + last.text.slice(0, 35) : 'Tap to chat';
    return `
      <button class="dm-peer-btn" data-peerid="${_esc(p.peerId)}" data-shortid="${shortId}">
        <div class="dm-avatar" style="background:var(--bg-elevated);border:1.5px solid var(--green);">
          ${_esc(alias.slice(0, 2).toUpperCase())}
        </div>
        <div style="flex:1;min-width:0;text-align:left;">
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:0.92rem;font-weight:700;color:var(--text);">${_esc(alias)}</span>
            <span style="width:7px;height:7px;border-radius:50%;background:var(--green);flex-shrink:0;"></span>
            ${unread > 0 ? `<span class="dm-unread-badge">${unread}</span>` : ''}
          </div>
          <div style="font-size:0.75rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px;">
            ${_esc(preview)}
          </div>
        </div>
        <span style="color:var(--text-muted);display:flex;align-items:center;justify-content:center;flex-shrink:0;">${icon('back')}</span>
      </button>
    `;
  }).join('');

  const offlinePeerRows = persistedEntries.map(({ shortId, alias, msgs }) => {
    const last    = msgs[msgs.length - 1];
    const preview = last ? (last.isSent ? 'You: ' : '') + last.text.slice(0, 35) : '';
    return `
      <button class="dm-peer-btn dm-peer-offline" data-peerid="" data-shortid="${_esc(shortId)}">
        <div class="dm-avatar" style="background:var(--bg-elevated);border:1.5px solid var(--border-med);opacity:0.7;">
          ${_esc(alias.slice(0, 2).toUpperCase())}
        </div>
        <div style="flex:1;min-width:0;text-align:left;">
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:0.92rem;font-weight:700;color:var(--text-secondary);">${_esc(alias)}</span>
            <span style="font-size:0.65rem;color:var(--text-muted);font-weight:600;">offline</span>
          </div>
          <div style="font-size:0.75rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px;">
            ${_esc(preview)}
          </div>
        </div>
        <span style="color:var(--text-muted);display:flex;align-items:center;justify-content:center;flex-shrink:0;">${icon('back')}</span>
      </button>
    `;
  }).join('');

  content.innerHTML = `
    <div class="dm-peer-list">
      ${open.length > 0 ? `<div class="section-title" style="padding:14px 16px 8px;">Live — Connected</div>` : ''}
      ${livePeerRows}
      ${persistedEntries.length > 0 ? `<div class="section-title" style="padding:14px 16px 8px;">Saved Messages</div>` : ''}
      ${offlinePeerRows}
      <p style="font-size:0.75rem;color:var(--text-muted);text-align:center;margin-top:10px;padding:0 16px;">
        You are <strong style="color:var(--green);font-family:monospace;">${myId}</strong>
      </p>
    </div>
  `;

  content.querySelectorAll('.dm-peer-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const peerId  = btn.dataset.peerid;
      const shortId = btn.dataset.shortid;
      clearUnread(shortId);
      window.dispatchEvent(new CustomEvent('meshdrop:dm-unread', { detail: { count: getTotalUnread() } }));
      await _openThread(container, peerId || null, shortId);
    });
  });

  // Handle notification-tap deep-link into a thread
  const _onOpenReady = async (e) => {
    const { shortId } = e.detail || {};
    if (!shortId) return;
    const peer = open.find((p) => {
      const sid = p.peerId.replace(/-/g,'').slice(0, 8).toUpperCase();
      return sid === shortId;
    });
    clearUnread(shortId);
    await _openThread(container, peer?.peerId || null, shortId);
  };
  window.addEventListener('meshdrop:open-dm-thread-ready', _onOpenReady, { once: true });
}

// ─── Thread View ─────────────────────────────────────────────────

async function _openThread(container, peerId, shortId) {
  _activeThread = shortId;

  const content = container.querySelector('#dm-content');
  if (!content) return;

  const isOffline = !peerId || !getPeers().some((p) => p.peerId === peerId && p.status === 'open');
  const alias    = peerId ? _getPeerAlias(peerId) : (getContactAlias(shortId) || shortId);
  const meta     = await getThreadMeta(shortId);
  const expiryMs = meta?.expiryMs ?? 0;

  // Merge in-memory + persisted (deduplicated by ts+text)
  const memThread  = getThread(shortId);
  let   dbThread   = [];
  if (expiryMs > 0) {
    dbThread = await loadPersistedThread(shortId);
  }
  // Merge: db entries go first, then any in-memory entries not already there
  const dbTsSet = new Set(dbThread.map((m) => m.ts + m.text));
  const merged  = [
    ...dbThread,
    ...memThread.filter((m) => !dbTsSet.has(m.ts + m.text)),
  ].sort((a, b) => a.ts - b.ts);

  content.innerHTML = `
    <div class="dm-thread">
      <div class="dm-thread-header">
        <button class="btn-back" id="dm-back">${icon('back')}</button>
        <div style="flex:1;min-width:0;">
          <div style="font-size:0.95rem;font-weight:800;color:var(--text);">${_esc(alias)}</div>
          <div style="font-size:0.72rem;color:var(--text-muted);">${shortId}</div>
        </div>
        <button class="btn btn-secondary btn-sm" id="dm-expiry-btn" title="Message expiry" style="font-size:0.72rem;padding:0 10px;height:30px;">
          ⏱ ${expiryMs ? _formatExpiry(expiryMs) : 'Session'}
        </button>
      </div>

      <!-- Expiry panel (hidden by default) -->
      <div class="hidden" id="dm-expiry-panel" style="padding:12px 16px;background:var(--bg-elevated);border-bottom:1px solid var(--border);">
        <div style="font-size:0.78rem;font-weight:700;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.04em;">Message Storage</div>
        ${EXPIRY_OPTS.map((o, i) => `
          <label style="display:flex;align-items:center;gap:8px;padding:7px 0;cursor:pointer;border-bottom:1px solid var(--border);">
            <input type="radio" name="dm-expiry" value="${o.ms}" ${o.ms === expiryMs ? 'checked' : ''}
              style="accent-color:var(--green);" />
            <span style="font-size:0.85rem;color:var(--text);">${o.label}</span>
          </label>
        `).join('')}
        <button class="btn btn-primary btn-sm" id="dm-expiry-save" style="margin-top:10px;width:100%;">Apply</button>
      </div>

      <div class="dm-messages" id="dm-messages">
        ${merged.length === 0
          ? `<p style="text-align:center;color:var(--text-muted);font-size:0.85rem;padding:32px 20px;">No messages yet — say hello! 👋</p>`
          : merged.map(_renderBubble).join('')}
      </div>

      <div class="dm-compose">
        ${isOffline ? `
          <div style="padding:12px 14px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:0.82rem;color:var(--text-muted);text-align:center;">
            Peer is offline — reconnect to send messages
          </div>
        ` : `
        <div class="dm-voice-preview hidden" id="dm-voice-preview">
          <audio class="dm-voice-audio" id="dm-voice-player" controls preload="none"></audio>
          <div class="dm-voice-preview-btns">
            <button class="btn btn-danger btn-sm" id="dm-voice-discard">✕ Discard</button>
            <button class="btn btn-primary btn-sm" id="dm-voice-send-btn">${icon('send')} Send</button>
          </div>
        </div>
        <div class="dm-record-bar hidden" id="dm-record-bar">
          <span class="dm-rec-dot"></span>
          <span class="dm-rec-timer" id="dm-rec-timer">0:00</span>
          <button class="btn btn-danger btn-sm" id="dm-rec-stop">Stop</button>
        </div>
        <div class="dm-compose-row" id="dm-compose-row">
          <textarea class="dm-compose-input" id="dm-input"
                    placeholder="Message…" rows="1" maxlength="1000"></textarea>
          ${isVoiceSupported() ? `<button class="dm-mic-btn" id="dm-mic" title="Voice message">${icon('mic')}</button>` : ''}
          <button class="btn btn-primary dm-send-btn" id="dm-send">${icon('send')}</button>
        </div>
        `}
      </div>
    </div>
  `;

  const messagesEl = content.querySelector('#dm-messages');
  messagesEl.scrollTop = messagesEl.scrollHeight;

  // Back button
  content.querySelector('#dm-back').addEventListener('click', () => {
    _activeThread = null;
    _renderPeerList(container);
  });

  // Expiry toggle
  const expiryBtn   = content.querySelector('#dm-expiry-btn');
  const expiryPanel = content.querySelector('#dm-expiry-panel');
  expiryBtn.addEventListener('click', () => expiryPanel.classList.toggle('hidden'));

  content.querySelector('#dm-expiry-save').addEventListener('click', async () => {
    const chosen = parseInt(content.querySelector('input[name="dm-expiry"]:checked')?.value || '0', 10);
    await setThreadMeta(shortId, { expiryMs: chosen });
    expiryPanel.classList.add('hidden');
    expiryBtn.textContent = `⏱ ${chosen ? _formatExpiry(chosen) : 'Session'}`;
    if (chosen === 0) await clearPersistedThread(shortId);
  });

  // Wire send / typing / voice only when peer is online
  if (isOffline) return;

  // Send
  const input   = content.querySelector('#dm-input');
  const sendBtn = content.querySelector('#dm-send');

  async function sendMsg() {
    const text = input.value.trim();
    if (!text) return;

    const peer = getPeers().find((p) => p.peerId === peerId && p.status === 'open');
    if (!peer) { input.placeholder = 'Peer disconnected'; return; }

    const myId  = getDeviceShortId();
    const entry = { text, from: myId, ts: Date.now(), isSent: true, shortId };

    storeMessage(shortId, entry);

    // Encrypt if we have the recipient's public key
    let payload;
    const recipientPubKey = getPeerPublicKey(peerId);
    if (_CRYPTO && recipientPubKey) {
      try {
        const { ciphertext, iv } = await encryptDM(text, recipientPubKey);
        payload = { encrypted: true, ciphertext, iv, from: myId };
      } catch {
        payload = { text, from: myId };
      }
    } else {
      payload = { text, from: myId };
    }

    sendToPeer(peerId, { type: MSG_DM, payload });

    // Persist if expiry set
    const currentMeta = await getThreadMeta(shortId);
    if (currentMeta?.expiryMs > 0) {
      await persistMessage(shortId, { ...entry, expiresAt: Date.now() + currentMeta.expiryMs });
    }

    input.value = '';
    _appendMessage(container.querySelector('#dm-content'), entry);
  }

  // Typing indicator — broadcast to peer while user is typing
  let _typingTimer = null;
  let _typing      = false;

  function _sendTyping() {
    const peer = getPeers().find((p) => p.peerId === peerId && p.status === 'open');
    if (!peer) return;
    sendToPeer(peerId, { type: MSG_TYPING, payload: {} });
  }

  sendBtn.addEventListener('click', sendMsg);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    if (!_typing) { _typing = true; _sendTyping(); }
    clearTimeout(_typingTimer);
    _typingTimer = setTimeout(() => { _typing = false; }, 1500);
  });

  // Show/hide typing indicator from peer
  let _typingHideTimer = null;

  const _onTypingMsg = (e) => {
    const { peerId: fromPeerId, message } = e.detail || {};
    if (fromPeerId !== peerId || message?.type !== MSG_TYPING) return;
    _showTypingIndicator(content);
    clearTimeout(_typingHideTimer);
    _typingHideTimer = setTimeout(() => _hideTypingIndicator(content), 3000);
  };
  window.addEventListener('meshdrop:peer-message', _onTypingMsg);

  // Clean up when back is clicked
  content.querySelector('#dm-back').addEventListener('click', () => {
    window.removeEventListener('meshdrop:peer-message', _onTypingMsg);
    clearTimeout(_typingTimer);
    clearTimeout(_typingHideTimer);
    stopRecording();
    clearInterval(_recTimerInt);
  }, { once: true });

  // ── Voice recording ──────────────────────────────────────────────
  let _voiceData   = null;
  let _recTimerInt = null;

  function _stopVoiceUI() {
    content.querySelector('#dm-record-bar')?.classList.add('hidden');
    clearInterval(_recTimerInt);
    _recTimerInt = null;
  }

  function _clearVoicePreview() {
    _voiceData = null;
    const player = content.querySelector('#dm-voice-player');
    if (player) player.src = '';
    content.querySelector('#dm-voice-preview')?.classList.add('hidden');
    content.querySelector('#dm-compose-row')?.classList.remove('hidden');
  }

  const micBtn = content.querySelector('#dm-mic');
  if (micBtn) {
    micBtn.addEventListener('click', async () => {
      try {
        content.querySelector('#dm-record-bar')?.classList.remove('hidden');
        content.querySelector('#dm-compose-row')?.classList.add('hidden');
        let secs = 0;
        const timerEl = content.querySelector('#dm-rec-timer');
        if (timerEl) timerEl.textContent = '0:00';
        _recTimerInt = setInterval(() => {
          secs++;
          if (timerEl) timerEl.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
        }, 1000);
        await startRecording(
          (data) => {
            _stopVoiceUI();
            _voiceData = data;
            const player = content.querySelector('#dm-voice-player');
            if (player) player.src = data.base64;
            content.querySelector('#dm-voice-preview')?.classList.remove('hidden');
            content.querySelector('#dm-compose-row')?.classList.add('hidden');
          },
          () => {}
        );
      } catch {
        _stopVoiceUI();
        content.querySelector('#dm-compose-row')?.classList.remove('hidden');
        window.dispatchEvent(new CustomEvent('meshdrop:show-toast', {
          detail: { message: 'Microphone access denied.' },
        }));
      }
    });
  }

  content.querySelector('#dm-rec-stop')?.addEventListener('click', () => stopRecording());
  content.querySelector('#dm-voice-discard')?.addEventListener('click', _clearVoicePreview);

  content.querySelector('#dm-voice-send-btn')?.addEventListener('click', async () => {
    if (!_voiceData) return;
    const peer = getPeers().find((p) => p.peerId === peerId && p.status === 'open');
    if (!peer) {
      window.dispatchEvent(new CustomEvent('meshdrop:show-toast', { detail: { message: 'Peer disconnected.' } }));
      return;
    }
    const myId  = getDeviceShortId();
    const entry = { text: '🎤 Voice message', voice: _voiceData, from: myId, ts: Date.now(), isSent: true, shortId };
    storeMessage(shortId, entry);
    sendToPeer(peerId, { type: MSG_VOICE, payload: { voice: _voiceData, from: myId } });
    const currentMeta = await getThreadMeta(shortId);
    if (currentMeta?.expiryMs > 0) {
      await persistMessage(shortId, { ...entry, expiresAt: Date.now() + currentMeta.expiryMs });
    }
    _clearVoicePreview();
    _appendMessage(container.querySelector('#dm-content'), entry);
  });

  // Open thread from notification tap
  const _onOpenThread = (e) => {
    if (e.detail?.shortId === shortId) {
      // Already in this thread — nothing to do
      window.removeEventListener('meshdrop:open-dm-thread-ready', _onOpenThread);
    }
  };
  window.addEventListener('meshdrop:open-dm-thread-ready', _onOpenThread, { once: true });

  input.focus();
}

// ─── Helpers ─────────────────────────────────────────────────────

function _getPeerAlias(peerId) {
  const peer    = getPeers().find((p) => p.peerId === peerId);
  if (peer?.alias) return peer.alias;
  const shortId = peerId.replace(/-/g,'').slice(0, 8).toUpperCase();
  return getContactAlias(shortId);
}

function _appendMessage(content, entry) {
  const messagesEl = content?.querySelector('#dm-messages');
  if (!messagesEl) return;

  const emptyEl = messagesEl.querySelector('p');
  if (emptyEl) emptyEl.remove();

  // Hide typing indicator when real message arrives
  _hideTypingIndicator(content);

  const el = document.createElement('div');
  el.innerHTML = _renderBubble(entry);
  messagesEl.appendChild(el.firstElementChild);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function _showTypingIndicator(content) {
  const messagesEl = content?.querySelector('#dm-messages');
  if (!messagesEl) return;
  let el = messagesEl.querySelector('#typing-indicator');
  if (!el) {
    el = document.createElement('div');
    el.id = 'typing-indicator';
    el.className = 'typing-bubble-wrap';
    el.innerHTML = `
      <div class="typing-bubble">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    `;
    messagesEl.appendChild(el);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function _hideTypingIndicator(content) {
  content?.querySelector('#dm-messages')?.querySelector('#typing-indicator')?.remove();
}

function _renderBubble(entry) {
  const wrapCls = entry.isSent ? 'sent-wrap' : 'recv-wrap';
  const bubCls  = entry.isSent ? 'sent' : 'received';
  const time    = new Date(entry.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (entry.voice) {
    const dur = _fmtVoiceDuration(entry.voice.durationMs || 0);
    return `
      <div class="dm-bubble-wrap ${wrapCls}">
        <div class="dm-bubble ${bubCls} dm-voice-bubble">
          <audio controls preload="none" src="${_esc(entry.voice.base64)}" class="dm-voice-audio"></audio>
          <span class="dm-voice-dur">${_esc(dur)}</span>
        </div>
        <span class="dm-bubble-time">${time}</span>
      </div>
    `;
  }

  return `
    <div class="dm-bubble-wrap ${wrapCls}">
      <div class="dm-bubble ${bubCls}">${_esc(entry.text)}</div>
      <span class="dm-bubble-time">${time}</span>
    </div>
  `;
}

function _fmtVoiceDuration(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function _formatExpiry(ms) {
  if (ms >= 604_800_000) return '7d';
  if (ms >= 172_800_000) return '48h';
  if (ms >= 86_400_000)  return '24h';
  if (ms >= 14_400_000)  return '4h';
  return 'short';
}

function _esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

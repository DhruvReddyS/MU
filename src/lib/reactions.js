/**
 * TRINETRA — Message Reactions
 * Local-only reactions stored in localStorage.
 * Not synced to peers — purely personal annotation.
 */

const KEY = 'trinetra_reactions';

export const REACTIONS = [
  { id: 'confirm', emoji: '✓', label: 'Confirmed', color: '#00e676' },
  { id: 'warn',    emoji: '⚠', label: 'Unverified', color: '#f0a500' },
  { id: 'false',   emoji: '✗', label: 'False info',  color: '#e02424' },
];

function _load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}

function _save(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
}

export function getReaction(msgId) {
  return _load()[msgId] || null;
}

export function setReaction(msgId, reactionId) {
  const data = _load();
  if (reactionId === null) {
    delete data[msgId];
  } else {
    data[msgId] = reactionId;
  }
  _save(data);
}

export function toggleReaction(msgId, reactionId) {
  const current = getReaction(msgId);
  setReaction(msgId, current === reactionId ? null : reactionId);
  return getReaction(msgId);
}

export function clearAllReactions() {
  try { localStorage.removeItem(KEY); } catch {}
}

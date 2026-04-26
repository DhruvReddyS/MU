const DEVICE_ID_KEY    = 'meshdrop_device_id';
const DEVICE_ALIAS_KEY = 'meshdrop_alias';
const CONTACTS_KEY     = 'meshdrop_contacts';

let _deviceId = crypto.randomUUID?.()
  ?? `md-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
let _deviceAlias = '';

const _contacts = new Map();

_clearLegacyPersistentIdentity();

function _clearLegacyPersistentIdentity() {
  try {
    localStorage.removeItem(DEVICE_ID_KEY);
    localStorage.removeItem(DEVICE_ALIAS_KEY);
    localStorage.removeItem(CONTACTS_KEY);
  } catch {}
}

function getDeviceId() {
  return _deviceId;
}

function getDeviceShortId() {
  return _deviceId.replace(/-/g, '').slice(0, 8).toUpperCase();
}

function getDeviceAlias() {
  return _deviceAlias;
}

function setDeviceAlias(alias) {
  _deviceAlias = String(alias || '').trim().slice(0, 32);
}

function getDisplayName() {
  return _deviceAlias || `Node ${getDeviceShortId()}`;
}

function saveContact(shortId, alias) {
  if (!shortId) return;
  _contacts.set(shortId, {
    shortId,
    alias: alias || `Node ${shortId}`,
    lastSeen: Date.now(),
  });
}

function getContact(shortId) {
  return _contacts.get(shortId) || null;
}

function getContactAlias(shortId) {
  return _contacts.get(shortId)?.alias || `Node ${shortId}`;
}

function getAllContacts() {
  return [..._contacts.values()].sort((a, b) => b.lastSeen - a.lastSeen);
}

function removeContact(shortId) {
  _contacts.delete(shortId);
}

export {
  DEVICE_ALIAS_KEY,
  getDeviceId,
  getDeviceShortId,
  getDeviceAlias,
  setDeviceAlias,
  getDisplayName,
  saveContact,
  removeContact,
  getContact,
  getContactAlias,
  getAllContacts,
};

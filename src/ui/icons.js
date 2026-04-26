const ICONS = {
  /* ─── Navigation ────────────────────────────────────────────── */
  feed:       `<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>`,
  qr:         `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h2v2h-2zM18 14h3v3h-3zM14 18h3v3h-3z"/></svg>`,
  connect:    `<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 12h5M14.5 7.5 12 11M14.5 16.5 12 13"/></svg>`,
  mappin:     `<svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>`,
  dm:         `<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  settings:   `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,

  /* ─── Alert / Status ─────────────────────────────────────────── */
  alert:      `<svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  emergency:  `<svg viewBox="0 0 24 24"><path d="M12 2 L22 20 L2 20 Z"/><line x1="12" y1="9" x2="12" y2="14" stroke-width="2.5"/><circle cx="12" cy="17.5" r="1" fill="currentColor"/></svg>`,
  sos:        `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M8.5 8.5a5 5 0 0 0 0 7"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M5.5 5.5a9.5 9.5 0 0 0 0 13"/><path d="M18.5 5.5a9.5 9.5 0 0 1 0 13"/></svg>`,
  info:       `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="8"/><polyline points="11 12 12 12 12 16 13 16"/></svg>`,
  shield:     `<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  radar:      `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><path d="M12 12 L19.5 4.5"/></svg>`,

  /* ─── Actions ────────────────────────────────────────────────── */
  plus:       `<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  close:      `<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  back:       `<svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>`,
  check:      `<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>`,
  send:       `<svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
  share:      `<svg viewBox="0 0 24 24"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>`,
  wipe:       `<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
  broadcast:  `<svg viewBox="0 0 24 24"><circle cx="12" cy="19" r="2" fill="currentColor"/><path d="M8.5 15.5a5 5 0 0 1 7 0"/><path d="M5 12a10 10 0 0 1 14 0"/><path d="M1.5 8.5a15 15 0 0 1 21 0"/></svg>`,
  microphone: `<svg viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="17" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>`,
  trash:      `<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>`,

  /* ─── Device / Network ───────────────────────────────────────── */
  camera:     `<svg viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
  device:     `<svg viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>`,
  bluetooth:  `<svg viewBox="0 0 24 24"><polyline points="6.5 6.5 17.5 17.5 12 23 12 1 17.5 6.5 6.5 17.5"/></svg>`,
  wifi:       `<svg viewBox="0 0 24 24"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>`,
  signal:     `<svg viewBox="0 0 24 24"><rect x="2" y="18" width="3" height="4" rx="0.5"/><rect x="7" y="14" width="3" height="8" rx="0.5"/><rect x="12" y="10" width="3" height="12" rx="0.5"/><rect x="17" y="5" width="3" height="17" rx="0.5"/></svg>`,
  satellite:  `<svg viewBox="0 0 24 24"><path d="M4 15l5 5-1 3-7-7 3-1z"/><path d="M9.5 9.5l5 5"/><path d="M5 11l3-8 8 3"/><circle cx="15" cy="9" r="3"/><path d="M17.8 14.5a7 7 0 0 1-8.3-8.3"/><path d="M20 17a11 11 0 0 1-13-13"/></svg>`,

  /* ─── UI Utility ─────────────────────────────────────────────── */
  hop:        `<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`,
  clock:      `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  lock:       `<svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  flashlight: `<svg viewBox="0 0 24 24"><path d="M9 3h6l-1 5h3L11 21l1-8H8L9 3z"/></svg>`,
  shelter:    `<svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  resource:   `<svg viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
  route:      `<svg viewBox="0 0 24 24"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>`,
  medical:    `<svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
  pencil:     `<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,

  /* ─── Extended / New ─────────────────────────────────────────── */
  download:   `<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  print:      `<svg viewBox="0 0 24 24"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>`,
  hotspot:    `<svg viewBox="0 0 24 24"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/><path d="M12 4V2"/><path d="M8 3l1.5 2.5M16 3l-1.5 2.5"/></svg>`,
  draw:       `<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
  map:        `<svg viewBox="0 0 24 24"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>`,
  station:    `<svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><circle cx="12" cy="10" r="3"/><path d="M12 7V5M12 13v2M9 10H7M15 10h2"/></svg>`,
  waypoint:   `<svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="4"/><path d="M12 13v8"/><path d="M8 21h8"/><circle cx="12" cy="9" r="1.5" fill="currentColor"/></svg>`,
  undo:       `<svg viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.36"/></svg>`,

  /* ─── X-Factor Features ──────────────────────────────────────── */
  mic:        `<svg viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="17" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>`,
  'mic-off':  `<svg viewBox="0 0 24 24"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`,
  frequency:  `<svg viewBox="0 0 24 24"><path d="M2 12h3"/><path d="M5 12a7 7 0 0 1 14 0"/><path d="M19 12h3"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M2 12 C5 6, 8 18, 12 12 C16 6, 19 18, 22 12"/></svg>`,
  beacon:     `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M6.3 6.3a8 8 0 0 0 0 11.4"/><path d="M17.7 6.3a8 8 0 0 1 0 11.4"/><path d="M3.5 3.5a13 13 0 0 0 0 17"/><path d="M20.5 3.5a13 13 0 0 1 0 17"/></svg>`,
  blackout:   `<svg viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
  deadman:    `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2"/></svg>`,
  disguise:   `<svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="8" y1="4" x2="8" y2="20"/><line x1="2" y1="9" x2="22" y2="9"/><line x1="2" y1="15" x2="22" y2="15"/><line x1="15" y1="4" x2="15" y2="20"/></svg>`,
  eye:        `<svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
  'eye-off':  `<svg viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
  reaction:   `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="8" y1="15" x2="16" y2="15"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>`,
};

export function icon(name, label = '') {
  const svg = ICONS[name];
  if (!svg) return '';
  const normalized = svg.replace(
    '<svg ',
    '<svg fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" '
  );
  return `<span class="ui-icon ui-icon-${name}" ${label ? `aria-label="${label}" role="img"` : 'aria-hidden="true"'}>${normalized}</span>`;
}

export { ICONS };

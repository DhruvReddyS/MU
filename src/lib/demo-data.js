import { getMessages, saveMessage } from './db.js';
import { generateBundleId } from './crypto.js';

const NOW = Date.now();
const H   = 3_600_000;

// Demo city layout centered on a fictional district grid
// All coords are shifted from a real location for anonymity in the scenario
const C = { lat: 12.9716, lng: 77.5946 }; // centre

const DEMO_MESSAGES = [
  {
    type: 'emergency',
    priority: 95,
    title: 'Gas leak — North Quarter',
    body: 'Confirmed gas leak at Maple & 5th Ave. Evacuate within 3 blocks. Do NOT use lighters or switches.',
    lat: C.lat + 0.0044,
    lng: C.lng - 0.0006,
    createdAt: NOW - 12 * 60000,
    expiresAt: NOW + 1 * H,
    ttl: 80, hops: 2,
  },
  {
    type: 'alert',
    priority: 80,
    title: 'Checkpoint at East Bridge — avoid until 18:00',
    body: 'Active checkpoint at East Bridge. Use Canal Street via Bakery Alley instead. Guards checking IDs.',
    lat: C.lat - 0.0006,
    lng: C.lng + 0.0044,
    createdAt: NOW - 35 * 60000,
    expiresAt: NOW + 3 * H,
    ttl: 70, hops: 1,
  },
  {
    type: 'alert',
    priority: 72,
    title: 'Medical supply shortage at North Ave shelter',
    body: 'Running low on insulin and blood pressure meds. Anyone with surplus please bring to front desk.',
    lat: C.lat + 0.0014,
    lng: C.lng - 0.0026,
    createdAt: NOW - 2 * H,
    expiresAt: NOW + 6 * H,
    ttl: 60, hops: 3,
  },
  {
    // Safe route with waypoints: Bakery Alley → Canal St → West Gate
    type: 'safe-route',
    priority: 75,
    title: 'Safe passage: Bakery Alley → Canal Street → West Gate',
    body: 'Confirmed clear. Avoid Main Boulevard (checkpoint). Each waypoint is guard-friendly. Updated 40 min ago.',
    lat: C.lat - 0.0021,
    lng: C.lng - 0.0016,
    waypoints: [
      [C.lat - 0.0021, C.lng - 0.0016],  // Bakery Alley start
      [C.lat - 0.0018, C.lng - 0.0026],  // Canal Street junction
      [C.lat - 0.0010, C.lng - 0.0046],  // West Gate approach
      [C.lat - 0.0004, C.lng - 0.0066],  // West Gate checkpoint
    ],
    createdAt: NOW - 40 * 60000,
    expiresAt: NOW + 6 * H,
    ttl: 65, hops: 1,
  },
  {
    // Second safe route: Market Square → St Andrews Hall
    type: 'safe-route',
    priority: 68,
    title: 'Route: Market Square → St Andrews Hall (shelter)',
    body: 'Clear as of 2h ago. Stay left past the fountain. No checkpoint on this route.',
    lat: C.lat + 0.0004,
    lng: C.lng + 0.0004,
    waypoints: [
      [C.lat + 0.0004, C.lng + 0.0004],  // Market Square
      [C.lat + 0.0010, C.lng - 0.0008],  // Side alley
      [C.lat + 0.0014, C.lng - 0.0026],  // St Andrews Hall
    ],
    createdAt: NOW - 2 * H,
    expiresAt: NOW + 4 * H,
    ttl: 55, hops: 2,
  },
  {
    type: 'medical',
    priority: 78,
    title: 'Field clinic open — Community Centre basement',
    body: 'Doctor on site. Basic wound care, fever, dehydration. No appointment needed. Open 08:00–20:00.',
    lat: C.lat + 0.0008,
    lng: C.lng + 0.0018,
    createdAt: NOW - 1 * H,
    expiresAt: NOW + 12 * H,
    ttl: 60, hops: 0,
  },
  {
    type: 'shelter',
    priority: 70,
    title: 'St Andrews Hall — 40 spaces available',
    body: 'Families with children prioritised. Food provided twice daily. Blankets available. Bring ID if you have one.',
    lat: C.lat + 0.0014,
    lng: C.lng - 0.0026,
    createdAt: NOW - 4 * H,
    expiresAt: NOW + 24 * H,
    ttl: 55, hops: 0,
  },
  {
    type: 'resource',
    priority: 65,
    title: 'Water distribution — Market Square 09:00–12:00',
    body: 'Clean water confirmed. Bring your own container. Limit 5 litres per person per visit.',
    lat: C.lat + 0.0004,
    lng: C.lng + 0.0004,
    createdAt: NOW - 3 * H,
    expiresAt: NOW + 24 * H,
    ttl: 50, hops: 1,
  },
  {
    type: 'info',
    priority: 45,
    title: 'Ham radio station active — 14.300 MHz',
    body: 'Amateur radio at Market Square 10:00–16:00. Can relay messages regionally. Bring written message if you need relay.',
    lat: C.lat + 0.0004,
    lng: C.lng + 0.0004,
    createdAt: NOW - 6 * H,
    expiresAt: NOW + 24 * H,
    ttl: 45, hops: 1,
  },
];

async function seedDemoData(options = {}) {
  const { force = false } = options;
  const existing = await getMessages();

  if (!force && existing.length > 0) return 0;

  let saved = 0;
  for (let i = 0; i < DEMO_MESSAGES.length; i++) {
    const msg = DEMO_MESSAGES[i];
    const id  = await generateBundleId(msg.title + msg.body, msg.createdAt, `demo-${i}`);
    try {
      const result = await saveMessage({
        id,
        seenCount: 1,
        rootId: id,
        revision: 1,
        replaces: null,
        fragments: [],
        fragmentCount: 0,
        ...msg,
      }, { mode: 'origin' });
      if (result.status === 'created' || result.status === 'updated') saved++;
    } catch (err) {
      console.warn('[TRINETRA] Demo seed error:', err.message);
    }
  }

  return saved;
}

export { seedDemoData };

/**
 * MeshDrop — Internationalization (i18n)
 * Lightweight multilingual support — no external packages.
 */

const translations = {
  en: {
    // App
    appName: 'TRINETRA',
    appTagline: 'Tactical Offline Mesh Communication',
    loading: 'Initializing TRINETRA...',
    standalone: 'Ready',
    connected: 'Connected',
    qrOnly: 'QR Only',

    // Nav
    navFeed: 'Feed',
    navQR: 'QR Drop',
    navP2P: 'P2P',
    navDM: 'Messages',
    navSettings: 'Settings',

    // Feed
    feedTitle: 'Community Feed',
    feedEmpty: 'No posts yet. Be the first to share information.',
    feedNewPost: 'New Post',
    feedCompose: 'What\'s happening in your area?',
    feedRegion: 'Region (optional)',
    feedPost: 'Post',
    feedCancel: 'Cancel',
    feedFilter: 'Filter by region',
    feedAllRegions: 'All regions',
    feedHopsAgo: 'hops',
    feedExpires: 'Expires',
    feedSearch: 'Search posts...',

    // Alerts
    alertTitle: 'Emergency Alerts',
    alertActive: 'ACTIVE ALERT',
    alertResolved: 'Resolved',
    alertNew: 'New Alert',
    alertAllClear: 'All Clear',
    alertContent: 'Describe the emergency...',
    alertBanner: '⚠️ Active emergency alert',

    // Routes
    routeTitle: 'Safe Routes',
    routeNew: 'New Route',
    routeDescription: 'Route description...',
    routeWaypoints: 'Waypoints (comma-separated)',
    routeSteps: 'Steps',

    // QR
    qrTitle: 'QR Drop',
    qrShare: 'Share',
    qrScan: 'Scan',
    qrGenerate: 'Generate QR',
    qrHintShare: 'Generate a QR code to share your bundles with nearby devices.',
    qrHintScan: 'Point your camera at a TRINETRA QR code to receive data.',
    qrSelectType: 'All types',
    qrPlaceholder: 'Tap generate to create a QR code',
    qrTooLarge: 'Payload too large',
    qrStartScan: 'Start Scanner',
    qrStopScan: 'Stop Scanner',
    qrReceived: 'Received {count} new bundle(s)',
    qrAlreadyHave: 'Already have all bundles',
    qrChunk: 'QR {current} of {total}',
    qrScanAll: 'Scan all {total} QR codes',
    qrBundles: '{count} bundle(s)',
    qrTTL: '{hours}h remaining',

    // P2P
    p2pTitle: 'Peer-to-Peer',
    p2pHost: 'Host',
    p2pJoin: 'Join',
    p2pHostDesc: 'Create a connection and show your QR code for others to join.',
    p2pJoinDesc: 'Scan the host\'s QR code to connect.',
    p2pConnecting: 'Connecting...',
    p2pConnected: 'Connected! Syncing data...',
    p2pDisconnected: 'Disconnected',
    p2pSyncing: 'Syncing bundles...',
    p2pSynced: 'Sync complete — {count} new bundle(s)',
    p2pWaiting: 'Waiting for peer...',
    p2pShowOffer: 'Show this QR to peer',
    p2pScanAnswer: 'Now scan peer\'s response QR',
    p2pScanOffer: 'Scan host\'s QR code',
    p2pShowAnswer: 'Show this response QR to host',

    // DM
    dmTitle: 'Direct Messages',
    dmEmpty: 'No messages yet. Exchange keys with a peer to start.',
    dmNewKey: 'Generate Key',
    dmShowKey: 'Show My Key',
    dmScanKey: 'Scan Key',
    dmCompose: 'Write a message...',
    dmSend: 'Send',
    dmEncrypted: '🔒 Encrypted message — not for this device',
    dmDecrypted: 'Decrypted',
    dmKeyGenerated: 'Key pair generated',
    dmKeyCopied: 'Key displayed as QR',

    // Settings
    settingsTitle: 'Settings',
    settingsLanguage: 'Language',
    settingsTheme: 'Theme',
    settingsThemeAuto: 'Auto',
    settingsThemeDark: 'Dark',
    settingsThemeLight: 'Light',
    settingsDemoData: 'Load Demo Data',
    settingsDemoLoaded: 'Demo data loaded ({count} bundles)',
    settingsWipe: 'Emergency Wipe',
    settingsWipeConfirm: 'This will delete ALL data. Are you sure?',
    settingsWipeComplete: 'All data wiped',
    settingsStats: 'Statistics',
    settingsAbout: 'About TRINETRA',
    settingsVersion: 'Version',
    settingsBundles: 'Total Bundles',
    settingsExport: 'Export Data',
    settingsImport: 'Import Data',

    // Common
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    close: 'Close',
    back: 'Back',
    next: 'Next',
    done: 'Done',
    error: 'Error',
    success: 'Success',
    confirm: 'Confirm',
    noData: 'No data',
    ago: 'ago',
    now: 'Just now',
    minutes: 'min',
    hours: 'hr',
    days: 'd',
  },

  es: {
    appName: 'TRINETRA',
    appTagline: 'Comunicación Mesh Sin Conexión',
    loading: 'Cargando...',
    standalone: 'Independiente',
    connected: 'Conectado',
    qrOnly: 'Solo QR',
    navFeed: 'Inicio',
    navQR: 'QR',
    navP2P: 'P2P',
    navDM: 'Mensajes',
    navSettings: 'Ajustes',
    feedTitle: 'Feed Comunitario',
    feedEmpty: 'Sin publicaciones aún. Sé el primero en compartir.',
    feedNewPost: 'Nueva Publicación',
    feedCompose: '¿Qué pasa en tu zona?',
    feedPost: 'Publicar',
    feedCancel: 'Cancelar',
    feedSearch: 'Buscar...',
    alertTitle: 'Alertas de Emergencia',
    alertActive: 'ALERTA ACTIVA',
    alertNew: 'Nueva Alerta',
    alertAllClear: 'Todo Despejado',
    qrTitle: 'QR Drop',
    qrShare: 'Compartir',
    qrScan: 'Escanear',
    qrGenerate: 'Generar QR',
    p2pTitle: 'Peer-to-Peer',
    p2pHost: 'Anfitrión',
    p2pJoin: 'Unirse',
    dmTitle: 'Mensajes Directos',
    settingsTitle: 'Ajustes',
    settingsLanguage: 'Idioma',
    save: 'Guardar',
    cancel: 'Cancelar',
    close: 'Cerrar',
  },

  hi: {
    appName: 'TRINETRA',
    appTagline: 'ऑफलाइन मेश संचार',
    loading: 'लोड हो रहा है...',
    standalone: 'स्वतंत्र',
    connected: 'जुड़ा हुआ',
    navFeed: 'फ़ीड',
    navQR: 'QR',
    navP2P: 'P2P',
    navDM: 'संदेश',
    navSettings: 'सेटिंग्स',
    feedTitle: 'सामुदायिक फ़ीड',
    feedEmpty: 'अभी तक कोई पोस्ट नहीं।',
    feedNewPost: 'नई पोस्ट',
    feedPost: 'पोस्ट करें',
    alertTitle: 'आपातकालीन अलर्ट',
    alertNew: 'नया अलर्ट',
    qrTitle: 'QR ड्रॉप',
    qrGenerate: 'QR बनाएं',
    dmTitle: 'सीधे संदेश',
    settingsTitle: 'सेटिंग्स',
    settingsLanguage: 'भाषा',
    save: 'सहेजें',
    cancel: 'रद्द करें',
    close: 'बंद करें',
  },

  ar: {
    appName: 'TRINETRA',
    appTagline: 'اتصال شبكي بدون إنترنت',
    loading: '...جاري التحميل',
    standalone: 'مستقل',
    connected: 'متصل',
    navFeed: 'الأخبار',
    navQR: 'QR',
    navP2P: 'P2P',
    navDM: 'الرسائل',
    navSettings: 'الإعدادات',
    feedTitle: 'أخبار المجتمع',
    feedEmpty: 'لا توجد منشورات بعد.',
    feedNewPost: 'منشور جديد',
    alertTitle: 'تنبيهات الطوارئ',
    qrTitle: 'QR Drop',
    dmTitle: 'الرسائل المباشرة',
    settingsTitle: 'الإعدادات',
    settingsLanguage: 'اللغة',
    save: 'حفظ',
    cancel: 'إلغاء',
    close: 'إغلاق',
  },
};

const LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'hi', name: 'हिन्दी', flag: '🇮🇳' },
  { code: 'ar', name: 'العربية', flag: '🇸🇦', rtl: true },
];

let currentLang = localStorage.getItem('meshdrop-lang') || 'en';

/**
 * Get a translated string by key.
 * Falls back to English if key not found in current language.
 * Supports template vars: t('qrReceived', { count: 3 })
 */
function t(key, vars = {}) {
  let text = translations[currentLang]?.[key]
    || translations.en[key]
    || key;

  // Replace template variables {varName}
  for (const [k, v] of Object.entries(vars)) {
    text = text.replace(`{${k}}`, v);
  }
  return text;
}

/**
 * Set the current language and persist to localStorage.
 */
function setLanguage(langCode) {
  if (translations[langCode]) {
    currentLang = langCode;
    localStorage.setItem('meshdrop-lang', langCode);

    // Set RTL direction if needed
    const langInfo = LANGUAGES.find(l => l.code === langCode);
    document.documentElement.dir = langInfo?.rtl ? 'rtl' : 'ltr';

    // Emit event for UI refresh
    window.dispatchEvent(new CustomEvent('meshdrop:language-changed', { detail: { lang: langCode } }));
  }
}

function getLanguage() {
  return currentLang;
}

export { t, setLanguage, getLanguage, LANGUAGES };

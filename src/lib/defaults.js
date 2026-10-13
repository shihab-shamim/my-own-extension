// Default settings and seed data. Everything here is plain data so it can be
// shared by the service worker and the New Tab page.

export const SETTINGS_VERSION = 1;

export const ROTATION_INTERVALS = [
  { id: 'off', label: 'Disabled', ms: 0 },
  { id: '1m', label: 'Every minute', ms: 60_000 },
  { id: '5m', label: 'Every 5 minutes', ms: 5 * 60_000 },
  { id: '15m', label: 'Every 15 minutes', ms: 15 * 60_000 },
  { id: '30m', label: 'Every 30 minutes', ms: 30 * 60_000 },
  { id: '1h', label: 'Every hour', ms: 60 * 60_000 },
  { id: '1d', label: 'Daily', ms: 24 * 60 * 60_000 },
];

export const WALLPAPER_SOURCES = [
  { id: 'unsplash', label: 'Unsplash' },
  { id: 'uploads', label: 'My Photos' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'preset', label: 'Built-in' },
  { id: 'gradient', label: 'Gradient' },
  { id: 'color', label: 'Solid Color' },
];

export const UNSPLASH_CATEGORIES = [
  'nature', 'architecture', 'mountains', 'ocean', 'cities', 'abstract',
  'minimal', 'forest', 'desert', 'snow', 'space', 'wildlife',
];

export const SEARCH_ENGINES = [
  { id: 'default', label: 'Chrome default', url: null },
  { id: 'google', label: 'Google', url: 'https://www.google.com/search?q=%s' },
  { id: 'bing', label: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  { id: 'duckduckgo', label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  { id: 'brave', label: 'Brave Search', url: 'https://search.brave.com/search?q=%s' },
  { id: 'ecosia', label: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s' },
  { id: 'custom', label: 'Custom…', url: null },
];

export const STACK_WIDGETS = [
  { id: 'clock', label: 'Clock & date' },
  { id: 'search', label: 'Search bar' },
  { id: 'shortcuts', label: 'Shortcuts' },
];

export const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,
  wallpaper: {
    source: 'preset',
    interval: 'off',
    paused: false,
    categories: ['nature', 'mountains'],
    customQuery: '',
    presetId: 'sequoia',
    gradient: { from: '#4f6df5', to: '#c06bd8', angle: 135 },
    color: '#1f2933',
    uploadsDefaultId: null,
    overlay: 18,
    blur: 0,
  },
  appearance: {
    theme: 'auto', // auto | light | dark
    textTone: 'auto', // auto | light | dark  (text over the wallpaper)
    transparency: 60, // 0 (solid) - 100 (fully see-through)
    radius: 16,
    animation: 'full', // full | subtle | none
    reducedMotion: 'system', // system | always
  },
  widgets: {
    order: ['clock', 'search', 'shortcuts'],
    visible: {
      clock: true,
      search: true,
      shortcuts: true,
      bookmarks: true,
      dock: true,
      attribution: true,
    },
    align: 'center', // center | top
  },
  clock: {
    format: '12', // 12 | 24
    showSeconds: false,
    dateFormat: 'long', // long | short | numeric | iso | none
  },
  search: {
    engine: 'default',
    customUrl: '',
    autofocus: true,
  },
  shortcuts: {
    size: 'medium', // small | medium | large
    columns: 'auto', // auto | 3..12
    showLabels: true,
  },
  dock: {
    position: 'bottom', // bottom | left | right
    magnify: true,
    autohide: false,
    iconSize: 48,
  },
  bookmarks: {
    showOther: true,
  },
};

let idCounter = 0;
export function uid(prefix = 'id') {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

// The ten shortcuts from the user's existing Chrome New Tab page.
export const DEFAULT_SHORTCUTS = [
  { title: 'All Plugings', url: 'https://profiles.wordpress.org/bplugins/#content-plugins' },
  { title: 'My plugin', url: 'https://profiles.wordpress.org/shihabshamim/#content-plugins' },
  { title: 'Gmail', url: 'https://mail.google.com/mail/u/0/#inbox' },
  { title: 'bplugins mail', url: 'https://gcam1012.siteground.biz/webmail/mail/' },
  { title: 'Present sheet', url: 'https://bplugins.pihr.xyz/selfservice/mydashboard' },
  { title: 'Freemius', url: 'https://dashboard.freemius.com/#!/live/stores/2229/products/' },
  { title: 'ClickUp', url: 'https://app.clickup.com/90181405997/v/li/901810231124' },
  { title: 'Support Desk', url: 'https://tickets.bplugins.com/inbox' },
  { title: 'Daily Workshit', url: 'https://docs.google.com/document/d/1JPL_HgQtZRAyX-yL8xDvekhUHeUQr4fYGHd_U_wwF-w/edit?tab=t.21ok41kn5in9' },
  { title: 'mail swarm', url: 'https://mailswarm.vercel.app/' },
];

// Built-in Chrome pages that make sense in a dock. `glyph` refers to an icon in icons.js.
export const CHROME_APPS = [
  { title: 'History', url: 'chrome://history', glyph: 'history' },
  { title: 'Downloads', url: 'chrome://downloads', glyph: 'downloads' },
  { title: 'Bookmarks', url: 'chrome://bookmarks', glyph: 'bookmarks' },
  { title: 'Extensions', url: 'chrome://extensions', glyph: 'extensions' },
  { title: 'Chrome Settings', url: 'chrome://settings', glyph: 'settings' },
  { title: 'Passwords', url: 'chrome://password-manager', glyph: 'passwords' },
];

export const DEFAULT_DOCK = CHROME_APPS.slice(0, 5);

export function seedShortcuts() {
  return DEFAULT_SHORTCUTS.map((s) => ({ id: uid('sc'), ...s }));
}

export function seedDock() {
  return DEFAULT_DOCK.map((s) => ({ id: uid('dk'), ...s }));
}

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

// Merge stored settings over defaults so new keys added in later versions
// always have a value, and unknown/invalid types fall back to the default.
export function mergeSettings(stored) {
  const base = deepClone(DEFAULT_SETTINGS);
  if (!stored || typeof stored !== 'object') return base;
  const merge = (target, src) => {
    for (const key of Object.keys(target)) {
      if (!(key in src)) continue;
      const t = target[key];
      const s = src[key];
      if (t && typeof t === 'object' && !Array.isArray(t)) {
        if (s && typeof s === 'object' && !Array.isArray(s)) merge(t, s);
      } else if (Array.isArray(t)) {
        if (Array.isArray(s)) target[key] = s.slice();
      } else if (t === null || typeof t === typeof s) {
        target[key] = s;
      }
    }
  };
  merge(base, stored);
  // Keep the widget order valid even if a stored order is stale.
  const known = STACK_WIDGETS.map((w) => w.id);
  const order = base.widgets.order.filter((id, i, arr) => known.includes(id) && arr.indexOf(id) === i);
  for (const id of known) if (!order.includes(id)) order.push(id);
  base.widgets.order = order;
  base.version = SETTINGS_VERSION;
  return base;
}

export function intervalMs(id) {
  return ROTATION_INTERVALS.find((r) => r.id === id)?.ms ?? 0;
}

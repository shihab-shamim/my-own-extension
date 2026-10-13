// Page-side state cache. Keeps every open New Tab in sync through
// chrome.storage.onChanged, and ignores the echo of its own writes.

import { KEYS, ensureSeeded, getSettings, getShortcuts, getDock, getFavorites, getWallpaperState, set } from '../lib/storage.js';
import { mergeSettings } from '../lib/defaults.js';

export const store = {
  settings: null,
  shortcuts: [],
  dock: [],
  favorites: [],
  wallpaper: null,
};

const listeners = new Map(); // topic -> Set<fn>
const lastWritten = new Map(); // storage key -> JSON strings written, oldest first

export function on(topic, fn) {
  if (!listeners.has(topic)) listeners.set(topic, new Set());
  listeners.get(topic).add(fn);
  return () => listeners.get(topic).delete(fn);
}

export function emit(topic) {
  for (const fn of listeners.get(topic) || []) {
    try {
      fn(store);
    } catch (err) {
      console.error('[Sequoia Tab] listener failed', topic, err);
    }
  }
}

export async function load() {
  await ensureSeeded();
  const [settings, shortcuts, dock, favorites, wallpaper] = await Promise.all([
    getSettings(),
    getShortcuts(),
    getDock(),
    getFavorites(),
    getWallpaperState(),
  ]);
  Object.assign(store, { settings, shortcuts, dock, favorites, wallpaper });
  chrome.storage.onChanged.addListener(onStorageChanged);
  return store;
}

function write(key, value) {
  const json = JSON.stringify(value);
  const pending = lastWritten.get(key) || [];
  pending.push(json);
  if (pending.length > 20) pending.shift();
  lastWritten.set(key, pending);
  return set({ [key]: value }).catch((err) => {
    console.error('[Sequoia Tab] save failed', key, err);
    throw err;
  });
}

let settingsTimer = null;
export function updateSettings(mutate, { immediate = false } = {}) {
  mutate(store.settings);
  emit('settings');
  clearTimeout(settingsTimer);
  settingsTimer = null;
  if (immediate) return write(KEYS.settings, store.settings);
  settingsTimer = setTimeout(() => {
    settingsTimer = null;
    write(KEYS.settings, store.settings);
  }, 200);
  return Promise.resolve();
}

export function flushSettings() {
  if (settingsTimer) {
    clearTimeout(settingsTimer);
    settingsTimer = null;
    return write(KEYS.settings, store.settings);
  }
  return Promise.resolve();
}

export function replaceSettings(next) {
  store.settings = mergeSettings(next);
  emit('settings');
  clearTimeout(settingsTimer);
  settingsTimer = null;
  return write(KEYS.settings, store.settings);
}

export function saveShortcuts(list) {
  store.shortcuts = list;
  emit('shortcuts');
  return write(KEYS.shortcuts, list);
}

export function saveDock(list) {
  store.dock = list;
  emit('dock');
  return write(KEYS.dock, list);
}

export function saveFavorites(list) {
  store.favorites = list;
  emit('favorites');
  return write(KEYS.favorites, list);
}

function onStorageChanged(changes, area) {
  if (area !== 'local') return;
  // Our own writes come back in order; drop them (and any older ones queued
  // before them) so a stale echo never overwrites newer in-memory state.
  const isEcho = (key) => {
    const json = JSON.stringify(changes[key].newValue);
    const pending = lastWritten.get(key) || [];
    const i = pending.indexOf(json);
    if (i === -1) return false;
    pending.splice(0, i + 1);
    return true;
  };
  if (changes[KEYS.settings] && !isEcho(KEYS.settings) && !settingsTimer) {
    store.settings = mergeSettings(changes[KEYS.settings].newValue);
    emit('settings');
  }
  if (changes[KEYS.shortcuts] && !isEcho(KEYS.shortcuts)) {
    store.shortcuts = changes[KEYS.shortcuts].newValue || [];
    emit('shortcuts');
  }
  if (changes[KEYS.dock] && !isEcho(KEYS.dock)) {
    store.dock = changes[KEYS.dock].newValue || [];
    emit('dock');
  }
  if (changes[KEYS.favorites] && !isEcho(KEYS.favorites)) {
    store.favorites = changes[KEYS.favorites].newValue || [];
    emit('favorites');
  }
  if (changes[KEYS.wallpaper]) {
    store.wallpaper = { ...store.wallpaper, ...(changes[KEYS.wallpaper].newValue || {}) };
    emit('wallpaper');
  }
  if (changes[KEYS.secrets]) emit('secrets');
}

window.addEventListener('pagehide', () => {
  flushSettings();
});

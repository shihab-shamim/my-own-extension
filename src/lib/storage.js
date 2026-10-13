// Thin promise wrappers around chrome.storage.local.
// All data stays on this device; nothing is synced or sent anywhere.

import { mergeSettings, seedShortcuts, seedDock } from './defaults.js';

export const KEYS = {
  settings: 'settings',
  shortcuts: 'shortcuts',
  dock: 'dock',
  secrets: 'secrets', // { unsplashKey }
  wallpaper: 'wallpaperState',
  favorites: 'favorites',
};

const area = () => chrome.storage.local;

export async function get(keys) {
  return area().get(keys);
}

export async function set(items) {
  return area().set(items);
}

export async function getSettings() {
  const { settings } = await get(KEYS.settings);
  return mergeSettings(settings);
}

export async function saveSettings(settings) {
  await set({ [KEYS.settings]: settings });
}

export async function getShortcuts() {
  const { shortcuts } = await get(KEYS.shortcuts);
  return Array.isArray(shortcuts) ? shortcuts : seedShortcuts();
}

export async function getDock() {
  const { dock } = await get(KEYS.dock);
  return Array.isArray(dock) ? dock : seedDock();
}

export async function getSecrets() {
  const { secrets } = await get(KEYS.secrets);
  return { unsplashKey: '', ...(secrets || {}) };
}

export async function getFavorites() {
  const { favorites } = await get(KEYS.favorites);
  return Array.isArray(favorites) ? favorites : [];
}

export async function getWallpaperState() {
  const { wallpaperState } = await get(KEYS.wallpaper);
  return {
    current: null,
    changedAt: 0,
    queue: [],
    queueSig: '',
    categoryCursor: 0,
    status: { state: 'ok' },
    backoffUntil: 0,
    ...(wallpaperState || {}),
  };
}

// Seed first-run data without overwriting anything that already exists.
export async function ensureSeeded() {
  const existing = await get([KEYS.settings, KEYS.shortcuts, KEYS.dock]);
  const patch = {};
  if (!existing.settings) patch[KEYS.settings] = mergeSettings(null);
  if (!Array.isArray(existing.shortcuts)) patch[KEYS.shortcuts] = seedShortcuts();
  if (!Array.isArray(existing.dock)) patch[KEYS.dock] = seedDock();
  if (Object.keys(patch).length) await set(patch);
}

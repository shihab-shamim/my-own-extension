// Export / import a backup of settings, shortcuts (with folders), dock,
// favorites and to-dos as a JSON file. The Unsplash key and uploaded photos
// are deliberately left out.

import { KEYS, set } from '../lib/storage.js';
import { mergeSettings } from '../lib/defaults.js';
import { sanitizeShortcuts, sanitizeLinks, isFolder, countLinks } from '../lib/shortcut-model.js';
import { sanitizeTodos, dayKey } from '../lib/todo-model.js';
import { sanitizeStoredPhoto } from '../lib/unsplash.js';
import { store } from './store.js';
import { h } from './dom.js';
import { toast, confirmDialog } from './ui.js';

export const BACKUP_APP = 'sequoia-tab';
export const BACKUP_FORMAT = 1;
const MAX_BYTES = 5 * 1024 * 1024;

export function buildBackup() {
  return {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    version: chrome.runtime.getManifest().version,
    exportedAt: new Date().toISOString(),
    settings: store.settings,
    shortcuts: store.shortcuts,
    dock: store.dock,
    favorites: store.favorites,
    todos: store.todos,
  };
}

export function exportBackup() {
  const blob = new Blob([JSON.stringify(buildBackup(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `sequoia-tab-backup-${dayKey()}.json`, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  toast('Backup downloaded. It doesn’t include your Unsplash key or uploaded photos.');
}

// Parse + validate. Throws an Error with a user-facing message.
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file isn’t valid JSON.');
  }
  if (!data || data.app !== BACKUP_APP) throw new Error('That file isn’t a Sequoia Tab backup.');
  if (data.format !== BACKUP_FORMAT) throw new Error('This backup was made by a newer version of Sequoia Tab.');
  const out = {};
  if (data.settings && typeof data.settings === 'object') out.settings = mergeSettings(data.settings);
  const sc = sanitizeShortcuts(data.shortcuts);
  if (sc) out.shortcuts = sc;
  const dock = sanitizeLinks(data.dock, 24);
  if (dock) out.dock = dock;
  if (Array.isArray(data.favorites)) out.favorites = data.favorites.slice(0, 200).map(sanitizeStoredPhoto).filter(Boolean);
  const todos = sanitizeTodos(data.todos);
  if (todos) out.todos = todos;
  if (!Object.keys(out).length) throw new Error('The backup is empty.');
  return out;
}

function summary(b) {
  const parts = [];
  if (b.settings) parts.push('settings');
  if (b.shortcuts) {
    const folders = b.shortcuts.filter(isFolder).length;
    parts.push(`${countLinks(b.shortcuts)} shortcuts${folders ? ` in ${folders} folder${folders > 1 ? 's' : ''} and the page` : ''}`);
  }
  if (b.dock) parts.push(`${b.dock.length} dock items`);
  if (b.favorites) parts.push(`${b.favorites.length} favorites`);
  if (b.todos) parts.push(`${b.todos.items.length} tasks`);
  return parts.join(', ');
}

export async function importBackupText(text, { confirm = true } = {}) {
  const b = parseBackup(text);
  if (confirm) {
    const ok = await confirmDialog({
      title: 'Restore this backup?',
      message: `This replaces your current ${summary(b)}. Your Unsplash key and uploaded photos stay as they are.`,
      confirmLabel: 'Restore',
      danger: true,
    });
    if (!ok) return false;
  }
  const patch = {};
  if (b.settings) patch[KEYS.settings] = b.settings;
  if (b.shortcuts) patch[KEYS.shortcuts] = b.shortcuts;
  if (b.dock) patch[KEYS.dock] = b.dock;
  if (b.favorites) patch[KEYS.favorites] = b.favorites;
  if (b.todos) patch[KEYS.todos] = b.todos;
  await set(patch); // every open tab updates through storage.onChanged
  toast('Backup restored.');
  return true;
}

export async function importBackupFile(file) {
  if (!file) return false;
  if (file.size > MAX_BYTES) {
    toast('That file is too large to be a Sequoia Tab backup.', { error: true });
    return false;
  }
  try {
    return await importBackupText(await file.text());
  } catch (err) {
    toast(err.message || 'Could not read that backup.', { error: true });
    return false;
  }
}

export function pickBackupFile() {
  const input = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  input.addEventListener('change', () => {
    importBackupFile(input.files?.[0]);
    input.remove();
  });
  document.body.append(input);
  input.click();
}

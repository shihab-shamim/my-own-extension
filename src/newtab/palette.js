// Command palette (Ctrl+K / ⌘K): one box to find shortcuts, folders,
// bookmarks, dock items, settings and actions, or to search the web.

import { h, clear } from './dom.js';
import { icon } from '../lib/icons.js';
import { looksLikeUrl, normalizeUrl, openUrl, hostOf } from '../lib/url.js';
import { flattenLinks, isFolder } from '../lib/shortcut-model.js';
import { store, updateSettings } from './store.js';
import { modal } from './ui.js';
import { siteIcon } from './site-icon.js';
import { runSearch, engine } from './search.js';
import { openAll } from './tiles.js';
import { openFolder } from './folder-view.js';
import { addShortcut } from './shortcuts.js';
import { addTodo, focusTodoInput } from './todo.js';
import { exportBackup, pickBackupFile } from './backup.js';
import { nextWallpaper } from './bridge.js';
import { googleApps } from './gbar.js';

const MAX_RESULTS = 30;
const BOOKMARK_RESULTS = 8;
let dlg = null;
let openSettingsFn = () => {};

const SETTINGS_SECTIONS = [
  ['wallpaper', 'Wallpaper'], ['appearance', 'Appearance'], ['widgets', 'Widgets'], ['clock', 'Clock & Date'],
  ['search', 'Search'], ['shortcuts', 'Shortcuts'], ['dock', 'Dock'], ['bookmarks', 'Bookmarks'], ['about', 'Backup & Privacy'],
];

// Higher is better; 0 means no match. `initials` also matches word
// initials ("sd" → "Support Desk"); used for titles only.
export function score(query, text, initials = false) {
  if (!text) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t === q) return 120;
  if (t.startsWith(q)) return 100 - Math.min(20, t.length - q.length) / 2;
  const i = t.indexOf(q);
  if (i > 0 && /[\s\-_/.:([]/.test(t[i - 1])) return 80;
  if (i >= 0) return 60;
  // Several words: each must appear ("settings dock" → "Settings: Dock").
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every((w) => t.includes(w))) return 55;
  if (!initials || q.length < 2) return 0;
  const inits = t.split(/[\s\-_/.:()]+/).filter(Boolean).map((w) => w[0]).join('');
  return inits.startsWith(q) ? 50 : 0;
}

function badge(name, color) {
  return h('span', { class: 'pal-glyph', style: { background: color } }, icon(name, { size: 14 }));
}

function staticItems() {
  const items = [];
  for (const { item, folder } of flattenLinks(store.shortcuts)) {
    items.push({ kind: 'Shortcut', title: item.title, subtitle: folder ? `${folder.title} · ${hostOf(item.url)}` : hostOf(item.url) || item.url, url: item.url, icon: () => siteIcon(item, 32), keys: [item.url, folder?.title] });
  }
  for (const f of store.shortcuts.filter(isFolder)) {
    items.push({ kind: 'Folder', title: `Open all in ${f.title}`, subtitle: `${f.children.length} tabs`, icon: () => badge('newTab', '#34c759'), keys: [f.title, 'open all'], run: () => openAll(f.children, `“${f.title}”`) });
    items.push({ kind: 'Folder', title: f.title, subtitle: 'Show folder', icon: () => badge('folder', '#0a84ff'), keys: ['folder'], run: () => openFolder(f.id) });
  }
  for (const d of store.dock) {
    items.push({ kind: 'Dock', title: d.title, subtitle: d.url, url: d.url, icon: () => (d.glyph ? badge(d.glyph, '#5e5ce6') : siteIcon(d, 32)), keys: [d.url] });
  }
  if (store.settings.widgets.visible.gbar) {
    const seenTitles = new Set(items.map((i) => i.title.toLowerCase()));
    for (const app of googleApps()) {
      if (seenTitles.has(app.title.toLowerCase())) continue;
      items.push({ kind: 'Google', title: `Google ${app.title}`, subtitle: hostOf(app.url), url: app.url, icon: () => siteIcon(app, 32), keys: [app.title] });
    }
  }
  const s = store.settings;
  const rotating = s.wallpaper.interval !== 'off' && !['gradient', 'color'].includes(s.wallpaper.source);
  const dark = document.documentElement.dataset.theme === 'dark';
  items.push(
    { kind: 'Action', title: 'Next wallpaper', icon: () => badge('refresh', '#ff9f0a'), keys: ['background', 'change'], run: () => nextWallpaper() },
    ...(rotating ? [{ kind: 'Action', title: s.wallpaper.paused ? 'Resume wallpaper rotation' : 'Pause wallpaper rotation', icon: () => badge(s.wallpaper.paused ? 'play' : 'pause', '#ff9f0a'), run: () => updateSettings((x) => (x.wallpaper.paused = !x.wallpaper.paused), { immediate: true }) }] : []),
    { kind: 'Action', title: dark ? 'Switch to light theme' : 'Switch to dark theme', icon: () => badge('settings', '#5e5ce6'), keys: ['appearance', 'mode'], run: () => updateSettings((x) => (x.appearance.theme = dark ? 'light' : 'dark')) },
    { kind: 'Action', title: 'Add shortcut…', icon: () => badge('plus', '#34c759'), keys: ['new link'], run: () => addShortcut() },
    ...(s.widgets.visible.todo ? [{ kind: 'Action', title: 'Go to to-do list', icon: () => badge('list', '#ff375f'), keys: ['task', 'todo'], run: () => focusTodoInput() }] : []),
    { kind: 'Action', title: 'Export settings backup', icon: () => badge('backup', '#8e8e93'), keys: ['download', 'save'], run: () => exportBackup() },
    { kind: 'Action', title: 'Import settings backup…', icon: () => badge('upload', '#8e8e93'), keys: ['restore'], run: () => pickBackupFile() },
    ...SETTINGS_SECTIONS.map(([id, label]) => ({ kind: 'Settings', title: `Settings: ${label}`, icon: () => badge('gear', '#8e8e93'), keys: ['preferences', 'customize'], run: () => openSettingsFn(id) })),
  );
  return items;
}

function rank(items, q) {
  if (!q) return items.filter((i) => i.kind === 'Shortcut' || i.kind === 'Folder').slice(0, 10).concat(items.filter((i) => i.kind === 'Action').slice(0, 4));
  return items
    .map((i) => ({ i, s: Math.max(score(q, i.title, true), ...(i.keys || []).map((k) => score(q, k) * 0.7), score(q, i.subtitle) * 0.6) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.i);
}

function dynamicItems(q) {
  if (!q) return [];
  const out = [];
  if (looksLikeUrl(q)) {
    const url = normalizeUrl(q);
    if (url) out.push({ kind: 'Go to', title: url, url, icon: () => badge('globe', '#30b0c7') });
  }
  out.push({ kind: 'Search', title: `Search for “${q}”`, subtitle: engine().label, icon: () => badge('search', '#30b0c7'), run: (newTab) => runSearch(q, newTab) });
  if (store.settings.widgets.visible.todo) {
    out.push({ kind: 'Task', title: `Add task: ${q}`, icon: () => badge('list', '#ff375f'), run: () => addTodo(q) });
  }
  return out;
}

async function bookmarkItems(q, seen) {
  if (q.length < 2) return [];
  try {
    const found = await chrome.bookmarks.search(q);
    return found
      .filter((b) => b.url && /^(https?|chrome|file):/i.test(b.url) && !seen.has(b.url))
      .slice(0, BOOKMARK_RESULTS)
      .map((b) => ({ kind: 'Bookmark', title: b.title || b.url, subtitle: hostOf(b.url) || b.url, url: b.url, icon: () => siteIcon({ title: b.title, url: b.url }, 32) }));
  } catch {
    return [];
  }
}

export function openPalette(initial = '') {
  if (dlg) {
    dlg.close();
    return;
  }
  const base = staticItems();
  const input = h('input', { class: 'pal-input', type: 'text', placeholder: 'Search shortcuts, bookmarks, actions or the web…', 'aria-label': 'Command', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'pal-list', 'aria-autocomplete': 'list', autocomplete: 'off', spellcheck: 'false' });
  input.value = initial;
  const listEl = h('ul', { class: 'pal-list', id: 'pal-list', role: 'listbox', 'aria-label': 'Results' });
  const hint = h('div', { class: 'pal-hint', 'aria-hidden': 'true' }, h('span', {}, '↑↓ to move'), h('span', {}, 'Enter to open'), h('span', {}, 'Alt+Enter: new tab'), h('span', {}, 'Esc to close'));
  const sheet = h('div', { class: 'sheet pal-sheet' }, h('div', { class: 'pal-top' }, icon('search', { size: 18 }), input), listEl, hint);
  dlg = modal('palette-dialog', sheet, { label: 'Command palette', onClose: () => (dlg = null) });

  let results = [];
  let active = 0;
  let token = 0;

  const run = (item, newTab = false) => {
    if (!item) return;
    dlg?.close();
    if (item.run) item.run(newTab);
    else if (item.url) openUrl(item.url, { newTab });
  };

  const paint = () => {
    clear(listEl);
    if (!results.length) listEl.append(h('li', { class: 'pal-empty', role: 'presentation' }, 'No matches.'));
    results.forEach((item, i) => {
      const li = h(
        'li',
        { class: 'pal-item', id: `pal-${i}`, role: 'option', 'aria-selected': String(i === active) },
        h('span', { class: 'pal-icon' }, item.icon()),
        h('span', { class: 'pal-text' }, h('span', { class: 'pal-title' }, item.title), item.subtitle ? h('span', { class: 'pal-sub' }, item.subtitle) : null),
        h('span', { class: 'pal-kind' }, item.kind),
      );
      li.addEventListener('mousemove', () => {
        if (active !== i) select(i);
      });
      li.addEventListener('click', (e) => run(item, e.ctrlKey || e.metaKey || e.altKey));
      listEl.append(li);
    });
    input.setAttribute('aria-activedescendant', results.length ? `pal-${active}` : '');
  };

  const select = (i) => {
    active = Math.max(0, Math.min(results.length - 1, i));
    for (const li of listEl.querySelectorAll('.pal-item')) li.setAttribute('aria-selected', String(li.id === `pal-${active}`));
    input.setAttribute('aria-activedescendant', `pal-${active}`);
    listEl.querySelector(`#pal-${active}`)?.scrollIntoView({ block: 'nearest' });
  };

  const update = async () => {
    const q = input.value.trim();
    const my = ++token;
    const ranked = rank(base, q);
    const dyn = dynamicItems(q);
    // Web search goes first only when nothing local matches.
    results = (ranked.length ? [...ranked, ...dyn] : [...dyn.filter((d) => d.kind !== 'Task'), ...dyn.filter((d) => d.kind === 'Task')]).slice(0, MAX_RESULTS);
    if (dyn[0]?.kind === 'Go to') results = [dyn[0], ...results.filter((r) => r !== dyn[0])];
    active = 0;
    paint();
    const seen = new Set(base.filter((b) => b.url).map((b) => b.url));
    const bms = await bookmarkItems(q, seen);
    if (my !== token || !bms.length || !dlg) return;
    const firstDyn = results.findIndex((r) => dyn.includes(r) && r.kind !== 'Go to');
    const at = firstDyn < 0 ? results.length : firstDyn;
    results = [...results.slice(0, at), ...bms, ...results.slice(at)].slice(0, MAX_RESULTS);
    paint();
  };

  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      select(active + 1 >= results.length ? 0 : active + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      select(active - 1 < 0 ? results.length - 1 : active - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(results[active], e.altKey || e.ctrlKey || e.metaKey);
    }
  });
  update();
  input.focus();
  input.select();
}

export function initPalette(openSettings) {
  openSettingsFn = openSettings;
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
      // Don't stack on top of other dialogs (settings, folders…).
      if (!dlg && document.querySelector('dialog[open]')) return;
      e.preventDefault();
      openPalette();
    }
  });
}

export function isPaletteOpen() {
  return !!dlg;
}

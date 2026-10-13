// Custom website shortcuts: add, edit, remove and reorder (drag & drop, menu
// or Ctrl+Shift+←/→). Tiles are real links so normal link behaviour works.

import { h, clear } from './dom.js';
import { icon } from '../lib/icons.js';
import { uid } from '../lib/defaults.js';
import { normalizeUrl, needsTabsApi, openUrl, faviconUrl, hostOf } from '../lib/url.js';
import { openMenu } from './menu.js';
import { store, saveShortcuts } from './store.js';
import { modal, toast } from './ui.js';

const el = document.getElementById('w-shortcuts');
export const MAX_SHORTCUTS = 48;
let list;

const LETTER_COLORS = ['#ff6b6b', '#f59f00', '#37b24d', '#1c7ed6', '#7048e8', '#d6336c', '#0ca678', '#e8590c', '#4263eb', '#ae3ec9'];

export function letterTile(title, url, cls = 'letter') {
  const text = (title || hostOf(url) || '?').trim();
  const ch = [...text][0]?.toUpperCase() || '?';
  let hash = 0;
  for (const c of hostOf(url) || text) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return h('span', { class: cls, style: { background: LETTER_COLORS[hash % LETTER_COLORS.length] }, 'aria-hidden': 'true' }, ch);
}

export function validIconUrl(v) {
  if (!v) return '';
  try {
    const u = new URL(v);
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

// Chrome's favicon cache returns a generic globe for sites it has never seen.
// Fingerprint that globe once so we can show a nicer letter tile instead.
const fingerprints = new Map(); // size -> Promise<string|null>

function fingerprint(img) {
  try {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 16, 16);
    return Array.from(ctx.getImageData(0, 0, 16, 16).data).join(',');
  } catch {
    return null;
  }
}

function defaultFingerprint(size) {
  if (!fingerprints.has(size)) {
    fingerprints.set(
      size,
      new Promise((resolve) => {
        const probe = new Image();
        probe.onload = () => resolve(fingerprint(probe));
        probe.onerror = () => resolve(null);
        probe.src = faviconUrl('https://sequoia-tab.invalid/', size);
      }),
    );
  }
  return fingerprints.get(size);
}

// Site icon with a letter fallback when no real favicon is available.
export function siteIcon(item, size = 64) {
  const custom = validIconUrl(item.icon);
  const src = custom || (/^https?:/i.test(item.url) ? faviconUrl(item.url, size) : null);
  if (!src) return letterTile(item.title, item.url);
  const img = h('img', { src, alt: '', draggable: 'false', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(letterTile(item.title, item.url)), { once: true });
  if (!custom) {
    img.addEventListener(
      'load',
      async () => {
        const def = await defaultFingerprint(size);
        if (def && fingerprint(img) === def) img.replaceWith(letterTile(item.title, item.url));
      },
      { once: true },
    );
  }
  return img;
}

function move(id, delta) {
  const arr = store.shortcuts.slice();
  const i = arr.findIndex((s) => s.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  saveShortcuts(arr);
  requestAnimationFrame(() => list.querySelector(`[data-id="${CSS.escape(id)}"] .tile-link`)?.focus());
}

function remove(item) {
  const before = store.shortcuts.slice();
  saveShortcuts(before.filter((s) => s.id !== item.id));
  toast(`Removed “${item.title}”.`);
}

// Add/edit dialog shared with the dock editor.
export function editLinkDialog({ title, item, onSave, allowChrome = true }) {
  const nameIn = h('input', { class: 'field', id: 'ld-name', maxlength: '80', required: true, autocomplete: 'off' });
  const urlIn = h('input', { class: 'field', id: 'ld-url', maxlength: '2048', required: true, autocomplete: 'off', inputmode: 'url', placeholder: 'example.com' });
  const iconIn = h('input', { class: 'field', id: 'ld-icon', maxlength: '2048', autocomplete: 'off', placeholder: 'https://… (optional)' });
  nameIn.value = item?.title || '';
  urlIn.value = item?.url || '';
  iconIn.value = item?.icon || '';
  const err = h('p', { class: 'form-error', role: 'alert' });
  const cancel = h('button', { type: 'button', class: 'btn' }, 'Cancel');
  const save = h('button', { type: 'submit', class: 'btn primary' }, item ? 'Save' : 'Add');
  const form = h(
    'form',
    { class: 'sheet', novalidate: true },
    h('h2', {}, title),
    h('div', { class: 'form-row' }, h('label', { for: 'ld-name' }, 'Name'), nameIn),
    h('div', { class: 'form-row' }, h('label', { for: 'ld-url' }, 'URL'), urlIn),
    h('div', { class: 'form-row' }, h('label', { for: 'ld-icon' }, 'Custom icon URL'), iconIn),
    err,
    h('div', { class: 'form-actions' }, cancel, save),
  );
  const dlg = modal('form-dialog', form, { label: title });
  cancel.addEventListener('click', () => dlg.close('cancel'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = normalizeUrl(urlIn.value);
    if (!url || (!allowChrome && !/^https?:/i.test(url))) {
      err.textContent = 'Enter a valid web address (http or https).';
      urlIn.focus();
      return;
    }
    const iconUrl = validIconUrl(iconIn.value.trim());
    if (iconUrl === null) {
      err.textContent = 'The icon URL must start with https://';
      iconIn.focus();
      return;
    }
    const name = nameIn.value.trim().slice(0, 80) || hostOf(url) || url;
    onSave({ ...(item || {}), title: name, url, icon: iconUrl || undefined });
    dlg.close('ok');
  });
  (item ? nameIn : urlIn).focus();
  if (!item) {
    // Suggest a name from the domain; it is selected on focus so typing replaces it.
    let suggested = false;
    urlIn.addEventListener('blur', () => {
      if (!nameIn.value.trim() || suggested) {
        const u = normalizeUrl(urlIn.value);
        const name = u ? hostOf(u).split('.').slice(-2, -1)[0]?.replace(/^./, (c) => c.toUpperCase()) || '' : '';
        nameIn.value = name;
        suggested = !!name;
      }
    });
    nameIn.addEventListener('focus', () => suggested && nameIn.select());
    nameIn.addEventListener('input', () => (suggested = false));
  }
  return dlg;
}

export function addShortcut() {
  if (store.shortcuts.length >= MAX_SHORTCUTS) {
    toast(`You can have up to ${MAX_SHORTCUTS} shortcuts.`, { error: true });
    return;
  }
  editLinkDialog({
    title: 'Add shortcut',
    onSave: (data) => saveShortcuts([...store.shortcuts, { ...data, id: uid('sc') }]),
  });
}

function editShortcut(item) {
  editLinkDialog({
    title: 'Edit shortcut',
    item,
    onSave: (data) => saveShortcuts(store.shortcuts.map((s) => (s.id === item.id ? { ...data, id: item.id } : s))),
  });
}

function tileMenu(item, index, btn, viaKeyboard) {
  const n = store.shortcuts.length;
  openMenu(
    btn,
    [
      { label: 'Open in new tab', icon: icon('newTab', { size: 15 }), onSelect: () => openUrl(item.url, { newTab: true }) },
      { sep: true },
      { label: 'Edit…', icon: icon('edit', { size: 15 }), onSelect: () => editShortcut(item) },
      ...(index > 0 ? [{ label: 'Move left', icon: icon('left', { size: 15 }), onSelect: () => move(item.id, -1) }] : []),
      ...(index < n - 1 ? [{ label: 'Move right', icon: icon('right', { size: 15 }), onSelect: () => move(item.id, 1) }] : []),
      { sep: true },
      { label: 'Remove', icon: icon('trash', { size: 15 }), danger: true, onSelect: () => remove(item) },
    ],
    { label: `Options for ${item.title}`, focusFirst: viaKeyboard },
  );
}

let dragId = null;

function clearDropMarks() {
  for (const t of list.querySelectorAll('.drop-before, .drop-after')) t.classList.remove('drop-before', 'drop-after');
}

function tile(item, index) {
  const link = h(
    'a',
    { class: 'tile-link', href: item.url, draggable: 'true', title: `${item.title}\n${item.url}` },
    h('span', { class: 'tile-icon glass' }, siteIcon(item)),
    h('span', { class: 'tile-label' }, item.title),
  );
  link.addEventListener('click', (e) => {
    if (needsTabsApi(item.url)) {
      e.preventDefault();
      const newTab = e.ctrlKey || e.metaKey || e.shiftKey;
      openUrl(item.url, { newTab, background: newTab && !e.shiftKey });
    }
  });
  link.addEventListener('auxclick', (e) => {
    if (e.button === 1 && needsTabsApi(item.url)) {
      e.preventDefault();
      openUrl(item.url, { newTab: true, background: true });
    }
  });
  link.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      move(item.id, e.key === 'ArrowLeft' ? -1 : 1);
    }
  });
  const more = h(
    'button',
    { type: 'button', class: 'tile-more', 'aria-label': `Options for ${item.title}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false' },
    icon('more', { size: 14 }),
  );
  more.addEventListener('click', (e) => tileMenu(item, index, more, e.detail === 0));

  const li = h('li', { class: 'tile', 'data-id': item.id }, link, more);
  li.addEventListener('dragstart', (e) => {
    dragId = item.id;
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/uri-list', item.url);
    e.dataTransfer.setData('text/plain', item.url);
  });
  li.addEventListener('dragend', () => {
    dragId = null;
    li.classList.remove('dragging');
    clearDropMarks();
  });
  li.addEventListener('dragover', (e) => {
    if (!dragId || dragId === item.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const r = li.getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    clearDropMarks();
    li.classList.add(after ? 'drop-after' : 'drop-before');
  });
  li.addEventListener('drop', (e) => {
    if (!dragId || dragId === item.id) return;
    e.preventDefault();
    const after = li.classList.contains('drop-after');
    clearDropMarks();
    const arr = store.shortcuts.slice();
    const from = arr.findIndex((s) => s.id === dragId);
    if (from < 0) return;
    const [moved] = arr.splice(from, 1);
    let to = arr.findIndex((s) => s.id === item.id);
    if (after) to += 1;
    arr.splice(to, 0, moved);
    saveShortcuts(arr);
  });
  return li;
}

function addTile() {
  const btn = h(
    'button',
    { type: 'button', class: 'tile-link', 'aria-label': 'Add shortcut' },
    h('span', { class: 'tile-icon' }, icon('plus', { size: 22 })),
    h('span', { class: 'tile-label' }, 'Add shortcut'),
  );
  btn.addEventListener('click', addShortcut);
  return h('li', { class: 'tile tile-add' }, btn);
}

export function renderShortcuts() {
  const s = store.settings.shortcuts;
  list = h('ul', { class: 'shortcuts-grid', 'data-size': s.size, 'data-labels': String(s.showLabels) });
  if (s.columns !== 'auto') list.style.setProperty('--cols', String(s.columns));
  store.shortcuts.forEach((item, i) => list.append(tile(item, i)));
  if (store.shortcuts.length < MAX_SHORTCUTS) list.append(addTile());
  clear(el).append(list);
  layoutColumns();
}

// "auto" columns: as many as fit (max 12); a number caps the row length.
export function layoutColumns() {
  if (!list) return;
  const s = store.settings.shortcuts;
  if (s.columns === 'auto') {
    const count = list.children.length;
    list.style.setProperty('--cols', String(Math.min(12, Math.max(1, count))));
  }
}

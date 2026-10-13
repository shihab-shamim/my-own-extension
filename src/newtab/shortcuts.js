// Shortcuts grid: links and Launchpad-style folders. Add, edit, remove,
// reorder (drag & drop, menu or Ctrl+Shift+←/→), group into folders (menu or
// drop one tile onto another) and open a whole folder at once.

import { h, clear } from './dom.js';
import { icon } from '../lib/icons.js';
import { openUrl } from '../lib/url.js';
import * as M from '../lib/shortcut-model.js';
import { openMenu } from './menu.js';
import { store, saveShortcuts } from './store.js';
import { toast, confirmDialog } from './ui.js';
import { siteIcon } from './site-icon.js';
import { editLinkDialog, nameDialog } from './link-dialog.js';
import { linkAnchor, enableDrag, openAll } from './tiles.js';
import { openFolder } from './folder-view.js';

// Re-exported for modules that used to import them from here.
export { siteIcon, letterTile, validIconUrl } from './site-icon.js';
export { editLinkDialog } from './link-dialog.js';

const el = document.getElementById('w-shortcuts');
export const MAX_SHORTCUTS = M.MAX_TOP_LEVEL;
let list;

const save = (next) => (next === store.shortcuts ? Promise.resolve() : saveShortcuts(next));

function focusTile(id) {
  requestAnimationFrame(() => list?.querySelector(`[data-id="${CSS.escape(id)}"] .tile-link`)?.focus());
}

function moveTile(id, delta) {
  save(M.move(store.shortcuts, id, delta));
  focusTile(id);
}

export function addShortcut() {
  if (store.shortcuts.length >= MAX_SHORTCUTS) {
    toast(`You can have up to ${MAX_SHORTCUTS} items on the page. Group some into folders.`, { error: true });
    return;
  }
  editLinkDialog({ title: 'Add shortcut', onSave: (data) => save(M.addLink(store.shortcuts, data)) });
}

function newFolderWith(item) {
  nameDialog({
    title: 'New folder',
    label: 'Folder name',
    value: 'Folder',
    confirmLabel: 'Create',
    onSave: (name) => {
      const { list: next, folderId } = M.createFolder(store.shortcuts, item.id, null, name);
      if (folderId) save(next).then(() => toast(`Created folder “${name}”.`));
    },
  });
}

function folderSubmenu(item) {
  const folders = store.shortcuts.filter(M.isFolder);
  return [
    ...folders.map((f) => ({
      label: f.title,
      icon: icon('folder', { size: 15 }),
      onSelect: () => {
        save(M.addToFolder(store.shortcuts, item.id, f.id));
        toast(`Moved “${item.title}” to ${f.title}.`);
      },
    })),
    ...(folders.length ? [{ sep: true }] : []),
    { label: 'New folder…', icon: icon('plus', { size: 15 }), onSelect: () => newFolderWith(item) },
  ];
}

function linkMenu(item, index, btn, viaKeyboard) {
  const n = store.shortcuts.length;
  openMenu(
    btn,
    [
      { label: 'Open in new tab', icon: icon('newTab', { size: 15 }), onSelect: () => openUrl(item.url, { newTab: true }) },
      { sep: true },
      { label: 'Edit…', icon: icon('edit', { size: 15 }), onSelect: () => editLinkDialog({ title: 'Edit shortcut', item, onSave: (d) => save(M.update(store.shortcuts, item.id, d)) }) },
      { label: 'Add to folder', icon: icon('folder', { size: 15 }), submenu: () => folderSubmenu(item) },
      ...(index > 0 ? [{ label: 'Move left', icon: icon('left', { size: 15 }), onSelect: () => moveTile(item.id, -1) }] : []),
      ...(index < n - 1 ? [{ label: 'Move right', icon: icon('right', { size: 15 }), onSelect: () => moveTile(item.id, 1) }] : []),
      { sep: true },
      {
        label: 'Remove',
        icon: icon('trash', { size: 15 }),
        danger: true,
        onSelect: () => {
          save(M.remove(store.shortcuts, item.id));
          toast(`Removed “${item.title}”.`);
        },
      },
    ],
    { label: `Options for ${item.title}`, focusFirst: viaKeyboard },
  );
}

export async function deleteFolder(folder) {
  const ok = await confirmDialog({
    title: `Delete “${folder.title}”?`,
    message: `The folder and its ${folder.children.length} shortcut${folder.children.length === 1 ? '' : 's'} will be removed. To keep the shortcuts, choose “Ungroup” instead.`,
    confirmLabel: 'Delete',
    danger: true,
  });
  if (ok) save(M.remove(store.shortcuts, folder.id));
  return ok;
}

export function renameFolder(folder) {
  nameDialog({ title: 'Rename folder', label: 'Folder name', value: folder.title, onSave: (name) => save(M.update(store.shortcuts, folder.id, { title: name })) });
}

function folderMenu(folder, index, btn, viaKeyboard) {
  const n = store.shortcuts.length;
  openMenu(
    btn,
    [
      { label: 'Open folder', icon: icon('folder', { size: 15 }), onSelect: () => openFolder(folder.id) },
      { label: `Open all ${folder.children.length} in new tabs`, icon: icon('newTab', { size: 15 }), onSelect: () => openAll(folder.children, `“${folder.title}”`) },
      { sep: true },
      { label: 'Rename…', icon: icon('edit', { size: 15 }), onSelect: () => renameFolder(folder) },
      ...(index > 0 ? [{ label: 'Move left', icon: icon('left', { size: 15 }), onSelect: () => moveTile(folder.id, -1) }] : []),
      ...(index < n - 1 ? [{ label: 'Move right', icon: icon('right', { size: 15 }), onSelect: () => moveTile(folder.id, 1) }] : []),
      { label: 'Ungroup', icon: icon('extensions', { size: 15 }), onSelect: () => save(M.ungroup(store.shortcuts, folder.id)) },
      { sep: true },
      { label: 'Delete folder…', icon: icon('trash', { size: 15 }), danger: true, onSelect: () => deleteFolder(folder) },
    ],
    { label: `Options for folder ${folder.title}`, focusFirst: viaKeyboard },
  );
}

function moreButton(label, onOpen) {
  const more = h('button', { type: 'button', class: 'tile-more', 'aria-label': label, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon('more', { size: 14 }));
  more.addEventListener('click', (e) => onOpen(more, e.detail === 0));
  return more;
}

function keyboardReorder(node, id) {
  node.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      moveTile(id, e.key === 'ArrowLeft' ? -1 : 1);
    }
  });
}

const dragOpts = (item, extra) => ({
  scope: 'grid',
  canReceive: true,
  onReorder: (id, targetId, after) => save(M.reorder(store.shortcuts, id, targetId, after)),
  onInto: (id, targetId) => {
    const target = store.shortcuts.find((x) => x.id === targetId);
    if (M.isFolder(target)) {
      save(M.addToFolder(store.shortcuts, id, targetId));
      toast(`Moved to ${target.title}.`);
    } else {
      const { list: next, folderId } = M.createFolder(store.shortcuts, targetId, id, 'Folder');
      if (folderId) save(next).then(() => openFolder(folderId, { rename: true }));
    }
  },
  ...extra,
});

function linkTile(item, index) {
  const a = linkAnchor(item);
  keyboardReorder(a, item.id);
  const li = h('li', { class: 'tile', 'data-id': item.id }, a, moreButton(`Options for ${item.title}`, (btn, kb) => linkMenu(item, index, btn, kb)));
  enableDrag(li, item, dragOpts(item, { url: item.url }));
  return li;
}

function folderTile(folder, index) {
  const preview = h('span', { class: 'folder-grid', 'aria-hidden': 'true' }, folder.children.slice(0, 4).map((c) => h('span', { class: 'folder-mini' }, siteIcon(c, 32))));
  const btn = h(
    'button',
    { type: 'button', class: 'tile-link', draggable: 'true', 'aria-label': `Folder ${folder.title}, ${folder.children.length} shortcuts`, title: folder.title },
    h('span', { class: 'tile-icon glass folder-icon' }, preview),
    h('span', { class: 'tile-label' }, folder.title),
  );
  btn.addEventListener('click', () => openFolder(folder.id));
  keyboardReorder(btn, folder.id);
  const li = h('li', { class: 'tile tile-folder', 'data-id': folder.id }, btn, moreButton(`Options for folder ${folder.title}`, (b, kb) => folderMenu(folder, index, b, kb)));
  enableDrag(li, folder, dragOpts(folder, { isFolder: true }));
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
  store.shortcuts.forEach((item, i) => list.append(M.isFolder(item) ? folderTile(item, i) : linkTile(item, i)));
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

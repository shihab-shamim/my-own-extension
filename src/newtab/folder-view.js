// Launchpad-style folder window: rename inline, open all, and manage the
// shortcuts inside (add, edit, reorder, move out, remove).

import { h } from './dom.js';
import { icon } from '../lib/icons.js';
import { openUrl } from '../lib/url.js';
import * as M from '../lib/shortcut-model.js';
import { openMenu } from './menu.js';
import { store, saveShortcuts, on } from './store.js';
import { modal, toast } from './ui.js';
import { editLinkDialog } from './link-dialog.js';
import { linkAnchor, enableDrag, openAll } from './tiles.js';

let current = null; // { dlg, folderId, grid, titleIn, openBtn, unsub }

const folderNow = () => store.shortcuts.find((f) => f.id === current?.folderId && M.isFolder(f)) || null;
const save = (next) => (next === store.shortcuts ? Promise.resolve() : saveShortcuts(next));

function childMenu(item, index, count, btn, kb) {
  openMenu(
    btn,
    [
      { label: 'Open in new tab', icon: icon('newTab', { size: 15 }), onSelect: () => openUrl(item.url, { newTab: true }) },
      { sep: true },
      { label: 'Edit…', icon: icon('edit', { size: 15 }), onSelect: () => editLinkDialog({ title: 'Edit shortcut', item, onSave: (d) => save(M.update(store.shortcuts, item.id, d)) }) },
      ...(index > 0 ? [{ label: 'Move left', icon: icon('left', { size: 15 }), onSelect: () => save(M.move(store.shortcuts, item.id, -1)) }] : []),
      ...(index < count - 1 ? [{ label: 'Move right', icon: icon('right', { size: 15 }), onSelect: () => save(M.move(store.shortcuts, item.id, 1)) }] : []),
      {
        label: 'Move out of folder',
        icon: icon('up', { size: 15 }),
        onSelect: () => {
          const next = M.moveOut(store.shortcuts, item.id);
          if (next === store.shortcuts) toast('The page is full. Remove something first.', { error: true });
          else save(next);
        },
      },
      { sep: true },
      { label: 'Remove', icon: icon('trash', { size: 15 }), danger: true, onSelect: () => save(M.remove(store.shortcuts, item.id)) },
    ],
    { label: `Options for ${item.title}`, focusFirst: kb },
  );
}

function render() {
  const folder = folderNow();
  if (!folder) {
    current?.dlg.close();
    return;
  }
  // The model removes emptied folders; just close if that happened.
  if (!folder.children.length) {
    current.dlg.close();
    return;
  }
  if (document.activeElement !== current.titleIn) current.titleIn.value = folder.title;
  current.openBtn.lastChild.textContent = `Open all ${folder.children.length}`;
  const grid = h('ul', { class: 'shortcuts-grid folder-grid-list', 'data-size': 'medium', 'data-labels': 'true' });
  grid.style.setProperty('--cols', '5');
  folder.children.forEach((item, i) => {
    const a = linkAnchor(item);
    a.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        save(M.move(store.shortcuts, item.id, e.key === 'ArrowLeft' ? -1 : 1));
        requestAnimationFrame(() => current?.grid.querySelector(`[data-id="${CSS.escape(item.id)}"] .tile-link`)?.focus());
      }
    });
    const more = h('button', { type: 'button', class: 'tile-more', 'aria-label': `Options for ${item.title}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon('more', { size: 14 }));
    more.addEventListener('click', (e) => childMenu(item, i, folder.children.length, more, e.detail === 0));
    const li = h('li', { class: 'tile', 'data-id': item.id }, a, more);
    enableDrag(li, item, { scope: 'folder', url: item.url, onReorder: (id, targetId, after) => save(M.reorder(store.shortcuts, id, targetId, after)) });
    grid.append(li);
  });
  if (folder.children.length < M.MAX_IN_FOLDER) {
    const add = h('button', { type: 'button', class: 'tile-link', 'aria-label': 'Add shortcut to this folder' }, h('span', { class: 'tile-icon' }, icon('plus', { size: 22 })), h('span', { class: 'tile-label' }, 'Add'));
    add.addEventListener('click', () => editLinkDialog({ title: `Add to ${folder.title}`, onSave: (d) => save(M.addLink(store.shortcuts, d, folder.id)) }));
    grid.append(h('li', { class: 'tile tile-add' }, add));
  }
  const focusedId = document.activeElement?.closest?.('.folder-dialog [data-id]')?.dataset.id;
  current.grid.replaceWith(grid);
  current.grid = grid;
  if (focusedId) grid.querySelector(`[data-id="${CSS.escape(focusedId)}"] .tile-link`)?.focus();
}

export function openFolder(folderId, { rename = false } = {}) {
  if (current) current.dlg.close();
  const folder = store.shortcuts.find((f) => f.id === folderId && M.isFolder(f));
  if (!folder) return;
  const titleIn = h('input', { class: 'folder-title', maxlength: '60', 'aria-label': 'Folder name', autocomplete: 'off', spellcheck: 'false' });
  titleIn.value = folder.title;
  const commit = () => {
    const v = titleIn.value.trim().slice(0, 60);
    const f = folderNow();
    if (!f) return;
    if (!v) titleIn.value = f.title;
    else if (v !== f.title) save(M.update(store.shortcuts, f.id, { title: v }));
  };
  titleIn.addEventListener('change', commit);
  titleIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      titleIn.blur();
    }
  });
  const openBtn = h('button', { type: 'button', class: 'btn small primary' }, icon('newTab', { size: 14 }), h('span', {}, ''));
  openBtn.addEventListener('click', () => {
    const f = folderNow();
    if (f) openAll(f.children, `“${f.title}”`);
  });
  const close = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close folder' }, icon('close', { size: 16 }));
  const grid = h('ul');
  const sheet = h(
    'div',
    { class: 'sheet folder-sheet' },
    h('div', { class: 'folder-head' }, titleIn, openBtn, close),
    grid,
    h('p', { class: 'note folder-hint' }, 'Drag tiles to reorder. Use ⋯ to move a shortcut out of the folder.'),
  );
  const dlg = modal('folder-dialog', sheet, {
    label: `Folder ${folder.title}`,
    onClose: () => {
      commit();
      current?.unsub();
      current = null;
    },
  });
  close.addEventListener('click', () => dlg.close());
  current = { dlg, folderId, grid, titleIn, openBtn, unsub: on('shortcuts', render) };
  render();
  if (rename) {
    titleIn.focus();
    titleIn.select();
  } else {
    current.grid.querySelector('.tile-link')?.focus();
  }
}

export function isFolderOpen() {
  return !!current;
}


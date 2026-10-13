// Read-only view of the user's Chrome bookmarks bar, with folders as nested
// menus. This module never creates, edits, moves or deletes bookmarks.

import { h, clear, debounce } from './dom.js';
import { icon } from '../lib/icons.js';
import { needsTabsApi, openUrl, faviconUrl } from '../lib/url.js';
import { openMenu } from './menu.js';
import { store } from './store.js';
import { toast } from './ui.js';

const bar = document.getElementById('bookmarks-bar');
let roots = { bar: null, other: null, mobile: null };
let listEl;
let overflowBtn;
let hiddenNodes = [];
let started = false;

const OPENABLE = /^(https?|ftp|file|chrome|chrome-extension|about|view-source):/i;

function isOpenable(url) {
  return typeof url === 'string' && OPENABLE.test(url);
}

function favicon(url) {
  const img = h('img', { src: faviconUrl(url, 32), alt: '', width: 16, height: 16, loading: 'lazy' });
  img.addEventListener('error', () => img.replaceWith(icon('globe', { size: 16 })), { once: true });
  return img;
}

function titleOf(node) {
  return node.title || node.url || '(untitled)';
}

// Menu items for a folder's children, built lazily when the menu opens.
function folderItems(node) {
  const children = node.children || [];
  if (!children.length) return [{ empty: '(empty)' }];
  return children.map((c) => {
    if (c.children) {
      return { label: titleOf(c), icon: icon('folder', { size: 16 }), submenu: () => folderItems(c) };
    }
    if (!isOpenable(c.url)) {
      return {
        label: titleOf(c),
        icon: icon('globe', { size: 16 }),
        onSelect: () => toast('Bookmarklets and this type of link can’t run from the New Tab page.', { error: true }),
      };
    }
    return { label: titleOf(c), href: c.url, title: `${titleOf(c)}\n${c.url}`, icon: favicon(c.url) };
  });
}

function linkItem(node) {
  const a = h('a', { class: 'bm-item', href: isOpenable(node.url) ? node.url : null, title: `${titleOf(node)}\n${node.url}`, tabindex: '-1' }, favicon(node.url), node.title ? h('span', {}, node.title) : null);
  if (!node.title) a.setAttribute('aria-label', node.url);
  a.addEventListener('click', (e) => {
    if (!isOpenable(node.url)) {
      e.preventDefault();
      toast('Bookmarklets and this type of link can’t run from the New Tab page.', { error: true });
      return;
    }
    if (needsTabsApi(node.url)) {
      e.preventDefault();
      const newTab = e.ctrlKey || e.metaKey || e.shiftKey;
      openUrl(node.url, { newTab, background: newTab && !e.shiftKey });
    }
  });
  a.addEventListener('auxclick', (e) => {
    if (e.button === 1 && needsTabsApi(node.url) && isOpenable(node.url)) {
      e.preventDefault();
      openUrl(node.url, { newTab: true, background: true });
    }
  });
  return a;
}

function folderButton(node, label = titleOf(node), iconName = 'folder') {
  const btn = h('button', { type: 'button', class: 'bm-item', 'aria-haspopup': 'menu', 'aria-expanded': 'false', tabindex: '-1' }, icon(iconName, { size: 16 }), h('span', {}, label));
  const open = (kb) => openMenu(btn, () => folderItems(node), { label, focusFirst: kb });
  btn.addEventListener('click', (e) => open(e.detail === 0));
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      open(true);
    }
  });
  return btn;
}

function nodeItem(node) {
  return node.children ? folderButton(node) : linkItem(node);
}

function focusables() {
  return [...bar.querySelectorAll('.bm-item')].filter((b) => !b.closest('[hidden]'));
}

function setRoving(target) {
  const items = focusables();
  if (!items.length) return;
  const t = items.includes(target) ? target : items[0];
  for (const i of items) i.tabIndex = i === t ? 0 : -1;
}

function onBarKey(e) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
  const items = focusables();
  const i = items.indexOf(document.activeElement);
  if (i < 0) return;
  e.preventDefault();
  let n = i;
  if (e.key === 'ArrowLeft') n = (i - 1 + items.length) % items.length;
  else if (e.key === 'ArrowRight') n = (i + 1) % items.length;
  else if (e.key === 'Home') n = 0;
  else n = items.length - 1;
  setRoving(items[n]);
  items[n].focus();
}

// Hide items that don't fit and expose them through a "»" menu.
function layoutOverflow() {
  if (!listEl || bar.hidden) return;
  const lis = [...listEl.children];
  for (const li of lis) li.hidden = false;
  overflowBtn.parentElement.hidden = true;
  hiddenNodes = [];
  const avail = listEl.clientWidth;
  if (listEl.scrollWidth <= avail + 1) {
    setRoving(document.activeElement);
    return;
  }
  overflowBtn.parentElement.hidden = false;
  const limit = listEl.clientWidth;
  for (const li of lis) {
    if (li.offsetLeft + li.offsetWidth > limit) {
      li.hidden = true;
      hiddenNodes.push(li._node);
    }
  }
  setRoving(document.activeElement);
}

function findRoots(tree) {
  const top = tree?.[0]?.children || [];
  const by = (type, id) => top.find((n) => n.folderType === type) || top.find((n) => n.id === id) || null;
  return { bar: by('bookmarks-bar', '1') || top[0] || null, other: by('other', '2'), mobile: by('mobile', '3') };
}

async function refresh() {
  try {
    roots = findRoots(await chrome.bookmarks.getTree());
  } catch (err) {
    console.warn('[Sequoia Tab] bookmarks unavailable', err);
    roots = { bar: null, other: null, mobile: null };
  }
  render();
}

function render() {
  clear(bar);
  const children = roots.bar?.children || [];
  listEl = h('ul', { class: 'bm-list', role: 'list' });
  for (const node of children) {
    const li = h('li', {}, nodeItem(node));
    li._node = node;
    listEl.append(li);
  }
  if (!children.length) {
    const manage = h('a', { class: 'bm-item', href: 'chrome://bookmarks', tabindex: '-1' }, h('span', {}, 'Manage bookmarks'));
    manage.addEventListener('click', (e) => {
      e.preventDefault();
      openUrl('chrome://bookmarks');
    });
    listEl.append(h('li', { class: 'bm-empty' }, 'Bookmarks you add to the bookmarks bar appear here.'), h('li', {}, manage));
  }
  overflowBtn = h('button', { type: 'button', class: 'bm-item', 'aria-label': 'More bookmarks', 'aria-haspopup': 'menu', 'aria-expanded': 'false', tabindex: '-1' }, icon('chevronsRight', { size: 16 }));
  overflowBtn.addEventListener('click', (e) =>
    openMenu(overflowBtn, () => folderItems({ children: hiddenNodes }), { label: 'More bookmarks', focusFirst: e.detail === 0 }),
  );
  const overflowWrap = h('div', { class: 'bm-overflow', hidden: true }, overflowBtn);
  const tail = [];
  if (store.settings.bookmarks.showOther) {
    if (roots.other?.children?.length) tail.push(folderButton(roots.other, roots.other.title || 'Other bookmarks'));
    if (roots.mobile?.children?.length) tail.push(folderButton(roots.mobile, roots.mobile.title || 'Mobile bookmarks'));
  }
  bar.append(listEl, overflowWrap, ...tail);
  layoutOverflow();
}

const refreshSoon = debounce(refresh, 150);

export async function initBookmarks() {
  if (started) return;
  started = true;
  bar.addEventListener('keydown', onBarKey);
  bar.addEventListener('focusin', (e) => {
    if (e.target.classList?.contains('bm-item')) setRoving(e.target);
  });
  new ResizeObserver(debounce(layoutOverflow, 60)).observe(bar);
  for (const ev of ['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onChildrenReordered', 'onImportEnded']) {
    chrome.bookmarks[ev]?.addListener(refreshSoon);
  }
  await refresh();
}

export function updateBookmarks() {
  if (started) render();
}

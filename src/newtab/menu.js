// Accessible popup menus with nested submenus (used by bookmarks, shortcut
// options and the search engine picker). Link items are real <a> elements so
// middle-click, Ctrl/Cmd-click and the native context menu keep working.

import { h } from './dom.js';
import { icon } from '../lib/icons.js';
import { needsTabsApi, openUrl } from '../lib/url.js';

let stack = []; // open menus, root first
let rootAnchor = null;
let onRootClose = null;
// Menus opened from inside a modal <dialog> must live in that dialog, or the
// modal would make them inert.
let host = null;

function position(menu, rect, mode) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  menu.style.left = '0px';
  menu.style.top = '0px';
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let x;
  let y;
  if (mode === 'side') {
    x = rect.right + 2;
    if (x + mw > vw - 6) x = rect.left - mw - 2;
    y = rect.top - 5;
  } else if (mode === 'above') {
    x = rect.left;
    y = rect.top - mh - 8;
    if (y < 6) y = rect.bottom + 6;
  } else {
    x = rect.left;
    y = rect.bottom + 6;
    if (y + mh > vh - 6) y = Math.max(6, rect.top - mh - 6);
  }
  x = Math.max(6, Math.min(x, vw - mw - 6));
  y = Math.max(6, Math.min(y, vh - mh - 6));
  menu.style.left = `${Math.round(x)}px`;
  menu.style.top = `${Math.round(y)}px`;
}

function itemsOf(menu) {
  return [...menu.querySelectorAll(':scope > li > .menu-item')];
}

function closeFrom(level) {
  while (stack.length > level) {
    const m = stack.pop();
    m.el.remove();
    if (m.parentItem) m.parentItem.setAttribute('aria-expanded', 'false');
  }
  if (level === 0) {
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('blur', closeAll);
    window.removeEventListener('resize', closeAll);
    if (rootAnchor) rootAnchor.setAttribute('aria-expanded', 'false');
    const cb = onRootClose;
    rootAnchor = null;
    onRootClose = null;
    cb?.();
  }
}

export function closeAll() {
  if (stack.length) closeFrom(0);
}

export function isMenuOpen() {
  return stack.length > 0;
}

function onOutside(e) {
  if (stack.some((m) => m.el.contains(e.target))) return;
  if (rootAnchor && rootAnchor.contains(e.target)) return;
  closeAll();
}

function buildItem(item, level) {
  if (item.sep) return h('li', { role: 'separator', class: 'menu-sep' });
  if (item.empty) return h('li', { class: 'menu-empty', role: 'none' }, item.empty);

  const content = [item.icon || null, h('span', {}, item.label)];
  let el;
  if (item.submenu) {
    content.push(icon('chevronRight', { size: 14 }));
    el = h('button', { type: 'button', class: 'menu-item', role: 'menuitem', 'aria-haspopup': 'menu', 'aria-expanded': 'false', tabindex: '-1' }, content);
    let timer;
    const open = () => openSubmenu(el, item, level);
    el.addEventListener('click', open);
    el.addEventListener('pointerenter', () => {
      clearTimeout(timer);
      timer = setTimeout(open, 110);
    });
    el.addEventListener('pointerleave', () => clearTimeout(timer));
  } else if (item.href) {
    el = h('a', { class: 'menu-item', role: 'menuitem', href: item.href, tabindex: '-1', title: item.title || null }, content);
    el.addEventListener('click', (e) => {
      const newTab = e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1;
      if (needsTabsApi(item.href)) {
        e.preventDefault();
        openUrl(item.href, { newTab, background: newTab && !e.shiftKey });
      }
      if (!newTab) closeAll();
    });
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1 && needsTabsApi(item.href)) {
        e.preventDefault();
        openUrl(item.href, { newTab: true, background: true });
      }
    });
  } else {
    const attrs = { type: 'button', class: 'menu-item' + (item.danger ? ' danger' : ''), tabindex: '-1' };
    if (item.checked !== undefined) {
      attrs.role = 'menuitemradio';
      attrs['aria-checked'] = String(!!item.checked);
    } else {
      attrs.role = 'menuitem';
    }
    el = h('button', attrs, content);
    el.addEventListener('click', () => {
      closeAll();
      item.onSelect?.();
    });
  }
  // Hovering a sibling closes deeper submenus.
  el.addEventListener('pointerenter', () => {
    if (!item.submenu && stack.length > level + 1) closeFrom(level + 1);
    el.focus({ preventScroll: true });
  });
  return h('li', { role: 'none' }, el);
}

function render(items, level, label) {
  const ul = h('ul', { class: 'menu', role: 'menu', 'aria-label': label || 'Menu', tabindex: '-1' });
  const list = typeof items === 'function' ? items() : items;
  if (!list.length) ul.append(h('li', { class: 'menu-empty', role: 'none' }, '(empty)'));
  for (const item of list) ul.append(buildItem(item, level));
  ul.addEventListener('keydown', (e) => onKey(e, level));
  (host || document.body).append(ul);
  return ul;
}

function openSubmenu(parentItem, item, level) {
  if (stack[level + 1]?.parentItem === parentItem) return stack[level + 1];
  closeFrom(level + 1);
  const el = render(item.submenu, level + 1, item.label);
  position(el, parentItem.getBoundingClientRect(), 'side');
  parentItem.setAttribute('aria-expanded', 'true');
  const entry = { el, parentItem };
  stack.push(entry);
  return entry;
}

function onKey(e, level) {
  const menu = stack[level]?.el;
  if (!menu) return;
  const items = itemsOf(menu);
  const i = items.indexOf(document.activeElement);
  const focusAt = (n) => items[(n + items.length) % items.length]?.focus();
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      focusAt(i + 1);
      break;
    case 'ArrowUp':
      e.preventDefault();
      focusAt(i < 0 ? -1 : i - 1);
      break;
    case 'Home':
      e.preventDefault();
      focusAt(0);
      break;
    case 'End':
      e.preventDefault();
      focusAt(-1);
      break;
    case 'ArrowRight': {
      const cur = items[i];
      if (cur?.getAttribute('aria-haspopup') === 'menu') {
        e.preventDefault();
        cur.click();
        stack[level + 1] && itemsOf(stack[level + 1].el)[0]?.focus();
      }
      break;
    }
    case 'ArrowLeft':
      if (level > 0) {
        e.preventDefault();
        const parent = stack[level].parentItem;
        closeFrom(level);
        parent.focus();
      }
      break;
    case 'Escape': {
      e.preventDefault();
      e.stopPropagation();
      if (level > 0) {
        const parent = stack[level].parentItem;
        closeFrom(level);
        parent.focus();
      } else {
        const anchor = rootAnchor;
        closeAll();
        anchor?.focus();
      }
      break;
    }
    case 'Tab':
      closeAll();
      break;
    default:
      // Type-ahead: jump to the first item starting with the typed letter.
      if (e.key.length === 1 && /\S/.test(e.key)) {
        const k = e.key.toLowerCase();
        const start = i + 1;
        for (let n = 0; n < items.length; n++) {
          const it = items[(start + n) % items.length];
          if (it.textContent.trim().toLowerCase().startsWith(k)) {
            it.focus();
            break;
          }
        }
      }
  }
}

// Open a root menu next to `anchor`. Pass `focusFirst` when opened by keyboard.
export function openMenu(anchor, items, { label, placement = 'below', focusFirst = false, onClose } = {}) {
  const wasSame = rootAnchor === anchor;
  closeAll();
  if (wasSame) return; // clicking the trigger again toggles it closed
  host = (anchor instanceof Element && anchor.closest('dialog[open]')) || document.body;
  const el = render(items, 0, label);
  position(el, anchor.getBoundingClientRect(), placement);
  stack.push({ el, parentItem: null });
  rootAnchor = anchor;
  onRootClose = onClose || null;
  anchor.setAttribute('aria-expanded', 'true');
  document.addEventListener('pointerdown', onOutside, true);
  window.addEventListener('blur', closeAll);
  window.addEventListener('resize', closeAll);
  if (focusFirst) itemsOf(el)[0]?.focus();
  else el.focus({ preventScroll: true });
}

// Open a menu at the pointer (context menu).
export function openMenuAt(x, y, items, opts = {}) {
  const fake = { getBoundingClientRect: () => ({ left: x, right: x, top: y - 6, bottom: y - 6, width: 0, height: 0 }), setAttribute() {}, contains: () => false, focus() {} };
  openMenu(fake, items, opts);
}

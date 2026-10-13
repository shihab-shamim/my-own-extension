// macOS-style dock with magnification and optional auto-hide.

import { h, clear } from './dom.js';
import { icon, DOCK_GLYPH_COLORS } from '../lib/icons.js';
import { needsTabsApi, openUrl } from '../lib/url.js';
import { siteIcon } from './shortcuts.js';
import { store } from './store.js';

const dock = document.getElementById('dock');
let hotzone = null;
let onCustomize = () => {};
let hideTimer = null;

export function appFace(item, extraClass = '') {
  if (item.glyph && DOCK_GLYPH_COLORS[item.glyph]) {
    const [a, b] = DOCK_GLYPH_COLORS[item.glyph];
    return h('span', { class: 'app-face ' + extraClass, style: { background: `linear-gradient(160deg, ${a}, ${b})` } }, icon(item.glyph, { size: 24 }));
  }
  return h('span', { class: 'app-face site ' + extraClass }, siteIcon(item, 64));
}

function appItem(item) {
  const a = h('a', { class: 'dock-app', href: item.url, 'aria-label': item.title, draggable: 'false' }, appFace(item), h('span', { class: 'dock-tip', 'aria-hidden': 'true' }, item.title));
  a.addEventListener('click', (e) => {
    if (needsTabsApi(item.url)) {
      e.preventDefault();
      const newTab = e.ctrlKey || e.metaKey || e.shiftKey;
      openUrl(item.url, { newTab, background: newTab && !e.shiftKey });
    }
  });
  a.addEventListener('auxclick', (e) => {
    if (e.button === 1 && needsTabsApi(item.url)) {
      e.preventDefault();
      openUrl(item.url, { newTab: true, background: true });
    }
  });
  return h('li', { class: 'dock-item' }, a);
}

function magnify(e) {
  const s = store.settings.dock;
  if (!s.magnify || document.documentElement.dataset.motion === 'none') return;
  const vertical = s.position !== 'bottom';
  const size = s.iconSize;
  const range = size * 2.6;
  dock.classList.add('magnifying');
  for (const app of dock.querySelectorAll('.dock-app')) {
    const r = app.getBoundingClientRect();
    const center = vertical ? r.top + r.height / 2 : r.left + r.width / 2;
    const d = Math.abs((vertical ? e.clientY : e.clientX) - center);
    const scale = 1 + 0.5 * Math.max(0, Math.cos(Math.min(d / range, 1) * (Math.PI / 2)));
    app.style.setProperty('--s', scale.toFixed(3));
  }
}

function resetMagnify() {
  dock.classList.remove('magnifying');
  for (const app of dock.querySelectorAll('.dock-app')) app.style.setProperty('--s', '1');
}

function reveal() {
  clearTimeout(hideTimer);
  dock.classList.add('revealed');
}

function hideSoon() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (!dock.matches(':hover') && !dock.contains(document.activeElement)) dock.classList.remove('revealed');
  }, 500);
}

export function initDock(openSettings) {
  onCustomize = openSettings;
  dock.addEventListener('pointermove', magnify);
  dock.addEventListener('pointerleave', () => {
    resetMagnify();
    if (store.settings.dock.autohide) hideSoon();
  });
  dock.addEventListener('focusin', reveal);
  dock.addEventListener('focusout', () => store.settings.dock.autohide && hideSoon());
  hotzone = h('div', { class: 'dock-hotzone', 'aria-hidden': 'true' });
  hotzone.addEventListener('pointerenter', reveal);
  document.body.append(hotzone);
  renderDock();
}

export function renderDock() {
  const s = store.settings.dock;
  const visible = store.settings.widgets.visible.dock;
  dock.hidden = !visible;
  hotzone.hidden = !visible || !s.autohide;
  document.documentElement.dataset.dock = visible && !s.autohide ? s.position : 'none';
  document.documentElement.style.setProperty('--dock-icon', `${s.iconSize}px`);
  dock.dataset.pos = s.position;
  dock.dataset.autohide = String(!!s.autohide);
  hotzone.dataset.pos = s.position;
  if (!s.autohide) dock.classList.remove('revealed');
  dock.classList.add('glass');

  const ul = h('ul', { role: 'list' });
  for (const item of store.dock) ul.append(appItem(item));
  if (store.dock.length) ul.append(h('li', { class: 'dock-sep', role: 'separator', 'aria-hidden': 'true' }));
  const customize = h(
    'button',
    { type: 'button', class: 'dock-app', 'aria-label': 'Customize New Tab' },
    h('span', { class: 'app-face customize' }, icon('gear', { size: 24 })),
    h('span', { class: 'dock-tip', 'aria-hidden': 'true' }, 'Customize'),
  );
  customize.addEventListener('click', () => onCustomize());
  ul.append(h('li', { class: 'dock-item' }, customize));
  clear(dock).append(ul);
}

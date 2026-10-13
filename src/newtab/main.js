// New Tab entry point: loads state, renders widgets, and keeps everything in
// sync with settings changes from this or other tabs.

import { h } from './dom.js';
import { icon } from '../lib/icons.js';
import { nextDueAt } from '../lib/rotation.js';
import { store, load, on } from './store.js';
import { showWallpaper, applyEffects, preloadNext, saveBootExtras, forceRedraw, keyOf } from './wallpaper-view.js';
import { initClock, updateClock } from './clock.js';
import { initSearch, updateSearch, focusSearch } from './search.js';
import { renderShortcuts, layoutColumns } from './shortcuts.js';
import { initBookmarks, updateBookmarks } from './bookmarks.js';
import { initDock, renderDock } from './dock.js';
import { renderAttribution } from './attribution.js';
import { openSettings } from './settings.js';
import { checkWallpaper } from './bridge.js';
import { toast } from './ui.js';
import { closeAll } from './menu.js';

const root = document.documentElement;
const stage = document.getElementById('stage');
const media = {
  dark: window.matchMedia('(prefers-color-scheme: dark)'),
  reduce: window.matchMedia('(prefers-reduced-motion: reduce)'),
};

function applyAppearance() {
  const a = store.settings.appearance;
  const theme = a.theme === 'auto' ? (media.dark.matches ? 'dark' : 'light') : a.theme;
  root.dataset.theme = theme;
  const reduce = a.reducedMotion === 'always' || media.reduce.matches;
  root.dataset.motion = reduce ? 'none' : a.animation;
  const t = Math.max(0, Math.min(100, a.transparency)) / 100;
  const vars = {
    '--radius': `${Math.max(0, Math.min(32, a.radius))}px`,
    // Light glass needs more opacity to keep dark text readable.
    '--glass-alpha': Math.min(0.95, 0.92 - t * 0.85 + (theme === 'light' ? 0.14 : 0)).toFixed(3),
    '--panel-alpha': (0.97 - t * 0.35).toFixed(3),
    '--glass-blur': `${Math.round(12 + t * 24)}px`,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  saveBootExtras({ theme, vars });
}

function applyLayout() {
  const w = store.settings.widgets;
  stage.dataset.align = w.align;
  for (const id of w.order) {
    const sec = document.getElementById(`w-${id}`);
    stage.append(sec); // re-append in configured order
    sec.hidden = !w.visible[id];
  }
  document.getElementById('bookmarks-bar').hidden = !w.visible.bookmarks;
}

let dueTimer = null;
function scheduleDueCheck() {
  clearTimeout(dueTimer);
  if (document.hidden || !store.wallpaper) return;
  const at = nextDueAt(store.settings, store.wallpaper);
  if (!at) return;
  const delay = Math.max(1000, Math.min(at - Date.now() + 250, 2 ** 31 - 1));
  dueTimer = setTimeout(() => checkWallpaper(), delay);
}

let lastFailedKey = null;
async function syncWallpaper({ instant = false } = {}) {
  const cur = store.wallpaper?.current;
  if (!cur) return;
  const res = await showWallpaper(cur, { instant });
  if (res.ok || res.superseded) {
    lastFailedKey = null;
  } else if (keyOf(cur) !== lastFailedKey) {
    lastFailedKey = keyOf(cur);
    toast(navigator.onLine ? 'The wallpaper couldn’t be loaded. Showing the previous one.' : 'You’re offline — the new wallpaper will load when you reconnect.', { error: true });
  }
  renderAttribution();
  preloadNext(store.wallpaper);
  scheduleDueCheck();
}

function cornerActions() {
  const btn = h('button', { type: 'button', class: 'round-btn glass', 'aria-label': 'Customize New Tab', title: 'Customize' }, icon('gear', { size: 17 }));
  btn.addEventListener('click', () => openSettings());
  document.getElementById('corner-actions').append(btn);
}

async function main() {
  await load();
  applyAppearance();
  applyEffects(store.settings);
  applyLayout();

  // Show the stored wallpaper right away, then ask the worker if it's due.
  syncWallpaper({ instant: true });
  checkWallpaper();

  initClock(store.settings);
  initSearch();
  renderShortcuts();
  initDock(() => openSettings());
  cornerActions();
  if (store.settings.widgets.visible.bookmarks) initBookmarks();
  renderAttribution();

  if (store.settings.search.autofocus) focusSearch();
  for (const sec of stage.children) sec.classList.add('anim-in');

  // Re-render only the parts whose settings actually changed, so dragging a
  // slider doesn't rebuild every widget.
  const slices = {
    clock: (s) => s.clock,
    search: (s) => s.search,
    shortcuts: (s) => s.shortcuts,
    dock: (s) => [s.dock, s.widgets.visible.dock],
    bookmarks: (s) => [s.bookmarks, s.widgets.visible.bookmarks],
    attribution: (s) => [s.widgets.visible.attribution, s.wallpaper.interval, s.wallpaper.paused, s.wallpaper.source],
  };
  const snap = () => Object.fromEntries(Object.entries(slices).map(([k, f]) => [k, JSON.stringify(f(store.settings))]));
  let prev = snap();
  on('settings', () => {
    const next = snap();
    const changed = (k) => next[k] !== prev[k];
    applyAppearance();
    applyEffects(store.settings);
    applyLayout();
    if (changed('clock')) updateClock(store.settings);
    if (changed('search')) updateSearch();
    if (changed('shortcuts')) renderShortcuts();
    if (changed('dock')) renderDock();
    if (changed('bookmarks') && store.settings.widgets.visible.bookmarks) initBookmarks().then(updateBookmarks);
    if (changed('attribution')) renderAttribution();
    scheduleDueCheck();
    prev = next;
  });
  on('shortcuts', renderShortcuts);
  on('dock', renderDock);
  on('favorites', renderAttribution);
  on('wallpaper', () => syncWallpaper());

  media.dark.addEventListener('change', applyAppearance);
  media.reduce.addEventListener('change', applyAppearance);
  window.addEventListener('resize', layoutColumns);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearTimeout(dueTimer);
      closeAll();
    } else {
      checkWallpaper();
      scheduleDueCheck();
    }
  });
  window.addEventListener('online', () => {
    if (lastFailedKey) {
      forceRedraw();
      syncWallpaper();
    }
    checkWallpaper();
  });
}

main().catch((err) => {
  console.error('[Sequoia Tab] failed to start', err);
  document.body.append(h('p', { class: 'toast glass', style: { position: 'fixed', top: '20px', left: '20px' } }, 'Sequoia Tab couldn’t start. Try reloading the page.'));
});

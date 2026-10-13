// Side panel entry point: the same to-do list as the New Tab page, shown in
// Chrome's side panel so it stays open on every site. Data is shared through
// chrome.storage, so both views update each other live.

import { store, load, on } from '../newtab/store.js';
import { initTodo, hideOverlay } from '../newtab/todo.js';

const root = document.documentElement;
const media = {
  dark: window.matchMedia('(prefers-color-scheme: dark)'),
  reduce: window.matchMedia('(prefers-reduced-motion: reduce)'),
};

function applyTheme() {
  const a = store.settings.appearance;
  root.dataset.theme = a.theme === 'auto' ? (media.dark.matches ? 'dark' : 'light') : a.theme;
  root.dataset.motion = a.reducedMotion === 'always' || media.reduce.matches ? 'none' : a.animation;
  root.style.setProperty('--radius', `${Math.max(0, Math.min(32, a.radius))}px`);
}

// Tell the service worker this window has the panel open, so the toolbar
// button / Ctrl+Shift+Y can close it. Reconnects if the worker restarts.
let windowId = null;
function connectToWorker() {
  let port;
  try {
    port = chrome.runtime.connect({ name: 'sidepanel' });
  } catch {
    return; // extension is reloading
  }
  if (windowId != null) port.postMessage({ type: 'hello', windowId });
  port.onMessage.addListener((msg) => {
    if (msg?.type === 'close') window.close();
  });
  port.onDisconnect.addListener(() => setTimeout(connectToWorker, 100));
  return port;
}

// ?overlay=1: floating over a web page (see src/overlay.js) instead of in the side panel.
const overlay = new URLSearchParams(location.search).has('overlay');

function setupOverlay() {
  root.dataset.overlay = '1';
  // Esc hides the floating list (menus/editing handle their own Esc first).
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      hideOverlay();
    }
  });
  // When it slides in again, put the cursor in the "Add a task" box.
  window.addEventListener('message', (e) => {
    if (e.source === window.parent && e.data?.type === 'sequoia:shown') document.querySelector('.todo-input')?.focus();
  });
}

async function main() {
  if (overlay) setupOverlay();
  windowId = (await chrome.windows.getCurrent()).id;
  // Only the real side panel registers (opened as a normal tab, getCurrent() returns a tab).
  if (!(await chrome.tabs.getCurrent())) connectToWorker();
  await load();
  applyTheme();
  initTodo({ panel: true, overlay });
  on('settings', applyTheme);
  media.dark.addEventListener('change', applyTheme);
  media.reduce.addEventListener('change', applyTheme);
}

main().catch((err) => {
  console.error('[Sequoia Tab] side panel failed to start', err);
  document.body.append(Object.assign(document.createElement('p'), { textContent: 'The to-do list couldn’t load. Close and reopen the side panel.', className: 'panel-error' }));
});

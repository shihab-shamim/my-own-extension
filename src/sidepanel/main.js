// Side panel entry point: the same to-do list as the New Tab page, shown in
// Chrome's side panel so it stays open on every site. Data is shared through
// chrome.storage, so both views update each other live.

import { store, load, on } from '../newtab/store.js';
import { initTodo } from '../newtab/todo.js';

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

async function main() {
  await load();
  applyTheme();
  initTodo({ panel: true });
  on('settings', applyTheme);
  media.dark.addEventListener('change', applyTheme);
  media.reduce.addEventListener('change', applyTheme);
}

main().catch((err) => {
  console.error('[Sequoia Tab] side panel failed to start', err);
  document.body.append(Object.assign(document.createElement('p'), { textContent: 'The to-do list couldn’t load. Close and reopen the side panel.', className: 'panel-error' }));
});

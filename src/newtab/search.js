// Search box. "Chrome default" uses chrome.search, which always honours the
// search engine the user configured in Chrome settings.

import { h, clear } from './dom.js';
import { icon } from '../lib/icons.js';
import { SEARCH_ENGINES } from '../lib/defaults.js';
import { looksLikeUrl, normalizeUrl, openUrl, faviconUrl } from '../lib/url.js';
import { openMenu } from './menu.js';
import { store, updateSettings } from './store.js';
import { toast } from './ui.js';

const el = document.getElementById('w-search');
let input;
let engineBtn;

export function validCustomTemplate(t) {
  if (typeof t !== 'string' || !t.includes('%s')) return false;
  try {
    const u = new URL(t.replace('%s', 'test'));
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function engine() {
  const s = store.settings.search;
  const e = SEARCH_ENGINES.find((x) => x.id === s.engine) || SEARCH_ENGINES[0];
  if (e.id === 'custom') {
    return validCustomTemplate(s.customUrl)
      ? { ...e, url: s.customUrl, label: (() => { try { return new URL(s.customUrl.replace('%s', 'x')).hostname.replace(/^www\./, ''); } catch { return 'Custom'; } })() }
      : SEARCH_ENGINES[1];
  }
  return e;
}

function engineIcon(e) {
  if (!e.url) return icon('search', { size: 18 });
  const home = new URL(e.url.replace('%s', '')).origin;
  return h('img', { src: faviconUrl(home, 32), alt: '', width: 18, height: 18 });
}

function renderEngineBtn() {
  const e = engine();
  clear(engineBtn).append(engineIcon(e), icon('chevronDown', { size: 12 }));
  engineBtn.setAttribute('aria-label', `Search engine: ${e.label}. Change`);
  engineBtn.title = `Searching with ${e.label}`;
  input.placeholder = e.id === 'default' ? 'Search the web or type a URL' : `Search ${e.label} or type a URL`;
}

async function submit(text, newTab) {
  const q = text.trim();
  if (!q) return;
  if (looksLikeUrl(q)) {
    const url = normalizeUrl(q);
    if (url) return openUrl(url, { newTab });
  }
  const e = engine();
  if (e.id === 'default') {
    try {
      await chrome.search.query({ text: q, disposition: newTab ? 'NEW_TAB' : 'CURRENT_TAB' });
    } catch (err) {
      toast('Chrome search is unavailable; using Google instead.', { error: true });
      openUrl(SEARCH_ENGINES[1].url.replace('%s', encodeURIComponent(q)), { newTab });
    }
    return;
  }
  openUrl(e.url.replace('%s', encodeURIComponent(q)), { newTab });
}

export function initSearch() {
  input = h('input', {
    id: 'search-input',
    class: 'search-input',
    type: 'search',
    name: 'q',
    autocomplete: 'off',
    spellcheck: 'false',
    enterkeyhint: 'search',
    'aria-label': 'Search or enter address',
    maxlength: '2048',
  });
  engineBtn = h('button', { type: 'button', class: 'search-engine-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
  const submitBtn = h('button', { type: 'submit', class: 'search-submit', 'aria-label': 'Search' }, icon('search', { size: 18 }));
  const form = h('form', { class: 'search-form glass', novalidate: true }, engineBtn, input, submitBtn);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit(input.value, false);
  });
  input.addEventListener('keydown', (e) => {
    // Alt+Enter opens in a new tab, like the omnibox.
    if (e.key === 'Enter' && (e.altKey || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit(input.value, true);
    } else if (e.key === 'Escape' && input.value) {
      input.value = '';
    } else if (e.key === 'Escape') {
      input.blur();
    }
  });
  const openEngines = (focusFirst) =>
    openMenu(
      engineBtn,
      SEARCH_ENGINES.filter((x) => x.id !== 'custom' || validCustomTemplate(store.settings.search.customUrl)).map((x) => ({
        label: x.id === 'custom' ? engine().label : x.label,
        icon: engineIcon(x.id === 'custom' ? engine() : x),
        checked: store.settings.search.engine === x.id,
        onSelect: () => {
          updateSettings((s) => (s.search.engine = x.id));
          input.focus();
        },
      })),
      { label: 'Search engine', focusFirst },
    );
  engineBtn.addEventListener('click', (e) => openEngines(e.detail === 0));
  engineBtn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      openEngines(true);
    }
  });
  clear(el).append(form);
  renderEngineBtn();

  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t?.isContentEditable) return;
    if (document.querySelector('dialog[open]') || el.hidden) return;
    e.preventDefault();
    input.focus();
  });
}

export function updateSearch() {
  if (input) renderEngineBtn();
}

export function focusSearch() {
  if (input && !document.getElementById('w-search').hidden) input.focus({ preventScroll: true });
}

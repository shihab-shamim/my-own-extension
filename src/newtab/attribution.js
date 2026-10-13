// Bottom-left wallpaper info: Unsplash attribution (required by the API
// guidelines), status messages, and quick controls.

import { h, clear } from './dom.js';
import { icon } from '../lib/icons.js';
import { withUtm } from '../lib/unsplash.js';
import { presetById } from '../lib/presets.js';
import { ROTATION_INTERVALS } from '../lib/defaults.js';
import { store, updateSettings, saveFavorites } from './store.js';
import { nextWallpaper } from './bridge.js';
import { toast } from './ui.js';
import { getWallpaper } from '../lib/idb.js';

const el = document.getElementById('attribution');
const SELF_HEALING = new Set(['rate-limited', 'offline', 'http']);
let busy = false;

function link(text, href) {
  return h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
}

async function describe(cur) {
  switch (cur?.kind) {
    case 'unsplash': {
      const p = cur.photo;
      return ['Photo by ', link(p.author, withUtm(p.authorUrl)), ' on ', link('Unsplash', withUtm('https://unsplash.com/'))];
    }
    case 'upload': {
      const rec = await getWallpaper(cur.id).catch(() => null);
      return [rec?.name ? `My Photos · ${rec.name}` : 'My Photos'];
    }
    case 'gradient':
      return ['Gradient'];
    case 'color':
      return ['Solid color'];
    case 'preset':
      return [`${presetById(cur.id).name} · Built-in`];
    default:
      return [''];
  }
}

function roundBtn(name, label, onClick, { filled = false, ...attrs } = {}) {
  const b = h('button', { type: 'button', class: 'round-btn glass', 'aria-label': label, title: label, ...attrs }, icon(name, { size: 16, filled }));
  b.addEventListener('click', onClick);
  return b;
}

export async function renderAttribution() {
  const visible = store.settings.widgets.visible.attribution;
  const cur = store.wallpaper?.current;
  // Unsplash requires attribution, so it stays visible for Unsplash photos —
  // unless the user explicitly turned the credit off in Settings.
  const credit = store.settings.wallpaper.showCredit !== false;
  const mustShow = cur?.kind === 'unsplash' && credit;
  el.hidden = !visible && !mustShow;
  if (el.hidden) return;

  const w = store.settings.wallpaper;
  const status = store.wallpaper?.status;
  const textParts = cur?.kind === 'unsplash' && !credit ? [] : await describe(cur);
  const controls = [];
  if (visible) {
    const next = roundBtn('refresh', 'Next wallpaper', onNext);
    if (busy) next.classList.add('spinning');
    controls.push(next);
    const rotating = w.interval !== 'off' && !['gradient', 'color'].includes(w.source);
    if (rotating) {
      controls.push(
        roundBtn(w.paused ? 'play' : 'pause', w.paused ? 'Resume rotation' : 'Pause rotation', () =>
          updateSettings((s) => (s.wallpaper.paused = !s.wallpaper.paused), { immediate: true }).then(() =>
            toast(store.settings.wallpaper.paused ? 'Wallpaper rotation paused.' : `Rotation resumed (${ROTATION_INTERVALS.find((r) => r.id === w.interval)?.label.toLowerCase()}).`),
          ),
        ),
      );
    }
    if (cur?.kind === 'unsplash') {
      const isFav = store.favorites.some((f) => f.id === cur.photo.id);
      controls.push(
        roundBtn('heart', isFav ? 'Remove from favorites' : 'Add to favorites', () => toggleFavorite(cur.photo), {
          'aria-pressed': String(isFav),
          filled: isFav,
        }),
      );
    }
  }
  const text = h('div', { class: 'attrib' }, textParts);
  // Only show problems you need to act on (missing/wrong key, no photos).
  // Rate limits, offline and server hiccups fix themselves, so they stay quiet
  // here; Settings → Wallpaper still shows them.
  if (status?.state === 'error' && status.message && !SELF_HEALING.has(status.code)) {
    text.append(h('br'), h('span', { class: 'status', role: 'status' }, status.message));
  }
  clear(el).append(...controls, text);
}

async function onNext() {
  if (busy) return;
  busy = true;
  renderAttribution();
  const res = await nextWallpaper();
  busy = false;
  renderAttribution();
  if (res?.error && typeof res.error === 'string') toast('Could not change the wallpaper.', { error: true });
  else if (res?.error?.message) toast(res.error.message, { error: true });
}

function toggleFavorite(photo) {
  const favs = store.favorites.slice();
  const i = favs.findIndex((f) => f.id === photo.id);
  if (i >= 0) {
    favs.splice(i, 1);
    toast('Removed from favorites.');
  } else {
    favs.unshift(photo);
    if (favs.length > 200) favs.length = 200;
    toast('Added to favorites.');
  }
  saveFavorites(favs);
}

export function isBusy() {
  return busy;
}

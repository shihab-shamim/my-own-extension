// Renders the current wallpaper with a crossfade, detects its brightness so
// text stays readable, and keeps a tiny snapshot for flash-free startup.

import { presetById, gradientCss, toneForHex, toneForRgb, mixHex, isHexColor } from '../lib/presets.js';
import { sizedImageUrl } from '../lib/unsplash.js';
import { getWallpaper } from '../lib/idb.js';
import { clear } from './dom.js';

const root = document.documentElement;
const layers = [...document.querySelectorAll('.wall-layer')];
let activeIndex = -1;
let displayedKey = null;
let renderToken = 0;
let currentObjectUrl = null;
let detectedTone = 'dark';
let textToneSetting = 'auto';
const listeners = new Set();

export function onWallpaperShown(fn) {
  listeners.add(fn);
}

function targetWidth() {
  return Math.round(Math.max(window.screen.width, window.innerWidth) * Math.min(window.devicePixelRatio || 1, 2));
}

export function keyOf(cur) {
  if (!cur) return 'none';
  switch (cur.kind) {
    case 'unsplash':
      return 'u:' + cur.photo?.id;
    case 'upload':
      return 'f:' + cur.id;
    case 'preset':
      return 'p:' + cur.id;
    case 'gradient':
      return 'g:' + cur.css;
    case 'color':
      return 'c:' + cur.color;
    default:
      return 'x';
  }
}

export function applyEffects(settings) {
  const w = settings.wallpaper;
  root.style.setProperty('--overlay', String(Math.max(0, Math.min(80, w.overlay)) / 100));
  root.style.setProperty('--wall-blur', `${Math.max(0, Math.min(40, w.blur))}px`);
  document.getElementById('wallpaper').classList.toggle('blurred', w.blur > 0);
  textToneSetting = settings.appearance.textTone;
  applyTone();
}

function applyTone() {
  const tone = textToneSetting === 'auto' ? detectedTone : textToneSetting;
  root.dataset.tone = tone;
}

export function currentTone() {
  return root.dataset.tone || 'dark';
}

// Average luminance of the area behind the clock/search (center band).
function sampleTone(img) {
  try {
    const c = document.createElement('canvas');
    c.width = 48;
    c.height = 27;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 48, 27);
    const data = ctx.getImageData(10, 4, 28, 14).data;
    let r = 0;
    let g = 0;
    let b = 0;
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    return toneForRgb([r / n, g / n, b / n]);
  } catch {
    return null; // tainted canvas (no CORS) -> caller uses a fallback
  }
}

function loadImage(src, cors) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.alt = '';
    const timer = setTimeout(() => reject(new Error('timeout')), 20000);
    img.onload = () => {
      clearTimeout(timer);
      // decode() avoids jank on visible tabs, but can stall in background
      // tabs, so don't wait on it for long.
      const done = () => resolve(img);
      Promise.race([img.decode(), new Promise((r) => setTimeout(r, 800))]).then(done, done);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error('load failed'));
    };
    img.src = src;
  });
}

async function loadWithCorsFallback(src) {
  try {
    return await loadImage(src, true);
  } catch {
    return loadImage(src, false);
  }
}

// Build the visual for a wallpaper description. Resolves to
// { node|css, color, tone, bootBg } or throws if an image fails to load.
async function prepare(cur) {
  switch (cur?.kind) {
    case 'unsplash': {
      const p = cur.photo;
      const src = sizedImageUrl(p.raw, targetWidth());
      const img = await loadWithCorsFallback(src);
      const tone = sampleTone(img) || toneForHex(p.color);
      return { img, color: p.color, tone, bootBg: `url("${src.replace(/"/g, '%22')}")` };
    }
    case 'upload': {
      const rec = await getWallpaper(cur.id);
      if (!rec?.blob) throw new Error('missing upload');
      const url = URL.createObjectURL(rec.blob);
      try {
        const img = await loadImage(url, false);
        const tone = sampleTone(img) || rec.tone || 'dark';
        return { img, color: rec.color || '#222222', tone, objectUrl: url, bootBg: '' };
      } catch (err) {
        URL.revokeObjectURL(url);
        throw err;
      }
    }
    case 'gradient': {
      const css = typeof cur.css === 'string' && cur.css.startsWith('linear-gradient(') ? cur.css : gradientCss(cur);
      const color = isHexColor(cur.from) && isHexColor(cur.to) ? mixHex(cur.from, cur.to) : '#444444';
      return { css, color, tone: toneForHex(color), bootBg: css };
    }
    case 'color': {
      const color = isHexColor(cur.color) ? cur.color : '#1f2933';
      return { css: color, color, tone: toneForHex(color), bootBg: 'none' };
    }
    case 'preset':
    default: {
      const p = presetById(cur?.id);
      return { css: p.css, color: p.color, tone: p.tone, bootBg: p.css };
    }
  }
}

function paint(layer, visual) {
  clear(layer);
  layer.style.backgroundImage = '';
  layer.style.backgroundColor = visual.color || '';
  if (visual.img) {
    visual.img.className = 'wall-img';
    layer.append(visual.img);
  } else if (visual.css && visual.css.includes('gradient(')) {
    layer.style.backgroundImage = visual.css;
  } else if (visual.css) {
    layer.style.backgroundColor = visual.css;
  }
}

function saveBoot(visual, extra) {
  try {
    const prev = JSON.parse(localStorage.getItem('sequoia:boot') || '{}');
    localStorage.setItem(
      'sequoia:boot',
      JSON.stringify({ ...prev, color: visual.color, bg: visual.bootBg || 'none', tone: root.dataset.tone, ...extra }),
    );
  } catch {
    /* storage disabled */
  }
}

export function saveBootExtras(extra) {
  try {
    const prev = JSON.parse(localStorage.getItem('sequoia:boot') || '{}');
    localStorage.setItem('sequoia:boot', JSON.stringify({ ...prev, ...extra }));
  } catch {
    /* ignore */
  }
}

// Show `cur`. Returns { ok, error } so callers can surface failures.
export async function showWallpaper(cur, { instant = false } = {}) {
  const key = keyOf(cur);
  if (key === displayedKey) return { ok: true, unchanged: true };
  const token = ++renderToken;
  document.getElementById('wallpaper').setAttribute('aria-busy', 'true');
  let visual;
  let error = null;
  try {
    visual = await prepare(cur);
  } catch (err) {
    error = err;
    if (displayedKey !== null) {
      document.getElementById('wallpaper').removeAttribute('aria-busy');
      return { ok: false, error };
    }
    // Nothing on screen yet: use a built-in so the page never stays blank.
    visual = await prepare({ kind: 'preset', id: 'sequoia' });
  }
  if (token !== renderToken) {
    if (visual.objectUrl) URL.revokeObjectURL(visual.objectUrl);
    return { ok: false, superseded: true };
  }
  const nextIndex = activeIndex === 0 ? 1 : 0;
  const next = layers[nextIndex];
  const prev = layers[activeIndex];
  if (instant) next.style.transition = 'none';
  paint(next, visual);
  // Force style flush so the opacity transition runs.
  void next.offsetWidth;
  next.classList.add('is-active');
  prev?.classList.remove('is-active');
  if (instant) requestAnimationFrame(() => (next.style.transition = ''));
  activeIndex = nextIndex;
  displayedKey = error ? 'p:sequoia' : key;

  const oldUrl = currentObjectUrl;
  currentObjectUrl = visual.objectUrl || null;
  setTimeout(() => {
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    if (prev && !prev.classList.contains('is-active')) {
      clear(prev);
      prev.style.backgroundImage = '';
    }
  }, 1500);

  detectedTone = visual.tone || 'dark';
  applyTone();
  root.style.setProperty('--boot-color', visual.color || '#1c1c1e');
  saveBoot(visual);
  document.getElementById('wallpaper').removeAttribute('aria-busy');
  for (const fn of listeners) fn(cur);
  return error ? { ok: false, error, fellBack: true } : { ok: true };
}

export function forceRedraw() {
  displayedKey = null;
}

// Warm the HTTP cache with the next queued Unsplash photo so the next
// rotation is instant (and works briefly offline).
let lastPreloaded = '';
export function preloadNext(state) {
  const next = state?.queue?.[0];
  if (!next?.raw) return;
  const src = sizedImageUrl(next.raw, targetWidth());
  if (src === lastPreloaded) return;
  lastPreloaded = src;
  const run = () => loadWithCorsFallback(src).catch(() => (lastPreloaded = ''));
  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 5000 });
  else setTimeout(run, 1500);
}


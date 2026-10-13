// Site icons from Chrome's local favicon cache, with a coloured letter
// fallback when no real favicon is available.

import { h } from './dom.js';
import { faviconUrl, hostOf } from '../lib/url.js';

const LETTER_COLORS = ['#ff6b6b', '#f59f00', '#37b24d', '#1c7ed6', '#7048e8', '#d6336c', '#0ca678', '#e8590c', '#4263eb', '#ae3ec9'];

export function letterTile(title, url, cls = 'letter') {
  const text = (title || hostOf(url) || '?').trim();
  const ch = [...text][0]?.toUpperCase() || '?';
  let hash = 0;
  for (const c of hostOf(url) || text) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return h('span', { class: cls, style: { background: LETTER_COLORS[hash % LETTER_COLORS.length] }, 'aria-hidden': 'true' }, ch);
}

export function validIconUrl(v) {
  if (!v) return '';
  try {
    const u = new URL(v);
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

// Chrome's favicon cache returns a generic globe for sites it has never seen.
// Fingerprint that globe once so we can show a nicer letter tile instead.
const fingerprints = new Map(); // size -> Promise<string|null>

function fingerprint(img) {
  try {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 16, 16);
    return Array.from(ctx.getImageData(0, 0, 16, 16).data).join(',');
  } catch {
    return null;
  }
}

function defaultFingerprint(size) {
  if (!fingerprints.has(size)) {
    fingerprints.set(
      size,
      new Promise((resolve) => {
        const probe = new Image();
        probe.onload = () => resolve(fingerprint(probe));
        probe.onerror = () => resolve(null);
        probe.src = faviconUrl('https://sequoia-tab.invalid/', size);
      }),
    );
  }
  return fingerprints.get(size);
}

export function siteIcon(item, size = 64) {
  const custom = validIconUrl(item.icon);
  const src = custom || (/^https?:/i.test(item.url) ? faviconUrl(item.url, size) : null);
  if (!src) return letterTile(item.title, item.url);
  const img = h('img', { src, alt: '', draggable: 'false', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(letterTile(item.title, item.url)), { once: true });
  if (!custom) {
    img.addEventListener(
      'load',
      async () => {
        const def = await defaultFingerprint(size);
        if (def && fingerprint(img) === def) img.replaceWith(letterTile(item.title, item.url));
      },
      { once: true },
    );
  }
  return img;
}

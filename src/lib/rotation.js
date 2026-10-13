// Wallpaper selection & rotation. Runs only in the service worker, which acts
// as the single authority: every New Tab page asks it to "check", and calls
// are serialised, so several open tabs can never trigger duplicate API calls
// or conflicting wallpaper changes. Timing is based on a persisted timestamp
// (`changedAt`), not on timers that die when the worker is suspended.

import { intervalMs } from './defaults.js';
import { getSettings, getSecrets, getWallpaperState, getFavorites, set, KEYS } from './storage.js';
import { PRESETS, presetById, gradientCss, isHexColor } from './presets.js';
import { fetchRandomPhotos, trackDownload, UnsplashError } from './unsplash.js';
import { listWallpaperIds } from './idb.js';

export const ALARM = 'wallpaper-rotate';
const ROTATING_SOURCES = new Set(['unsplash', 'uploads', 'favorites', 'preset']);
const DUE_TOLERANCE_MS = 2000;
// Unsplash allows up to 30 photos per random request; bigger batches mean
// fewer calls against the hourly rate limit.
const BATCH_SIZE = 30;

let chain = Promise.resolve();
// Run tasks one at a time, in order.
function serial(task) {
  const run = chain.then(task, task);
  chain = run.catch(() => {});
  return run;
}

export function unsplashQueries(w) {
  const custom = String(w.customQuery || '')
    .split(',')
    .map((s) => s.trim().slice(0, 60))
    .filter(Boolean);
  const cats = Array.isArray(w.categories) ? w.categories.filter((c) => typeof c === 'string') : [];
  return [...new Set([...cats, ...custom])];
}

// Identifies "what the user selected". When it changes, the wallpaper changes
// immediately instead of waiting for the next rotation.
export function selectionSig(w) {
  switch (w.source) {
    case 'unsplash':
      return 'unsplash:' + unsplashQueries(w).sort().join('|');
    case 'uploads':
      return 'uploads:' + (w.uploadsDefaultId || '');
    case 'favorites':
      return 'favorites';
    case 'preset':
      return 'preset:' + w.presetId;
    case 'gradient':
      return `gradient:${w.gradient?.from}:${w.gradient?.to}:${w.gradient?.angle}`;
    case 'color':
      return 'color:' + w.color;
    default:
      return 'preset:sequoia';
  }
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function nextDueAt(settings, state) {
  const w = settings.wallpaper;
  const ms = intervalMs(w.interval);
  if (!ms || w.paused || !ROTATING_SOURCES.has(w.source) || !state.changedAt) return 0;
  if (w.interval === '1d') {
    const d = new Date(state.changedAt);
    d.setHours(24, 0, 0, 0); // next local midnight
    return d.getTime();
  }
  return state.changedAt + ms;
}

function presetCurrent(id) {
  const p = presetById(id);
  return { kind: 'preset', id: p.id };
}

function nextInCycle(list, currentId) {
  if (!list.length) return null;
  const i = list.indexOf(currentId);
  return list[(i + 1) % list.length];
}

async function pickUnsplash(ctx) {
  const { w, state, secrets } = ctx;
  const sig = selectionSig(w);
  let queue = state.queueSig === sig && Array.isArray(state.queue) ? state.queue.slice() : [];
  let cursor = state.categoryCursor || 0;
  if (!queue.length) {
    const queries = unsplashQueries(w);
    const query = queries.length ? queries[cursor % queries.length] : '';
    cursor += 1;
    queue = await fetchRandomPhotos(secrets.unsplashKey, query, BATCH_SIZE);
  }
  // Avoid showing the same photo twice in a row.
  let photo = queue.shift();
  if (photo && state.current?.photo?.id === photo.id && queue.length) photo = queue.shift();
  trackDownload(photo, secrets.unsplashKey);
  return {
    current: { kind: 'unsplash', photo },
    patch: { queue, queueSig: sig, categoryCursor: cursor },
  };
}

async function pickFrom(ctx) {
  const { w, state } = ctx;
  const sigChanged = state.sig !== selectionSig(w);
  switch (w.source) {
    case 'unsplash':
      return pickUnsplash(ctx);
    case 'uploads': {
      const ids = await listWallpaperIds();
      if (!ids.length) throw new UnsplashError('no-uploads', 'Upload a photo in Settings → Wallpaper → My Photos.');
      let id;
      if (sigChanged || state.current?.kind !== 'upload') {
        id = ids.includes(w.uploadsDefaultId) ? w.uploadsDefaultId : ids[0];
      } else {
        id = nextInCycle(ids, state.current.id);
      }
      return { current: { kind: 'upload', id } };
    }
    case 'favorites': {
      const favs = await getFavorites();
      if (!favs.length) throw new UnsplashError('no-favorites', 'Tap ♥ on an Unsplash wallpaper to add it to Favorites.');
      const ids = favs.map((f) => f.id);
      const curId = state.current?.kind === 'unsplash' ? state.current.photo?.id : null;
      const id = sigChanged && !ids.includes(curId) ? ids[0] : nextInCycle(ids, curId);
      return { current: { kind: 'unsplash', photo: favs.find((f) => f.id === id), favorite: true } };
    }
    case 'preset': {
      if (sigChanged || state.current?.kind !== 'preset') return { current: presetCurrent(w.presetId) };
      const ids = PRESETS.map((p) => p.id);
      return { current: presetCurrent(nextInCycle(ids, state.current.id)) };
    }
    case 'gradient':
      return { current: { kind: 'gradient', css: gradientCss(w.gradient), from: w.gradient?.from, to: w.gradient?.to } };
    case 'color':
      return { current: { kind: 'color', color: isHexColor(w.color) ? w.color : '#1f2933' } };
    default:
      return { current: presetCurrent('sequoia') };
  }
}

async function currentIsStale(w, state) {
  const cur = state.current;
  if (!cur) return true;
  if (w.source === 'uploads' && cur.kind === 'upload') {
    const ids = await listWallpaperIds();
    return !ids.includes(cur.id);
  }
  if (w.source === 'favorites' && cur.kind === 'unsplash') {
    const favs = await getFavorites();
    return !favs.some((f) => f.id === cur.photo?.id);
  }
  return false;
}

function backoffFor(err) {
  if (err.retryAfterMs) return err.retryAfterMs;
  switch (err.code) {
    case 'offline':
      return 60_000;
    case 'invalid-key':
    case 'no-key':
      return 6 * 60 * 60_000; // until the key changes
    case 'no-results':
      return 30 * 60_000;
    default:
      return 0;
  }
}

async function doResolve({ force = false, userInitiated = false } = {}) {
  const [settings, state, secrets] = await Promise.all([getSettings(), getWallpaperState(), getSecrets()]);
  const w = settings.wallpaper;
  const now = Date.now();
  const sig = selectionSig(w);
  const sigChanged = state.sig !== sig;
  let due = force || sigChanged || (await currentIsStale(w, state));
  if (!due) {
    const at = nextDueAt(settings, state);
    due = at > 0 && now >= at - DUE_TOLERANCE_MS;
  }
  if (!due) return { changed: false, state, settings };

  // After a failure for this same selection, wait out the back-off instead of
  // hitting the network on every New Tab. An explicit "next" from the user
  // retries immediately, except while rate-limited.
  const inBackoff = state.status?.state === 'error' && state.failedSig === sig && state.backoffUntil > now;
  if (inBackoff && !(userInitiated && state.status.code !== 'rate-limited')) {
    return { changed: false, state, settings };
  }

  let next;
  try {
    next = await pickFrom({ w, state, secrets, now, userInitiated, sigChanged });
  } catch (err) {
    const code = err instanceof UnsplashError ? err.code : 'error';
    const message = err instanceof UnsplashError ? err.message : 'Could not change the wallpaper.';
    const newState = {
      ...state,
      // Keep whatever is on screen; fall back to a built-in only if nothing is.
      current: state.current || presetCurrent(w.presetId),
      changedAt: state.current ? state.changedAt : now,
      status: { state: 'error', code, message, at: now, source: w.source },
      backoffUntil: now + backoffFor(err),
      // `sig` keeps describing what is on screen, so the new selection is
      // retried once the back-off expires (or the key/settings change).
      failedSig: sig,
    };
    await set({ [KEYS.wallpaper]: newState });
    return { changed: !state.current, state: newState, settings, error: newState.status };
  }

  const newState = {
    ...state,
    ...(next.patch || {}),
    current: next.current,
    changedAt: now,
    sig,
    status: { state: 'ok', at: now, source: w.source },
    backoffUntil: 0,
    failedSig: '',
  };
  await set({ [KEYS.wallpaper]: newState });
  return { changed: true, state: newState, settings };
}

export function resolveWallpaper(opts) {
  return serial(() => doResolve(opts));
}

// Validate the stored key by fetching a batch (which also fills the queue).
export function testUnsplash() {
  return serial(async () => {
    const [settings, state, secrets] = await Promise.all([getSettings(), getWallpaperState(), getSecrets()]);
    const w = settings.wallpaper;
    try {
      const queries = unsplashQueries(w);
      const query = queries.length ? queries[(state.categoryCursor || 0) % queries.length] : '';
      const photos = await fetchRandomPhotos(secrets.unsplashKey, query, BATCH_SIZE);
      const patch = {
        ...state,
        queue: photos,
        queueSig: selectionSig({ ...w, source: 'unsplash' }),
        categoryCursor: (state.categoryCursor || 0) + 1,
        backoffUntil: 0,
        status: state.status?.state === 'error' ? { state: 'ok', at: Date.now(), source: w.source } : state.status,
      };
      await set({ [KEYS.wallpaper]: patch });
      return { ok: true, message: 'Connected to Unsplash.' };
    } catch (err) {
      return { ok: false, code: err.code || 'error', message: err.message || 'Unknown error' };
    }
  });
}

export async function scheduleAlarm() {
  const [settings, state] = await Promise.all([getSettings(), getWallpaperState()]);
  const w = settings.wallpaper;
  const ms = intervalMs(w.interval);
  await chrome.alarms.clear(ALARM);
  if (!ms || w.paused || !ROTATING_SOURCES.has(w.source)) return null;
  const due = nextDueAt(settings, state) || Date.now() + ms;
  const periodInMinutes = w.interval === '1d' ? 60 : ms / 60_000;
  const when = Math.max(Date.now() + 1000, due);
  await chrome.alarms.create(ALARM, { when, periodInMinutes });
  return { when, periodInMinutes };
}

export async function clearBackoff() {
  const state = await getWallpaperState();
  if (!state.backoffUntil) return;
  await set({ [KEYS.wallpaper]: { ...state, backoffUntil: 0 } });
}

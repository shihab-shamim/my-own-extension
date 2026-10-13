// Service worker: seeds first-run data, owns wallpaper rotation and Unsplash
// requests. It holds no long-lived timers; Chrome may suspend it at any time,
// and every decision is recomputed from persisted state.

import { ensureSeeded, KEYS } from './lib/storage.js';
import { ALARM, resolveWallpaper, scheduleAlarm, testUnsplash, clearBackoff, selectionSig } from './lib/rotation.js';

const NEWTAB_PATH = '/newtab.html';

async function hasOpenNewTab() {
  try {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
    return contexts.some((c) => (c.documentUrl || '').includes(NEWTAB_PATH));
  } catch {
    return true; // If unsure, behave as if a tab is open.
  }
}

async function init() {
  await ensureSeeded();
  await scheduleAlarm();
}

chrome.runtime.onInstalled.addListener(() => {
  init().catch((e) => console.error('[Sequoia Tab] init failed', e));
});

chrome.runtime.onStartup.addListener(() => {
  init().catch((e) => console.error('[Sequoia Tab] startup failed', e));
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({});
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM) return;
  // Only spend API quota when someone can actually see the wallpaper. Closed
  // tabs catch up on their next open because "due" is computed from timestamps.
  if (!(await hasOpenNewTab())) return;
  const result = await resolveWallpaper();
  if (result.changed) await scheduleAlarm();
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (changes[KEYS.settings]) {
    const before = changes[KEYS.settings].oldValue?.wallpaper;
    const after = changes[KEYS.settings].newValue?.wallpaper;
    if (!after) return;
    const rotationChanged =
      !before ||
      before.interval !== after.interval ||
      before.paused !== after.paused ||
      before.source !== after.source;
    const selectionChanged = !before || selectionSig(before) !== selectionSig(after);
    if (selectionChanged) await resolveWallpaper();
    if (rotationChanged || selectionChanged) await scheduleAlarm();
  }
  if (changes[KEYS.secrets]) {
    const was = changes[KEYS.secrets].oldValue?.unsplashKey || '';
    const now = changes[KEYS.secrets].newValue?.unsplashKey || '';
    if (was !== now) {
      await clearBackoff();
      await resolveWallpaper();
      await scheduleAlarm();
    }
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg || typeof msg.type !== 'string') return false;
  const respond = (p) => {
    p.then(sendResponse, (err) => sendResponse({ error: String(err?.message || err) }));
    return true;
  };
  switch (msg.type) {
    case 'wallpaper:check':
      return respond(
        resolveWallpaper().then(async (r) => {
          if (r.changed) await scheduleAlarm();
          return { changed: r.changed, state: r.state };
        }),
      );
    case 'wallpaper:next':
      return respond(
        resolveWallpaper({ force: true, userInitiated: true }).then(async (r) => {
          await scheduleAlarm();
          return { changed: r.changed, state: r.state, error: r.error };
        }),
      );
    case 'unsplash:test':
      return respond(
        testUnsplash().then(async (r) => {
          if (r.ok) await resolveWallpaper();
          return r;
        }),
      );
    case 'alarm:info':
      return respond(chrome.alarms.get(ALARM).then((a) => a || null));
    default:
      return false;
  }
});

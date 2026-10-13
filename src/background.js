// Service worker: seeds first-run data, owns wallpaper rotation and Unsplash
// requests. It holds no long-lived timers; Chrome may suspend it at any time,
// and every decision is recomputed from persisted state.

import { ensureSeeded, KEYS } from './lib/storage.js';
import { ALARM, resolveWallpaper, scheduleAlarm, testUnsplash, clearBackoff, selectionSig } from './lib/rotation.js';
import { ensureOriginRule } from './newtab/gaccount.js';
import { canOverlay, toggleOverlay } from './overlay.js';

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
  await ensureOriginRule();
  await setupSidePanel();
}

// The toolbar button (and Ctrl+Shift+Y) toggles the to-do list in Chrome's
// side panel, which stays open on every site while you browse. We handle the
// click ourselves (instead of openPanelOnActionClick) so a second press closes it.
async function setupSidePanel() {
  if (!chrome.sidePanel) return;
  try {
    await chrome.sidePanel.setOptions({ path: 'sidepanel.html', enabled: true });
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  } catch (err) {
    console.warn('[Sequoia Tab] side panel setup failed:', err?.message || err);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  init()
    .then(afterSelfReload)
    .catch((e) => console.error('[Sequoia Tab] init failed', e));
});

// After "Finish update" (chrome.runtime.reload from the account card): clear
// the stale "needs reload" state so the account loads, and reopen a New Tab.
async function afterSelfReload() {
  const { reopenAfterReload, googleAccounts } = await chrome.storage.local.get(['reopenAfterReload', 'googleAccounts']);
  if (googleAccounts?.needsReload) {
    await chrome.storage.local.set({ googleAccounts: { ...googleAccounts, needsReload: false, error: '', detail: '', at: 0 } });
  }
  if (reopenAfterReload && Date.now() - reopenAfterReload < 60_000) {
    await chrome.storage.local.remove('reopenAfterReload');
    await chrome.tabs.create({});
  }
}

chrome.runtime.onStartup.addListener(() => {
  init().catch((e) => console.error('[Sequoia Tab] startup failed', e));
});

// Which windows currently show the panel. Each open panel keeps a port to us
// (and reconnects if this worker restarts), so this stays accurate.
const panelPorts = new Map(); // windowId -> port

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sidepanel' || port.sender?.id !== chrome.runtime.id) return;
  let windowId = null;
  port.onMessage.addListener((msg) => {
    if (msg?.type === 'hello' && Number.isInteger(msg.windowId)) {
      windowId = msg.windowId;
      panelPorts.set(windowId, port);
    }
  });
  port.onDisconnect.addListener(() => {
    if (windowId != null && panelPorts.get(windowId) === port) panelPorts.delete(windowId);
  });
});

// Toolbar button / Ctrl+Shift+Y:
//  - side panel open in this window  -> close it
//  - a normal website                -> slide the floating to-do over the page (or away)
//  - anything else (chrome:// pages…) -> open the side panel
// sidePanel.open() is called synchronously so Chrome sees the user's gesture.
function togglePanel(tab) {
  const windowId = tab?.windowId;
  if (windowId == null) return;
  const port = panelPorts.get(windowId);
  if (port) {
    panelPorts.delete(windowId);
    const viaPanel = () => {
      try {
        port.postMessage({ type: 'close' });
      } catch {
        /* already gone */
      }
    };
    if (chrome.sidePanel?.close) chrome.sidePanel.close({ windowId }).catch(viaPanel);
    else viaPanel();
    return;
  }
  if (tab.id != null && canOverlay(tab.url) && chrome.scripting) {
    toggleOverlay(tab.id).catch((err) => console.warn('[Sequoia Tab] could not show the floating to-do:', err?.message || err));
    return;
  }
  if (!chrome.sidePanel) return;
  chrome.sidePanel.open({ windowId }).catch((err) => console.warn('[Sequoia Tab] could not open the side panel:', err?.message || err));
}
self.__sequoiaTogglePanel = togglePanel; // used by the automated tests

chrome.action.onClicked.addListener(togglePanel);

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

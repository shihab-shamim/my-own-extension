// Real Google account info (photo, name, email) for the account button.
//
// Privacy: opt-in. Reading the signed-in account list needs access to
// accounts.google.com, which is an *optional* permission requested only when
// the user clicks "Connect Google account" (Chrome shows its own prompt). The
// data comes from the same endpoint Chrome uses for its account menu, is
// cached only in this extension's local storage, is never included in
// backups and is never sent anywhere else. "Disconnect" removes both.

export const GOOGLE_PERM = { origins: ['https://accounts.google.com/*'] };
const LIST_URL = 'https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard';
const CACHE_KEY = 'googleAccounts'; // { enabled, at, accounts: [...] }
const STALE_MS = 15 * 60_000;
const EMAIL_RE = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,255}$/;
const PHOTO_HOST = /^https:\/\/lh\d+\.googleusercontent\.com\//;

export async function hasPermission() {
  try {
    return await chrome.permissions.contains(GOOGLE_PERM);
  } catch {
    return false;
  }
}

export async function readCache() {
  const { [CACHE_KEY]: c } = await chrome.storage.local.get(CACHE_KEY);
  return { enabled: !!c?.enabled, at: Number(c?.at) || 0, accounts: Array.isArray(c?.accounts) ? c.accounts : [], error: c?.error || '', needsReload: !!c?.needsReload, detail: typeof c?.detail === 'string' ? c.detail : '' };
}

async function writeCache(patch) {
  const cur = await readCache();
  await chrome.storage.local.set({ [CACHE_KEY]: { ...cur, ...patch } });
}

// Is the feature switched on *and* still permitted?
export async function isConnected() {
  const c = await readCache();
  return c.enabled && (await hasPermission());
}

// Resize a Google profile photo URL (…=s96-c), or return '' if it isn't one.
export function photoAt(url, size) {
  if (typeof url !== 'string' || !PHOTO_HOST.test(url) || url.length > 2000) return '';
  const base = url.replace(/=[a-z0-9-]*$/i, '').replace(/\/s\d+(-c)?\//, '/');
  return `${base}=s${size}-c`;
}

// Parse Google's account list defensively; it's an undocumented format:
// ["gaia.l.a.r", [["gaia.l.a", 1, "Name", "email", "photo", …], …]]
export function parseAccounts(text) {
  const start = String(text).indexOf('[');
  if (start < 0) throw new Error('unexpected response');
  const data = JSON.parse(String(text).slice(start));
  const list = Array.isArray(data?.[1]) ? data[1] : [];
  const out = [];
  list.forEach((entry) => {
    if (!Array.isArray(entry)) return;
    const email = entry.find((x) => typeof x === 'string' && EMAIL_RE.test(x));
    if (!email) return;
    const name = typeof entry[2] === 'string' && !EMAIL_RE.test(entry[2]) ? entry[2].slice(0, 100) : '';
    const photo = entry.find((x) => typeof x === 'string' && PHOTO_HOST.test(x)) || '';
    out.push({ index: out.length, name, email: email.slice(0, 320), photo: photoAt(photo, 96) ? photo.slice(0, 2000) : '' });
  });
  return out.slice(0, 10);
}

// Google answers 403 to this endpoint when the request carries an extension
// Origin (Chrome adds one to every POST from an extension page). Chrome's own
// account fetcher sends "Origin: https://www.google.com", so this rule sends
// exactly that — for this one URL, only for this extension's own requests.
// It can only act on hosts the user granted (the optional permission above).
const ORIGIN_RULE_ID = 1;
export function originRule() {
  return {
    id: ORIGIN_RULE_ID,
    priority: 1,
    action: { type: 'modifyHeaders', requestHeaders: [{ header: 'origin', operation: 'set', value: 'https://www.google.com' }] },
    condition: {
      urlFilter: '|https://accounts.google.com/ListAccounts',
      initiatorDomains: [chrome.runtime.id],
      requestMethods: ['post'],
      resourceTypes: ['xmlhttprequest'],
    },
  };
}

// Was the header-rule permission granted? (False if the extension was updated
// but not yet reloaded in chrome://extensions.)
export async function headerRuleAvailable() {
  try {
    return !!chrome.declarativeNetRequest && (await chrome.permissions.contains({ permissions: ['declarativeNetRequestWithHostAccess'] }));
  } catch {
    return false;
  }
}

export async function ensureOriginRule() {
  if (!(await headerRuleAvailable())) return false;
  try {
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    const want = JSON.stringify(originRule());
    if (!rules.some((r) => r.id === ORIGIN_RULE_ID && JSON.stringify(r) === want)) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [ORIGIN_RULE_ID], addRules: [originRule()] });
    }
    return true;
  } catch (err) {
    console.warn('[Sequoia Tab] could not set up the Google account request rule:', err?.message || err);
    return false;
  }
}

let inflight = null;

// Fetch the signed-in accounts (deduplicated across rapid calls).
export function refreshAccounts({ force = false } = {}) {
  if (inflight) return inflight;
  inflight = (async () => {
    const cache = await readCache();
    if (!cache.enabled || !(await hasPermission())) return cache;
    if (!force && Date.now() - cache.at < STALE_MS) return cache;
    if (!(await ensureOriginRule())) {
      await writeCache({ error: 'Sequoia Tab was updated. One more click to finish.', needsReload: true, detail: 'header rule unavailable' });
      return readCache();
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(LIST_URL, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: ' ', // like Chrome's own request
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from Google`);
      const accounts = parseAccounts(await res.text());
      await writeCache({ at: Date.now(), accounts, error: '', needsReload: false, detail: '' });
    } catch (err) {
      // Keep showing the last known accounts; record why, for the card.
      await writeCache({
        error: navigator.onLine ? 'Couldn’t load your Google account right now.' : 'You’re offline.',
        needsReload: false,
        detail: String(err?.name === 'AbortError' ? 'timed out' : err?.message || err).slice(0, 120),
      });
      console.warn('[Sequoia Tab] Google account info unavailable:', err?.message || err);
    } finally {
      clearTimeout(timer);
    }
    return readCache();
  })().finally(() => (inflight = null));
  return inflight;
}

// Must be called from a click (Chrome only shows permission prompts then).
export async function connect() {
  let granted = false;
  try {
    granted = await chrome.permissions.request(GOOGLE_PERM);
  } catch {
    granted = false;
  }
  if (!granted) return false;
  await writeCache({ enabled: true, at: 0 });
  await refreshAccounts({ force: true });
  return true;
}

export async function disconnect() {
  await chrome.storage.local.set({ [CACHE_KEY]: { enabled: false, at: 0, accounts: [], error: '', needsReload: false, detail: '' } });
  try {
    await chrome.permissions.remove(GOOGLE_PERM);
  } catch {
    // Already gone, or not removable — the feature is off either way.
  }
}

export function onAccountsChanged(fn) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[CACHE_KEY]) fn();
  });
  chrome.permissions?.onRemoved?.addListener(fn);
  chrome.permissions?.onAdded?.addListener(fn);
}

// URL helpers: validation for user-entered shortcuts and safe navigation.

const WEB_PROTOCOLS = new Set(['http:', 'https:']);
const BROWSER_PROTOCOLS = new Set(['chrome:', 'chrome-extension:', 'edge:', 'about:', 'file:', 'view-source:']);

// Normalise user input into an absolute URL, or return null if it is not a
// URL we are willing to open (javascript:, data:, etc. are rejected).
export function normalizeUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw || raw.length > 4096) return null;
  let candidate = raw;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) candidate = `https://${candidate}`;
  // "localhost:3000" parses with protocol "localhost:"; treat it as a host.
  if (/^localhost:\d+/i.test(raw)) candidate = `http://${raw}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (WEB_PROTOCOLS.has(url.protocol)) {
    if (!url.hostname || /\s/.test(url.hostname)) return null;
    return url.href;
  }
  if (BROWSER_PROTOCOLS.has(url.protocol)) return url.href;
  return null;
}

export function isWebUrl(url) {
  try {
    return WEB_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

// Heuristic used by the search box: does the query look like an address?
export function looksLikeUrl(text) {
  const t = text.trim();
  if (!t || /\s/.test(t)) return false;
  if (/^(https?|chrome|file):\/\//i.test(t) || /^chrome:\/\//i.test(t)) return true;
  if (/^localhost(:\d+)?(\/|$)/i.test(t)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(t)) return true;
  // domain.tld with an alphabetic TLD of 2+ chars
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(t);
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Extension pages may not navigate to chrome:// (and some other) URLs with a
// normal link, so those go through the tabs API instead.
export function needsTabsApi(url) {
  return !isWebUrl(url);
}

export async function openUrl(url, { newTab = false, background = false } = {}) {
  if (!url) return;
  try {
    if (newTab) {
      await chrome.tabs.create({ url, active: !background });
    } else if (needsTabsApi(url)) {
      await chrome.tabs.update({ url });
    } else {
      window.location.assign(url);
    }
  } catch (err) {
    console.warn('[Sequoia Tab] Could not open', url, err);
  }
}

export function faviconUrl(pageUrl, size = 64) {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', pageUrl);
  u.searchParams.set('size', String(size));
  return u.toString();
}

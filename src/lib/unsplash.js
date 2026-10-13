// Unsplash API client (https://unsplash.com/documentation).
// - Uses the user's own Access Key, sent only to api.unsplash.com.
// - Images are hotlinked from images.unsplash.com as the API guidelines require.
// - The download endpoint is pinged when a photo becomes the wallpaper.

const API = 'https://api.unsplash.com';
export const APP_NAME = 'sequoia_tab';

export class UnsplashError extends Error {
  constructor(code, message, { retryAfterMs = 0, status = 0 } = {}) {
    super(message);
    this.code = code; // no-key | invalid-key | rate-limited | no-results | offline | http
    this.retryAfterMs = retryAfterMs;
    this.status = status;
  }
}

function headers(key) {
  return { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' };
}

const ALLOWED_IMAGE_HOST = /^https:\/\/images\.unsplash\.com\//;
const ALLOWED_PAGE_HOST = /^https:\/\/(www\.)?unsplash\.com\//;
const ALLOWED_API_HOST = /^https:\/\/api\.unsplash\.com\//;

function str(v, max = 300) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

// Keep only the fields we need, and only URLs on Unsplash's own hosts.
export function sanitizePhoto(p) {
  if (!p || typeof p !== 'object') return null;
  const raw = str(p.urls?.raw, 2000);
  if (!ALLOWED_IMAGE_HOST.test(raw)) return null;
  const thumb = str(p.urls?.small, 2000);
  const authorUrl = str(p.user?.links?.html, 500);
  const photoUrl = str(p.links?.html, 500);
  const dl = str(p.links?.download_location, 1000);
  return {
    id: str(p.id, 64),
    raw,
    thumb: ALLOWED_IMAGE_HOST.test(thumb) ? thumb : raw + '&w=400',
    color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#333333',
    width: Number(p.width) || 0,
    height: Number(p.height) || 0,
    alt: str(p.alt_description || p.description, 200),
    author: str(p.user?.name, 120) || 'Unknown photographer',
    authorUrl: ALLOWED_PAGE_HOST.test(authorUrl) ? authorUrl : 'https://unsplash.com/',
    photoUrl: ALLOWED_PAGE_HOST.test(photoUrl) ? photoUrl : 'https://unsplash.com/',
    downloadLocation: ALLOWED_API_HOST.test(dl) ? dl : '',
  };
}

// Validate a photo already in our stored shape (favorites from a backup file).
export function sanitizeStoredPhoto(p) {
  if (!p || typeof p !== 'object' || !ALLOWED_IMAGE_HOST.test(str(p.raw, 2000))) return null;
  return {
    id: str(p.id, 64) || 'photo',
    raw: str(p.raw, 2000),
    thumb: ALLOWED_IMAGE_HOST.test(str(p.thumb, 2000)) ? str(p.thumb, 2000) : str(p.raw, 2000) + '&w=400',
    color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#333333',
    width: Number(p.width) || 0,
    height: Number(p.height) || 0,
    alt: str(p.alt, 200),
    author: str(p.author, 120) || 'Unknown photographer',
    authorUrl: ALLOWED_PAGE_HOST.test(str(p.authorUrl, 500)) ? str(p.authorUrl, 500) : 'https://unsplash.com/',
    photoUrl: ALLOWED_PAGE_HOST.test(str(p.photoUrl, 500)) ? str(p.photoUrl, 500) : 'https://unsplash.com/',
    downloadLocation: ALLOWED_API_HOST.test(str(p.downloadLocation, 1000)) ? str(p.downloadLocation, 1000) : '',
  };
}

export function withUtm(url) {
  try {
    const u = new URL(url);
    u.searchParams.set('utm_source', APP_NAME);
    u.searchParams.set('utm_medium', 'referral');
    return u.toString();
  } catch {
    return 'https://unsplash.com/?utm_source=' + APP_NAME + '&utm_medium=referral';
  }
}

async function request(url, key) {
  let res;
  try {
    res = await fetch(url, { headers: headers(key), cache: 'no-store' });
  } catch (err) {
    throw new UnsplashError('offline', 'Could not reach Unsplash. Check your connection.');
  }
  if (res.ok) return res;
  const text = await res.text().catch(() => '');
  if (res.status === 401) {
    throw new UnsplashError('invalid-key', 'Unsplash rejected the Access Key. Check that it is correct.', { status: 401 });
  }
  if (res.status === 403 && /rate limit/i.test(text)) {
    throw new UnsplashError('rate-limited', 'Unsplash hourly rate limit reached. Wallpapers will resume automatically.', {
      status: 403,
      retryAfterMs: 15 * 60_000,
    });
  }
  if (res.status === 403) {
    throw new UnsplashError('invalid-key', 'Unsplash refused the request (403). Check that the key belongs to an active application.', { status: 403 });
  }
  if (res.status === 404) {
    throw new UnsplashError('no-results', 'No Unsplash photos matched these categories.', { status: 404 });
  }
  throw new UnsplashError('http', `Unsplash returned an error (${res.status}).`, {
    status: res.status,
    retryAfterMs: 5 * 60_000,
  });
}

// Returns an array of sanitised photos (batching reduces API calls).
export async function fetchRandomPhotos(key, query, count = 10) {
  if (!key) throw new UnsplashError('no-key', 'Add your Unsplash Access Key in Settings → Wallpaper.');
  const params = new URLSearchParams({
    count: String(count),
    orientation: 'landscape',
    content_filter: 'high',
  });
  if (query) params.set('query', query);
  const res = await request(`${API}/photos/random?${params}`, key);
  let data;
  try {
    data = await res.json();
  } catch {
    throw new UnsplashError('http', 'Unsplash returned an unreadable response.', { retryAfterMs: 5 * 60_000 });
  }
  const list = (Array.isArray(data) ? data : [data]).map(sanitizePhoto).filter(Boolean);
  if (!list.length) throw new UnsplashError('no-results', 'No Unsplash photos matched these categories.');
  return list;
}

// Required by the Unsplash API guidelines when a photo is "used".
export async function trackDownload(photo, key) {
  if (!photo?.downloadLocation || !key) return;
  try {
    await fetch(photo.downloadLocation, { headers: headers(key), cache: 'no-store' });
  } catch {
    // Non-critical; ignore network errors.
  }
}

// Build an appropriately sized image URL using Unsplash's imgix parameters.
export function sizedImageUrl(raw, width) {
  const w = Math.max(640, Math.min(3840, Math.ceil(width / 320) * 320));
  try {
    const u = new URL(raw);
    u.searchParams.set('w', String(w));
    u.searchParams.set('q', '80');
    u.searchParams.set('fm', 'jpg');
    u.searchParams.set('fit', 'max');
    return u.toString();
  } catch {
    return raw;
  }
}

// Messages to the service worker, which owns wallpaper rotation.

export async function send(type, payload = {}) {
  try {
    const res = await chrome.runtime.sendMessage({ type, ...payload });
    if (res?.error) throw new Error(res.error);
    return res;
  } catch (err) {
    console.warn('[Sequoia Tab]', type, 'failed:', err?.message || err);
    return { error: String(err?.message || err) };
  }
}

export const checkWallpaper = () => send('wallpaper:check');
export const nextWallpaper = () => send('wallpaper:next');
export const testUnsplashKey = () => send('unsplash:test');

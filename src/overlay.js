// Floating to-do overlay for regular websites.
//
// When you press the toolbar button / Ctrl+Shift+Y on a normal web page, the
// service worker injects this function into that tab (allowed by activeTab —
// only the tab you acted on, only after your click/shortcut). It adds a
// closed-Shadow-DOM container that slides in from the right *over* the page,
// holding an <iframe> of the extension's own to-do page. The page layout is
// never changed, the page can't read the to-do list (cross-origin iframe), and
// pressing again slides it away. State is kept while you stay on the page.

// Runs in the page's isolated world. Must be self-contained (no imports).
export function toggleOverlayInPage(src) {
  const existing = globalThis.__sequoiaTodoOverlay;
  if (existing && existing.host.isConnected) return existing.toggle();

  const host = document.createElement('sequoia-tab-todo');
  host.style.cssText = 'all: initial; position: fixed; top: 0; right: 0; width: 0; height: 0; z-index: 2147483647;';
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    .wrap {
      position: fixed; top: 12px; right: 12px; bottom: 12px;
      width: min(380px, calc(100vw - 24px)); max-height: 760px;
      border-radius: 18px; overflow: hidden;
      background: #202024;
      box-shadow: 0 24px 70px rgba(0, 0, 0, 0.38), 0 0 0 1px rgba(255, 255, 255, 0.08);
      transform: translateX(calc(100% + 32px)); opacity: 0;
      transition: transform 0.32s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.2s ease;
      visibility: hidden;
    }
    .wrap.open { transform: none; opacity: 1; visibility: visible; }
    .wrap.closing { visibility: visible; }
    iframe { display: block; width: 100%; height: 100%; border: 0; background: transparent; color-scheme: normal; }
    @media (prefers-reduced-motion: reduce) { .wrap { transition: none; } }
  `;
  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-label', 'To-do list (Sequoia Tab)');
  const frame = document.createElement('iframe');
  frame.title = 'To-do list';
  frame.src = src;
  wrap.append(frame);
  root.append(style, wrap);
  document.documentElement.append(host);

  let isOpen = false;
  let hideTimer = null;
  const show = () => {
    clearTimeout(hideTimer);
    wrap.classList.remove('closing');
    // next frame so the slide-in transition runs
    requestAnimationFrame(() => {
      wrap.classList.add('open');
      frame.focus();
      frame.contentWindow?.postMessage({ type: 'sequoia:shown' }, '*');
    });
    isOpen = true;
    return true;
  };
  const hide = () => {
    wrap.classList.remove('open');
    wrap.classList.add('closing');
    hideTimer = setTimeout(() => wrap.classList.remove('closing'), 350);
    isOpen = false;
    return false;
  };
  // The to-do page asks to hide (✕ button or Esc). Only trust our own iframe.
  window.addEventListener('message', (e) => {
    if (e.source === frame.contentWindow && e.data?.type === 'sequoia:hide') hide();
  });

  globalThis.__sequoiaTodoOverlay = { host, toggle: () => (isOpen ? hide() : show()), isOpen: () => isOpen };
  return show();
}

// Pages where extensions may inject (Chrome blocks chrome://, the Web Store, …).
export function canOverlay(url) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
  return !/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)(\/|$)/i.test(url);
}

export async function toggleOverlay(tabId) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: toggleOverlayInPage,
    args: [chrome.runtime.getURL('sidepanel.html?overlay=1')],
  });
  return res?.result;
}

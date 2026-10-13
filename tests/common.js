const puppeteer = require('puppeteer');
const path = require('path');
const EXT = process.env.EXT_DIR || path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
require('fs').mkdirSync(OUT, { recursive: true });

async function launch({ profile = 'profile', headless = true, width = 1280, height = 800, ext = EXT } = {}) {
  const browser = await puppeteer.launch({
    headless,
    pipe: true,
    enableExtensions: [ext],
    userDataDir: path.join(__dirname, profile),
    defaultViewport: { width, height },
    args: [`--window-size=${width},${height}`],
  });
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('src/background.js'), { timeout: 15000 });
  const extId = new URL(swTarget.url()).host;
  return { browser, swTarget, extId };
}

function watch(page, label, errors) {
  page.on('console', (m) => { if (!page.url().startsWith('chrome-extension://') && !page.url().startsWith('chrome://newtab')) return; if (['error', 'warning'].includes(m.type())) errors.push(`[${label}] console.${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`[${label}] requestfailed: ${r.url().slice(0, 120)} ${r.failure()?.errorText}`));
}

async function sw(swTarget) { return swTarget.worker(); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = { launch, watch, sw, sleep, OUT, EXT, path };

// MV3 service workers are stopped by Chrome when idle, so never hold on to one
// worker handle: resolve the current one each time, waking it if needed.
function workerHandle(browser, extId) {
  const isOurs = (t) => t.type() === 'service_worker' && t.url().startsWith(`chrome-extension://${extId}/`);
  let cached = null;
  let cachedTarget = null;
  const listeners = [];
  async function current() {
    let target = browser.targets().find(isOurs);
    if (!target) {
      // Wake it: any extension page can message the worker.
      const page = (await browser.pages()).find((p) => p.url().startsWith(`chrome-extension://${extId}/`));
      if (page) await page.evaluate(() => chrome.runtime.sendMessage({ type: 'alarm:info' })).catch(() => {});
      target = await browser.waitForTarget(isOurs, { timeout: 15000 });
    }
    if (target !== cachedTarget) {
      cachedTarget = target;
      cached = await target.worker();
      for (const [ev, fn] of listeners) cached.on(ev, fn);
    }
    return cached;
  }
  return {
    evaluate: async (fn, ...args) => (await current()).evaluate(fn, ...args),
    on: (ev, fn) => {
      listeners.push([ev, fn]);
      if (cached) cached.on(ev, fn);
    },
    current,
  };
}
module.exports.workerHandle = workerHandle;

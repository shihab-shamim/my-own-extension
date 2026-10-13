const puppeteer = require('puppeteer');
const path = require('path');
const EXT = process.env.EXT_DIR || path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
require('fs').mkdirSync(OUT, { recursive: true });

async function launch({ profile = 'profile', headless = true, width = 1280, height = 800 } = {}) {
  const browser = await puppeteer.launch({
    headless,
    pipe: true,
    enableExtensions: [EXT],
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

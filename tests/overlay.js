// End-to-end tests: the to-do list floating over web pages (toolbar / Ctrl+Shift+Y).
//
// In real use, your click/shortcut grants "activeTab" for that one tab. Automation
// can't press the toolbar button, so part B uses a copy whose manifest pre-allows
// all sites; the code path (inject → toggle) is otherwise identical.
const fs = require('fs');
const { launch, watch, sleep, OUT, EXT, path, workerHandle } = require('./common');

const results = [];
const errors = [];
function check(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: String(detail).slice(0, 300) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 220) : ''}`);
}

async function overlayState(page) {
  return page.evaluate(() => {
    const host = document.querySelector('sequoia-tab-todo');
    if (!host) return { exists: false };
    return { exists: true, shadowHidden: host.shadowRoot === null, docWidth: document.documentElement.clientWidth, bodyMargin: getComputedStyle(document.body).marginRight };
  });
}
// The overlay lives in a closed shadow root; read its open state through the iframe's visibility.
async function overlayVisible(page) {
  return page.evaluate(() => {
    const host = document.querySelector('sequoia-tab-todo');
    if (!host) return false;
    // A visible element at the right edge belongs to the overlay iff it is the host.
    const x = innerWidth - 60;
    const y = 120;
    const el = document.elementFromPoint(x, y);
    return el === host;
  });
}
// A small local web page (deterministic, no dependency on outside sites).
const http = require('http');
function startSite() {
  const html = '<!doctype html><html><head><title>Test site</title><style>body{margin:0;font:16px sans-serif}main{padding:40px}a{font-size:20px}</style></head><body><main><h1>Test site</h1><p><a href="#x">A link on the page</a></p>' + '<p>Lorem ipsum dolor sit amet.</p>'.repeat(40) + '</main></body></html>';
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' })));
}
const todoFrame = (page) => page.frames().find((f) => f.url().includes('/sidepanel.html?overlay=1'));

(async () => {
  // ---------------------------------------------------------------- Part A: real manifest
  fs.rmSync(path.join(__dirname, 'p-overlay-a'), { recursive: true, force: true });
  let { browser, extId } = await launch({ profile: 'p-overlay-a' });
  let p = await browser.newPage();
  await p.goto(`chrome-extension://${extId}/newtab.html`);
  await sleep(500);
  const m = await p.evaluate(() => chrome.runtime.getManifest());
  check('Permissions: activeTab + scripting only (no "all websites" access, no install warning)', m.permissions.includes('activeTab') && m.permissions.includes('scripting') && !m.host_permissions && !(m.content_scripts || []).length, JSON.stringify(m.permissions));
  const war = m.web_accessible_resources || [];
  check('Only the to-do page is web-reachable, and only via a per-session dynamic URL', war.length === 1 && JSON.stringify(war[0].resources) === '["sidepanel.html"]' && war[0].use_dynamic_url === true, JSON.stringify(war));
  await browser.close();
  await sleep(1500);

  // ---------------------------------------------------------------- Part B: behaviour
  const dir = path.join(__dirname, 'out', 'ext-overlay');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(EXT, dir, { recursive: true, filter: (s) => !/[\\/](tests|dist)([\\/]|$)/.test(s.slice(EXT.length)) });
  const mm = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  mm.host_permissions = ['<all_urls>']; // stands in for the activeTab grant your click gives
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(mm, null, 2));
  fs.rmSync(path.join(__dirname, 'p-overlay-b'), { recursive: true, force: true });
  ({ browser, extId } = await launch({ profile: 'p-overlay-b', ext: dir }));
  const worker = workerHandle(browser, extId);
  worker.on('console', (msg) => ['error'].includes(msg.type()) && errors.push('[sw] ' + msg.text()));
  const toggleFor = async (page) => {
    const url = page.url();
    return worker.evaluate(async (u) => {
      const [tab] = (await chrome.tabs.query({})).filter((t) => t.url === u);
      self.__sequoiaTogglePanel(tab);
      return !!tab;
    }, url);
  };

  p = await browser.newPage();
  watch(p, 'site', errors);
  await p.setViewport({ width: 1280, height: 800 });
  const site = await startSite();
  await p.goto(site.url);
  await sleep(500);
  const refusals = [];
  p.on('console', (msg) => /Denying load of chrome-extension/.test(msg.text()) && refusals.push(msg.text()));
  await p.evaluate((id) => { const f = document.createElement('iframe'); f.src = 'chrome-extension://' + id + '/sidepanel.html'; document.body.append(f); }, extId);
  await sleep(1500);
  const leaked = p.frames().some((f) => f.url().startsWith('chrome-extension://') && !f.url().includes('overlay=1'));
  check('A website can’t load the to-do page by itself (prevents misuse and detection)', refusals.length > 0 && !leaked, refusals[0] || 'no refusal seen');
  await p.evaluate(() => document.querySelectorAll('body > iframe').forEach((f) => f.remove()));
  errors.splice(0, errors.length, ...errors.filter((e) => !/Denying load of chrome-extension/.test(e)));
  const before = await p.evaluate(() => ({ w: document.documentElement.clientWidth, h1: Math.round(document.querySelector('h1').getBoundingClientRect().left) }));
  await toggleFor(p);
  await sleep(1200);
  let frame = todoFrame(p);
  check('Press once: the to-do list slides in over the page', !!frame && (await overlayVisible(p)), frame ? frame.url() : 'no frame');
  const after = await p.evaluate(() => ({ w: document.documentElement.clientWidth, h1: Math.round(document.querySelector('h1').getBoundingClientRect().left) }));
  check('It floats on top: the page keeps its full width and nothing moves', before.w === after.w && before.h1 === after.h1, JSON.stringify({ before, after }));
  const st = await overlayState(p);
  check('The page can’t look inside it (closed shadow root + extension iframe)', st.exists && st.shadowHidden, JSON.stringify(st));
  if (frame) {
    await frame.waitForSelector('.todo-input');
    check('Cursor is ready in "Add a task"', await frame.evaluate(() => document.activeElement?.classList.contains('todo-input')));
    await frame.type('.todo-input', 'Added over a website');
    await (await frame.$('.todo-input')).press('Enter');
    await sleep(500);
  }
  await p.screenshot({ path: path.join(OUT, 'overlay-open.png') });

  // sync with the New Tab
  const ntp = await browser.newPage();
  watch(ntp, 'ntp', errors);
  await ntp.goto('chrome://newtab');
  await ntp.waitForSelector('.todo-text');
  check('Tasks added in the floating list show on the New Tab', (await ntp.$$eval('.todo-text', (e) => e.map((x) => x.textContent))).includes('Added over a website'));
  await ntp.type('.todo-input', 'Added on the New Tab');
  await ntp.keyboard.press('Enter');
  await sleep(600);
  await p.bringToFront();
  frame = todoFrame(p);
  check('…and New Tab tasks show in the floating list instantly', (await frame.$$eval('.todo-text', (e) => e.map((x) => x.textContent))).includes('Added on the New Tab'));

  // press again: hides (kept in the page so it reopens instantly)
  await toggleFor(p);
  await sleep(700);
  check('Press again: it slides away', !(await overlayVisible(p)) && (await overlayState(p)).exists);
  await toggleFor(p);
  await sleep(900);
  check('Press again: it comes back (same list, instantly)', await overlayVisible(p));

  // Esc and the ✕ button hide it
  frame = todoFrame(p);
  await frame.focus('.todo-input');
  await p.keyboard.press('Escape');
  await sleep(700);
  check('Esc hides it', !(await overlayVisible(p)));
  await toggleFor(p);
  await sleep(900);
  frame = todoFrame(p);
  await frame.click('.todo-close');
  await sleep(700);
  check('The ✕ button hides it', !(await overlayVisible(p)));

  // clicks pass through to the page when hidden
  await toggleFor(p);
  await sleep(900);
  await toggleFor(p);
  await sleep(700);
  const linkClickable = await p.evaluate(() => {
    const a = document.querySelector('a');
    const r = a.getBoundingClientRect();
    return document.elementFromPoint(r.left + 5, r.top + 5) === a;
  });
  check('When hidden, the page works normally underneath', linkClickable);

  // a site with a strict Content-Security-Policy
  const gh = await browser.newPage();
  watch(gh, 'github', errors);
  await gh.setViewport({ width: 1280, height: 800 });
  await gh.goto('https://github.com/', { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  await toggleFor(gh);
  await sleep(1500);
  const ghFrame = todoFrame(gh);
  const ghOk = ghFrame ? await ghFrame.waitForSelector('.todo-text', { timeout: 5000 }).then(() => true, () => false) : false;
  check('Works on sites with strict security rules (github.com)', ghOk && (await overlayVisible(gh)));
  await gh.screenshot({ path: path.join(OUT, 'overlay-github.png') });

  // chrome:// pages can't be injected into -> falls back to the side panel
  const cp = await browser.newPage();
  await cp.goto('chrome://version');
  await sleep(500);
  const swLog = [];
  (await worker.current()).on('console', (msg) => swLog.push(msg.text()));
  await worker.evaluate(async () => {
    // Chrome doesn't expose chrome:// URLs to extensions — just like the real click.
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    self.__sequoiaTogglePanel(tab);
  });
  await sleep(800);
  check('On chrome:// pages it uses the side panel instead (needs your real click)', swLog.some((t) => /could not open the side panel: .*user gesture/.test(t)) && !swLog.some((t) => /floating to-do/.test(t)), swLog.join(' | '));

  // narrow window: still fits
  await p.bringToFront();
  await p.setViewport({ width: 420, height: 700 });
  await toggleFor(p);
  await sleep(900);
  const fit = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  check('Fits on narrow windows without horizontal scroll', fit && (await overlayVisible(p)));

  const relevant = errors.filter((e) => !/net::ERR_ABORTED|ERR_NAME_NOT_RESOLVED|github|favicon|Failed to load resource/i.test(e));
  check('No console errors from the extension', relevant.length === 0, relevant.join('\n'));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  site.server.close();
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('HARNESS ERROR', e);
  process.exit(2);
});

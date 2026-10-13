// End-to-end tests for Sequoia Tab in Chrome for Testing.
const fs = require('fs');
const { launch, watch, sleep, OUT, path } = require('./common');

const results = [];
const errors = [];
function check(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: String(detail).slice(0, 300) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 200) : ''}`);
}
const PROFILE = 'p-e2e';
const ONLY = process.argv[2] ? process.argv[2].split(',') : null;
const want = (g) => !ONLY || ONLY.includes(g);

let JPEG;
const UNSPLASH_LOG = [];

async function storageGet(worker, keys = null) {
  return worker.evaluate((k) => chrome.storage.local.get(k), keys);
}
async function storageSet(worker, obj) {
  return worker.evaluate((o) => chrome.storage.local.set(o), obj);
}

async function openNtp(browser, label = 'ntp', { intercept = true } = {}) {
  const page = await browser.newPage();
  watch(page, label, errors);
  if (intercept) await interceptImages(page);
  await page.goto('chrome://newtab');
  await page.waitForSelector('.clock-time', { timeout: 10000 });
  await sleep(600);
  return page;
}

// Serve a local JPEG for images.unsplash.com so mocked photos render.
async function interceptImages(page) {
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (u.startsWith('https://images.unsplash.com/')) {
      UNSPLASH_LOG.push('img ' + u);
      return req.respond({ status: 200, contentType: 'image/jpeg', headers: { 'Access-Control-Allow-Origin': '*' }, body: JPEG });
    }
    if (/^https:\/\/(www\.google\.com|www\.bing\.com|duckduckgo\.com|example\.com)/.test(u) && req.isNavigationRequest()) {
      return req.respond({ status: 200, contentType: 'text/html', body: '<title>stub</title>stub' });
    }
    req.continue();
  });
}

// Replace fetch in the service worker with an Unsplash mock.
async function mockUnsplash(worker, mode = 'ok') {
  await worker.evaluate((mode) => {
    self.__real = self.__real || self.fetch;
    self.__calls = self.__calls || [];
    self.__mode = mode;
    let n = self.__n || 0;
    self.fetch = async (url, opts) => {
      const u = String(url);
      if (!u.startsWith('https://api.unsplash.com/')) return self.__real(url, opts);
      self.__calls.push(u);
      if (self.__mode === 'offline') throw new TypeError('Failed to fetch');
      if (self.__mode === 'ratelimit') return new Response('Rate Limit Exceeded', { status: 403 });
      if (u.includes('/download')) return new Response('{"url":"x"}', { status: 200 });
      const count = Number(new URL(u).searchParams.get('count') || 1);
      const photos = Array.from({ length: count }, () => {
        n += 1;
        self.__n = n;
        return {
          id: 'mock' + n,
          color: n % 2 ? '#203040' : '#e0e8f0',
          width: 4000, height: 2600,
          alt_description: 'mock photo ' + n,
          urls: { raw: `https://images.unsplash.com/photo-mock${n}?ixid=abc`, small: `https://images.unsplash.com/photo-mock${n}?w=400` },
          links: { html: `https://unsplash.com/photos/mock${n}`, download_location: `https://api.unsplash.com/photos/mock${n}/download?ixid=abc` },
          user: { name: 'Test Author ' + n, links: { html: 'https://unsplash.com/@tester' } },
        };
      });
      return new Response(JSON.stringify(photos), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  }, mode);
}
const apiCalls = (worker) => worker.evaluate(() => (self.__calls || []).slice());
const resetCalls = (worker) => worker.evaluate(() => (self.__calls = []));

async function setSettings(worker, mutate) {
  const { settings } = await storageGet(worker, 'settings');
  const s = JSON.parse(JSON.stringify(settings));
  mutate(s);
  await storageSet(worker, { settings: s });
  await sleep(500);
  return s;
}

(async () => {
  fs.rmSync(path.join(__dirname, PROFILE), { recursive: true, force: true });
  let { browser, swTarget, extId } = await launch({ profile: PROFILE });
  let worker = await swTarget.worker();
  worker.on('console', (m) => ['error', 'warning'].includes(m.type()) && errors.push('[sw] ' + m.text()));

  // make a JPEG for mocked Unsplash photos and an upload
  {
    const p = await browser.newPage();
    await p.setViewport({ width: 1600, height: 1000 });
    await p.setContent('<body style="margin:0;height:100vh;background:linear-gradient(135deg,#0b3d2e,#1e6f5c 40%,#e9c46a)"></body>');
    JPEG = await p.screenshot({ type: 'jpeg', quality: 85 });
    fs.writeFileSync(path.join(OUT, 'upload-test.jpg'), JPEG);
    await p.screenshot({ path: path.join(OUT, 'upload-test.png'), clip: { x: 0, y: 0, width: 1200, height: 800 } });
    fs.writeFileSync(path.join(OUT, 'not-an-image.png'), 'this is plain text, not a PNG'.repeat(10));
    await p.close();
  }

  // ---------------------------------------------------------------- 1. install
  {
    const page = await openNtp(browser, 'install');
    const url = page.url();
    check('1. New Tab override loads the extension page', url.startsWith(`chrome-extension://${extId}/newtab.html`), url);
    const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
    check('1. Manifest V3 with minimal permissions', manifest.manifest_version === 3 && JSON.stringify(manifest.permissions) === JSON.stringify(['storage', 'bookmarks', 'alarms', 'favicon', 'search']) && !manifest.host_permissions, JSON.stringify(manifest.permissions));
    const tiles = await page.$$eval('.tile:not(.tile-add) .tile-link', (as) => as.map((a) => [a.querySelector('.tile-label').textContent, a.getAttribute('href')]));
    const expected = [
      ['All Plugings', 'https://profiles.wordpress.org/bplugins/#content-plugins'],
      ['My plugin', 'https://profiles.wordpress.org/shihabshamim/#content-plugins'],
      ['Gmail', 'https://mail.google.com/mail/u/0/#inbox'],
      ['bplugins mail', 'https://gcam1012.siteground.biz/webmail/mail/'],
      ['Present sheet', 'https://bplugins.pihr.xyz/selfservice/mydashboard'],
      ['Freemius', 'https://dashboard.freemius.com/#!/live/stores/2229/products/'],
      ['ClickUp', 'https://app.clickup.com/90181405997/v/li/901810231124'],
      ['Support Desk', 'https://tickets.bplugins.com/inbox'],
      ['Daily Workshit', 'https://docs.google.com/document/d/1JPL_HgQtZRAyX-yL8xDvekhUHeUQr4fYGHd_U_wwF-w/edit?tab=t.21ok41kn5in9'],
      ['mail swarm', 'https://mailswarm.vercel.app/'],
    ];
    check('2. All 10 links from the screenshot are shown with exact URLs', JSON.stringify(tiles) === JSON.stringify(expected), JSON.stringify(tiles.map((t) => t[0])));
    const firstRowTops = await page.$$eval('.tile', (ts) => ts.slice(0, 10).map((t) => Math.round(t.getBoundingClientRect().top)));
    check('2. The 10 shortcuts sit on one row at 1280px', new Set(firstRowTops).size === 1, firstRowTops.join(','));
    await page.screenshot({ path: path.join(OUT, '01-default.png') });
    await page.close();
  }

  // ---------------------------------------------------------------- 3/4. bookmarks
  if (want('bookmarks')) {
    const before = await worker.evaluate(async () => {
      const tree = await chrome.bookmarks.getTree();
      const bar = tree[0].children[0];
      const a = await chrome.bookmarks.create({ parentId: bar.id, title: 'Example', url: 'https://example.com/' });
      const f = await chrome.bookmarks.create({ parentId: bar.id, title: 'Work' });
      await chrome.bookmarks.create({ parentId: f.id, title: 'Docs', url: 'https://example.com/docs' });
      const sub = await chrome.bookmarks.create({ parentId: f.id, title: 'Nested' });
      await chrome.bookmarks.create({ parentId: sub.id, title: 'Deep link', url: 'https://example.com/deep' });
      await chrome.bookmarks.create({ parentId: bar.id, title: 'Bookmarklet', url: 'javascript:alert(1)' });
      for (let i = 0; i < 25; i++) await chrome.bookmarks.create({ parentId: bar.id, title: 'Overflow item ' + i, url: 'https://example.com/o' + i });
      await chrome.bookmarks.create({ parentId: tree[0].children[1].id, title: 'Other one', url: 'https://example.com/other' });
      return JSON.stringify(await chrome.bookmarks.getTree());
    });
    const page = await openNtp(browser, 'bookmarks');
    await sleep(500);
    const barItems = await page.$$eval('.bm-list > li:not([hidden]) .bm-item', (els) => els.map((e) => e.textContent));
    check('3. Bookmarks bar shows Chrome bookmarks', barItems[0] === 'Example' && barItems[1] === 'Work', barItems.slice(0, 4).join(' | '));
    const overflowShown = await page.$eval('.bm-overflow', (e) => !e.hidden);
    const hiddenCount = await page.$$eval('.bm-list > li[hidden]', (e) => e.length);
    check('3. Overflowing bookmarks move into the » menu', overflowShown && hiddenCount > 0, `hidden=${hiddenCount}`);
    const hasOther = await page.$$eval('.bookmarks-bar > .bm-item', (els) => els.map((e) => e.textContent));
    check('3. "Other bookmarks" folder is shown', hasOther.some((t) => /Other/i.test(t)), hasOther.join('|'));
    // Open Work folder -> Nested submenu via keyboard
    const work = (await page.$$('.bm-list .bm-item'))[1];
    await work.focus();
    await page.keyboard.press('ArrowDown');
    await sleep(200);
    const menu1 = await page.$$eval('.menu .menu-item', (els) => els.map((e) => e.textContent));
    const focused1 = await page.evaluate(() => document.activeElement.textContent);
    check('4. Folder opens as a menu via keyboard (ArrowDown) with focus on first item', menu1.includes('Docs') && focused1 === 'Docs', menu1.join('|'));
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await sleep(250);
    const menus = await page.$$eval('.menu', (m) => m.length);
    const focused2 = await page.evaluate(() => document.activeElement.textContent);
    check('4. Nested folder opens as submenu (ArrowRight)', menus === 2 && focused2 === 'Deep link', `${menus} menus, focus=${focused2}`);
    const deepHref = await page.evaluate(() => document.activeElement.getAttribute('href'));
    check('4. Nested bookmark is a real link', deepHref === 'https://example.com/deep', deepHref);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await sleep(150);
    const afterEsc = await page.evaluate(() => ({ menus: document.querySelectorAll('.menu').length, focus: document.activeElement.textContent }));
    check('4. Escape closes menus and returns focus to folder', afterEsc.menus === 0 && afterEsc.focus === 'Work', JSON.stringify(afterEsc));
    // click a bookmark -> navigates
    const nav = page.waitForNavigation({ timeout: 8000 }).catch(() => null);
    await page.click('.bm-list .bm-item[href="https://example.com/"]');
    await nav;
    check('4. Clicking a bookmark navigates normally', page.url() === 'https://example.com/', page.url());
    const after = await worker.evaluate(async () => JSON.stringify(await chrome.bookmarks.getTree()));
    const strip = (s) => s.replace(/"dateLastUsed":\d+(\.\d+)?,?/g, '');
    check('3. Bookmarks are unchanged after use (read-only)', strip(before) === strip(after));
    // live update
    const p2 = await openNtp(browser, 'bookmarks2');
    await worker.evaluate(async () => {
      const tree = await chrome.bookmarks.getTree();
      await chrome.bookmarks.create({ parentId: tree[0].children[0].id, index: 0, title: 'Live added', url: 'https://example.com/live' });
    });
    await sleep(600);
    const first = await p2.$eval('.bm-list .bm-item', (e) => e.textContent);
    check('3. Bookmarks bar updates live when bookmarks change in Chrome', first === 'Live added', first);
    await p2.screenshot({ path: path.join(OUT, '02-bookmarks.png') });
    await p2.close();
    await page.close();
  }

  // ---------------------------------------------------------------- 5. search
  if (want('search')) {
    const page = await openNtp(browser, 'search');
    await setSettings(worker, (s) => (s.search.engine = 'google'));
    await sleep(300);
    await page.click('#search-input');
    await page.type('#search-input', 'macos wallpapers');
    let nav = page.waitForNavigation({ timeout: 8000 }).catch(() => null);
    await page.keyboard.press('Enter');
    await nav;
    check('5. Enter searches with the selected engine (Google)', decodeURIComponent(page.url()).includes('https://www.google.com/search?q=macos%20wallpapers'), page.url());

    await page.goto('chrome://newtab');
    await page.waitForSelector('#search-input');
    await setSettings(worker, (s) => (s.search.engine = 'duckduckgo'));
    await page.type('#search-input', 'hello');
    nav = page.waitForNavigation({ timeout: 8000 }).catch(() => null);
    await page.keyboard.press('Enter');
    await nav;
    check('5. Switching engine to DuckDuckGo is honoured', page.url().startsWith('https://duckduckgo.com/?q=hello'), page.url());

    await page.goto('chrome://newtab');
    await page.waitForSelector('#search-input');
    await page.type('#search-input', 'example.com');
    nav = page.waitForNavigation({ timeout: 8000 }).catch(() => null);
    await page.keyboard.press('Enter');
    await nav;
    check('5. Typing an address opens it directly', page.url() === 'https://example.com/', page.url());

    await page.goto('chrome://newtab');
    await page.waitForSelector('#search-input');
    await setSettings(worker, (s) => (s.search.engine = 'default'));
    await page.type('#search-input', 'chrome default engine');
    nav = page.waitForNavigation({ timeout: 8000 }).catch(() => null);
    await page.keyboard.press('Enter');
    await nav;
    await sleep(500);
    check('5. "Chrome default" searches with Chrome\'s configured engine (chrome.search)', /google\.com\/search\?q=chrome(\+|%20)default(\+|%20)engine/.test(decodeURIComponent(page.url())), page.url());

    // engine menu via keyboard
    await page.goto('chrome://newtab');
    await page.waitForSelector('.search-engine-btn');
    await page.focus('.search-engine-btn');
    await page.keyboard.press('ArrowDown');
    await sleep(200);
    const items = await page.$$eval('.menu .menu-item', (els) => els.map((e) => e.textContent));
    check('5. Engine picker menu opens via keyboard', items.includes('Google') && items.includes('Bing'), items.join('|'));
    await page.keyboard.press('Escape');
    // "/" focuses search
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('/');
    const focused = await page.evaluate(() => document.activeElement.id);
    check('13. "/" focuses the search box', focused === 'search-input', focused);
    await page.close();
  }

  // ---------------------------------------------------------------- shortcuts CRUD
  if (want('shortcuts')) {
    const page = await openNtp(browser, 'shortcuts');
    await page.click('.tile-add .tile-link');
    await page.waitForSelector('dialog[open] #ld-url');
    await page.type('#ld-url', 'javascript:alert(1)');
    await page.click('dialog[open] button[type=submit]');
    const err = await page.$eval('dialog[open] .form-error', (e) => e.textContent);
    check('Shortcuts: unsafe URLs (javascript:) are rejected', /valid web address/.test(err), err);
    await page.$eval('#ld-url', (e) => (e.value = ''));
    await page.type('#ld-url', 'github.com');
    await page.type('#ld-name', 'GitHub'); // suggested name is selected, typing replaces it
    await page.click('dialog[open] button[type=submit]');
    await sleep(400);
    let { shortcuts } = await storageGet(worker, 'shortcuts');
    check('Shortcuts: add normalises URL and persists', shortcuts.length === 11 && shortcuts[10].url === 'https://github.com/' && shortcuts[10].title === 'GitHub');
    // move GitHub left via menu
    const more = await page.$$('.tile-more');
    await more[10].click();
    await sleep(150);
    await page.evaluate(() => [...document.querySelectorAll('.menu-item')].find((b) => b.textContent === 'Move left').click());
    await sleep(300);
    ({ shortcuts } = await storageGet(worker, 'shortcuts'));
    check('Shortcuts: reorder (Move left) persists', shortcuts[9].title === 'GitHub', shortcuts.map((s) => s.title).slice(8).join(','));
    // keyboard reorder: Ctrl+Shift+Right on GitHub tile
    await page.focus('.tile[data-id="' + shortcuts[9].id + '"] .tile-link');
    await page.keyboard.down('Control'); await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.up('Shift'); await page.keyboard.up('Control');
    await sleep(300);
    ({ shortcuts } = await storageGet(worker, 'shortcuts'));
    check('Shortcuts: keyboard reorder (Ctrl+Shift+→)', shortcuts[10].title === 'GitHub');
    // drag & drop GitHub to first position
    const src = await page.$('.tile[data-id="' + shortcuts[10].id + '"]');
    const dst = await page.$('.tile[data-id="' + shortcuts[0].id + '"]');
    await page.evaluate((s, d) => {
      const dt = new DataTransfer();
      const r = d.getBoundingClientRect();
      s.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      d.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 5, clientY: r.top + 5 }));
      d.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 5, clientY: r.top + 5 }));
      s.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    }, src, dst);
    await sleep(300);
    ({ shortcuts } = await storageGet(worker, 'shortcuts'));
    check('Shortcuts: drag & drop reorder', shortcuts[0].title === 'GitHub', shortcuts.map((s) => s.title).slice(0, 3).join(','));
    // edit
    await (await page.$$('.tile-more'))[0].click();
    await sleep(150);
    await page.evaluate(() => [...document.querySelectorAll('.menu-item')].find((b) => b.textContent === 'Edit…').click());
    await page.waitForSelector('dialog[open] #ld-name');
    await page.$eval('#ld-name', (e) => (e.value = ''));
    await page.type('#ld-name', 'GitHub Home');
    await page.click('dialog[open] button[type=submit]');
    await sleep(300);
    ({ shortcuts } = await storageGet(worker, 'shortcuts'));
    check('Shortcuts: edit persists', shortcuts[0].title === 'GitHub Home');
    // other tab gets update
    const p2 = await openNtp(browser, 'shortcuts2');
    await page.bringToFront();
    await (await page.$$('.tile-more'))[0].click();
    await sleep(150);
    await page.evaluate(() => [...document.querySelectorAll('.menu-item')].find((b) => b.textContent === 'Remove').click());
    await sleep(500);
    const titles2 = await p2.$$eval('.tile:not(.tile-add) .tile-label', (e) => e.map((x) => x.textContent));
    check('10. Removing in one tab updates other open tabs', titles2.length === 10 && !titles2.includes('GitHub Home'), titles2.length);
    ({ shortcuts } = await storageGet(worker, 'shortcuts'));
    check('Shortcuts: remove restores the original 10 in order', shortcuts.map((s) => s.title).join(',') === 'All Plugings,My plugin,Gmail,bplugins mail,Present sheet,Freemius,ClickUp,Support Desk,Daily Workshit,mail swarm');
    await p2.close();
    // clicking a shortcut navigates
    await page.close();
  }

  // ---------------------------------------------------------------- settings UI + persistence
  if (want('settings')) {
    const page = await openNtp(browser, 'settings');
    await page.click('#corner-actions .round-btn');
    await page.waitForSelector('dialog.settings-dialog[open]');
    const tabs = await page.$$eval('.side-tab', (t) => t.map((x) => x.textContent));
    check('Settings: panel opens with all sections', tabs.length === 9, tabs.join('|'));
    for (const id of ['appearance', 'widgets', 'clock', 'search', 'shortcuts', 'dock', 'bookmarks', 'about', 'wallpaper']) {
      await page.click(`#tab-${id}`);
      await sleep(120);
    }
    check('Settings: every section renders without errors', !errors.some((e) => e.includes('[settings]')), errors.filter((e) => e.includes('[settings]')).join(' / '));
    await page.click('#tab-clock');
    await page.evaluate(() => [...document.querySelectorAll('.segmented button')].find((b) => b.textContent === '24-hour').click());
    await sleep(400);
    const clock = await page.$eval('.clock-time', (e) => e.textContent);
    check('Settings: 24-hour clock applies instantly', !/AM|PM/.test(clock) && /^\d{2}:\d{2}$/.test(clock), clock);
    await page.click('#tab-appearance');
    await page.evaluate(() => [...document.querySelectorAll('.segmented button')].find((b) => b.textContent === 'Dark').click());
    await sleep(300);
    check('Settings: dark theme applies', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
    // widgets: hide search, move shortcuts up
    await page.click('#tab-widgets');
    await page.click('[data-k="w-vis-search"] input');
    await page.click('[data-k="w-up-shortcuts"]');
    await sleep(400);
    const layout = await page.evaluate(() => ({ searchHidden: document.getElementById('w-search').hidden, order: [...document.getElementById('stage').children].map((c) => c.id) }));
    check('6/Widgets: hide + reorder widgets', layout.searchHidden && layout.order.join() === 'w-clock,w-shortcuts,w-search', JSON.stringify(layout));
    await page.click('[data-k="w-vis-search"] input');
    await page.click('[data-k="w-down-shortcuts"]');
    await sleep(300);
    const restored = await page.evaluate(() => [...document.getElementById('stage').children].map((c) => c.id + (c.hidden ? ':hidden' : '')).join());
    check('Widgets: order and visibility restore', restored === 'w-clock,w-search,w-shortcuts', restored);
    await page.click('#tab-shortcuts');
    await page.evaluate(() => [...document.querySelectorAll('.segmented button')].find((b) => b.textContent === 'Large').click());
    await page.click('#tab-dock');
    await page.evaluate(() => [...document.querySelectorAll('.segmented button')].find((b) => b.textContent === 'Left').click());
    await sleep(400);
    check('Settings: dock position applies', (await page.$eval('#dock', (d) => d.dataset.pos)) === 'left');
    await page.screenshot({ path: path.join(OUT, '03-settings-dock-left.png') });
    await page.keyboard.press('Escape');
    await sleep(300);
    check('13. Escape closes the settings dialog', (await page.$('dialog[open]')) === null);
    await page.close();
  }

  // ---------------------------------------------------------------- 6. uploads
  if (want('uploads')) {
    const page = await openNtp(browser, 'uploads');
    await page.click('#corner-actions .round-btn');
    await page.waitForSelector('dialog[open]');
    await page.click('#tab-wallpaper');
    await page.evaluate(() => [...document.querySelectorAll('.segmented button')].find((b) => b.textContent === 'My Photos').click());
    await sleep(500);
    const input = await page.$('dialog[open] input[type=file]');
    await input.uploadFile(path.join(OUT, 'not-an-image.png'));
    await sleep(800);
    const toasts = await page.$$eval('.toast', (t) => t.map((x) => x.textContent));
    check('6. Invalid files are rejected with a message', toasts.some((t) => /isn’t a JPG|doesn’t look like|damaged/.test(t)), toasts.join(' / '));
    await input.uploadFile(path.join(OUT, 'upload-test.jpg'));
    await page.waitForFunction(() => document.querySelectorAll('dialog[open] .thumbs .thumb').length === 1, { timeout: 8000 }).catch(() => {});
    await sleep(1500);
    const st = await storageGet(worker, ['wallpaperState', 'settings']);
    check('6. Uploaded image becomes the wallpaper', st.wallpaperState.current?.kind === 'upload' && st.settings.wallpaper.uploadsDefaultId === st.wallpaperState.current.id, JSON.stringify(st.wallpaperState.current));
    const shown = await page.evaluate(() => {
      const img = document.querySelector('.wall-layer.is-active img');
      return img ? { src: img.src.slice(0, 20), w: img.naturalWidth } : null;
    });
    check('6. Uploaded image is displayed', shown?.src.startsWith('blob:') && shown.w === 1600, JSON.stringify(shown));
    await page.keyboard.press('Escape');
    await sleep(300);
    await page.screenshot({ path: path.join(OUT, '04-upload.png') });
    // second upload & remove
    await page.click('#corner-actions .round-btn');
    await page.waitForSelector('dialog[open] input[type=file]');
    await (await page.$('dialog[open] input[type=file]')).uploadFile(path.join(OUT, 'upload-test.png'));
    await sleep(1500);
    const count = await page.$$eval('dialog[open] .thumbs .thumb', (t) => t.length);
    check('6. Gallery lists multiple uploads (PNG too)', count === 2, count);
    page.once('dialog', () => {});
    await page.$eval('dialog[open] .thumb-actions button', (b) => b.click());
    await page.waitForSelector('dialog.form-dialog[open]');
    await page.evaluate(() => [...document.querySelectorAll('dialog.form-dialog[open] button')].find((b) => b.textContent === 'Remove').click());
    await sleep(1200);
    const after = await storageGet(worker, ['wallpaperState', 'settings']);
    const left = await worker.evaluate(() => new Promise((res) => { const r = indexedDB.open('sequoia-tab'); r.onsuccess = () => { const t = r.result.transaction('wallpapers').objectStore('wallpapers').count(); t.onsuccess = () => res(t.result); }; }));
    check('6. Removing the default image falls back to the remaining one', left === 1 && after.wallpaperState.current.kind === 'upload' && after.settings.wallpaper.uploadsDefaultId === null, `left=${left} cur=${JSON.stringify(after.wallpaperState.current)}`);
    await page.keyboard.press('Escape');
    await page.close();
  }

  // ---------------------------------------------------------------- 7. Unsplash
  if (want('unsplash')) {
    // invalid key — real network request to api.unsplash.com
    await worker.evaluate(() => { if (self.__real) self.fetch = self.__real; });
    const page = await openNtp(browser, 'unsplash');
    await page.click('#corner-actions .round-btn');
    await page.waitForSelector('dialog[open]');
    await page.click('#tab-wallpaper');
    await page.evaluate(() => [...document.querySelectorAll('.segmented button')].find((b) => b.textContent === 'Unsplash').click());
    await sleep(1200);
    let st = (await storageGet(worker, 'wallpaperState')).wallpaperState;
    check('7. No key: clear message, previous wallpaper kept', st.status.code === 'no-key' && st.current.kind === 'upload', JSON.stringify(st.status));
    await page.waitForSelector('#unsplash-key');
    await page.type('#unsplash-key', 'invalidkey_invalidkey_invalidkey_0000');
    await page.evaluate(() => [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Save & test').click());
    await page.waitForFunction(() => /rejected|refused|reach/i.test(document.querySelector('dialog[open] .status-line.err')?.textContent || ''), { timeout: 15000 }).catch(() => {});
    const msg = await page.evaluate(() => [...document.querySelectorAll('dialog[open] .status-line')].map((e) => e.textContent).join(' | '));
    check('7. Invalid key is reported (real Unsplash 401)', /rejected the Access Key/.test(msg), msg);
    await sleep(800);
    st = (await storageGet(worker, 'wallpaperState')).wallpaperState;
    check('7. Invalid key keeps the current wallpaper and backs off', st.current.kind === 'upload' && st.status.code === 'invalid-key' && st.backoffUntil > Date.now(), JSON.stringify(st.status));
    await resetCalls(worker);
    await mockUnsplash(worker, 'ok');
    // Reload a tab: backoff must prevent another request
    await page.reload();
    await page.waitForSelector('.clock-time');
    await sleep(800);
    check('7. Back-off prevents repeated failing requests on new tabs', (await apiCalls(worker)).length === 0, (await apiCalls(worker)).join());

    // valid key (mocked API)
    await storageSet(worker, { secrets: { unsplashKey: 'validmockkey_validmockkey_1234567' } });
    await page.waitForFunction(() => /Photo by Test Author/.test(document.getElementById('attribution').textContent), { timeout: 10000 }).catch(() => {});
    await sleep(800);
    st = (await storageGet(worker, 'wallpaperState')).wallpaperState;
    let calls = await apiCalls(worker);
    const randomCalls = calls.filter((c) => c.includes('/photos/random'));
    check('7. Valid key: photos fetched in one batch of 30', randomCalls.length === 1 && /count=30/.test(randomCalls[0]) && st.queue.length === 29, calls.join(' , '));
    check('7. Category query is sent', /query=(nature|mountains)/.test(randomCalls[0]), randomCalls[0]);
    check('7. Download endpoint pinged for displayed photo (API guideline)', calls.some((c) => c.includes(`/photos/${st.current.photo.id}/download`)), calls.join(' , '));
    const attrib = await page.$$eval('#attribution a', (as) => as.map((a) => [a.textContent, a.href]));
    check('7. Photographer attribution with UTM links', attrib.length === 2 && attrib[0][0].startsWith('Test Author') && attrib.every(([, h]) => /utm_source=sequoia_tab&utm_medium=referral/.test(h)), JSON.stringify(attrib));
    const img = await page.evaluate(() => document.querySelector('.wall-layer.is-active img')?.src || '');
    check('7. Image is hotlinked from images.unsplash.com and sized', img.startsWith('https://images.unsplash.com/photo-mock') && /[?&]w=\d+/.test(img), img);
    // Next button: no new API batch
    await resetCalls(worker);
    await page.keyboard.press('Escape');
    await page.hover('#attribution');
    await page.click('#attribution .round-btn[aria-label="Next wallpaper"]');
    await sleep(1200);
    calls = await apiCalls(worker);
    const st2 = (await storageGet(worker, 'wallpaperState')).wallpaperState;
    check('7. Next wallpaper uses the cached queue (no new batch request)', st2.current.photo.id !== st.current.photo.id && !calls.some((c) => c.includes('/photos/random')) && st2.queue.length === 28, calls.join());
    // favorite
    await page.click('#attribution .round-btn[aria-label="Add to favorites"]');
    await sleep(400);
    const favs = (await storageGet(worker, 'favorites')).favorites;
    check('Favorites: heart saves the current photo', favs.length === 1 && favs[0].id === st2.current.photo.id);
    await page.screenshot({ path: path.join(OUT, '05-unsplash.png') });

    // Rate limit handling
    await setSettings(worker, (s) => s.wallpaper.categories = ['ocean']); // new query -> needs new batch
    await mockUnsplash(worker, 'ratelimit');
    await setSettings(worker, (s) => s.wallpaper.categories = ['cities']);
    await sleep(800);
    const st3 = (await storageGet(worker, 'wallpaperState')).wallpaperState;
    check('14. Rate limit: message shown, wallpaper kept, 15-min back-off', st3.status.code === 'rate-limited' && st3.current.kind === 'unsplash' && st3.backoffUntil - Date.now() > 14 * 60_000, JSON.stringify(st3.status));
    // Offline
    await mockUnsplash(worker, 'offline');
    await setSettings(worker, (s) => s.wallpaper.categories = ['forest']);
    await sleep(800);
    const st4 = (await storageGet(worker, 'wallpaperState')).wallpaperState;
    check('14. Offline API: graceful message, wallpaper kept', st4.status.code === 'offline' && st4.current.kind === 'unsplash', JSON.stringify(st4.status));
    await page.reload();
    await page.waitForSelector('.clock-time');
    await sleep(500);
    const statusText = await page.$eval('#attribution', (e) => e.textContent);
    check('14. Offline status is visible to the user', /Could not reach Unsplash/.test(statusText), statusText);
    // Offline page: image fails to load
    await mockUnsplash(worker, 'ok');
    await setSettings(worker, (s) => s.wallpaper.categories = ['nature', 'mountains']);
    await sleep(1000);
    const p3 = await browser.newPage();
    watch(p3, 'offline-page', []);
    await p3.goto('chrome://newtab');
    await p3.waitForSelector('.clock-time');
    await p3.setOfflineMode(true);
    await worker.evaluate(() => chrome.runtime.sendMessage);
    const before = (await storageGet(worker, 'wallpaperState')).wallpaperState.current.photo.id;
    await p3.evaluate(() => document.querySelector('#attribution .round-btn')?.click());
    await sleep(2500);
    const t3 = await p3.$$eval('.toast', (t) => t.map((x) => x.textContent));
    const layerOk = await p3.evaluate(() => !!document.querySelector('.wall-layer.is-active'));
    check('14. Image offline: previous wallpaper stays and a notice appears', layerOk && t3.some((t) => /offline|couldn’t be loaded/i.test(t)), `${before} ${t3.join('/')}`);
    await p3.setOfflineMode(false);
    await p3.close();
    await page.close();
  }

  // ---------------------------------------------------------------- 8/9/10 rotation
  if (want('rotation')) {
    await mockUnsplash(worker, 'ok');
    await setSettings(worker, (s) => { s.wallpaper.source = 'preset'; s.wallpaper.presetId = 'sequoia'; s.wallpaper.interval = '1m'; s.wallpaper.paused = false; });
    await sleep(800);
    const page = await openNtp(browser, 'rot1');
    const s0 = (await storageGet(worker, 'wallpaperState')).wallpaperState;
    const alarm = await worker.evaluate(() => chrome.alarms.get('wallpaper-rotate'));
    check('8. 1-minute alarm scheduled from the persisted timestamp', alarm && alarm.periodInMinutes === 1 && Math.abs(alarm.scheduledTime - (s0.changedAt + 60000)) < 3000, JSON.stringify(alarm));
    console.log('   waiting ~65s for the 1-minute rotation…');
    await sleep(64000);
    const s1 = (await storageGet(worker, 'wallpaperState')).wallpaperState;
    const elapsed = s1.changedAt - s0.changedAt;
    check('8. Wallpaper rotates after 1 minute', s1.current.id !== s0.current.id && elapsed >= 58000 && elapsed < 66000, `${s0.current.id} -> ${s1.current.id} after ${elapsed}ms`);
    const shown = await page.evaluate(() => document.getElementById('attribution').textContent);
    check('8. Open tab shows the rotated wallpaper', shown.includes(s1.current.id === 'sonoma' ? 'Sonoma' : ''), shown);

    // pause
    await setSettings(worker, (s) => (s.wallpaper.paused = true));
    const alarmPaused = await worker.evaluate(() => chrome.alarms.get('wallpaper-rotate'));
    check('Pause clears the rotation alarm', !alarmPaused, JSON.stringify(alarmPaused));
    await setSettings(worker, (s) => (s.wallpaper.paused = false));

    // 5-minute via persisted timestamps
    await setSettings(worker, (s) => (s.wallpaper.interval = '5m'));
    let st = (await storageGet(worker, 'wallpaperState')).wallpaperState;
    await storageSet(worker, { wallpaperState: { ...st, changedAt: Date.now() - 4 * 60_000 } });
    await page.reload();
    await page.waitForSelector('.clock-time');
    await sleep(800);
    let st2 = (await storageGet(worker, 'wallpaperState')).wallpaperState;
    check('8. 5-minute: not due after 4 minutes', st2.current.id === st.current.id);
    await storageSet(worker, { wallpaperState: { ...st2, changedAt: Date.now() - 5 * 60_000 - 1000 } });
    await page.reload();
    await page.waitForSelector('.clock-time');
    await sleep(800);
    const st3 = (await storageGet(worker, 'wallpaperState')).wallpaperState;
    check('8/9. 5-minute: rotates on open once due (survives reloads, timestamp based)', st3.current.id !== st2.current.id && Date.now() - st3.changedAt < 5000);
    const alarm5 = await worker.evaluate(() => chrome.alarms.get('wallpaper-rotate'));
    check('8. 5-minute alarm rescheduled', alarm5?.periodInMinutes === 5 && Math.abs(alarm5.scheduledTime - (st3.changedAt + 300000)) < 3000, JSON.stringify(alarm5));

    // daily
    await setSettings(worker, (s) => (s.wallpaper.interval = '1d'));
    st = (await storageGet(worker, 'wallpaperState')).wallpaperState;
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1); yesterday.setHours(23, 0, 0, 0);
    await storageSet(worker, { wallpaperState: { ...st, changedAt: yesterday.getTime() } });
    await page.reload();
    await page.waitForSelector('.clock-time');
    await sleep(800);
    st2 = (await storageGet(worker, 'wallpaperState')).wallpaperState;
    check('Daily: changes once the calendar day changes', st2.current.id !== st.current.id);

    // 10. multiple tabs, Unsplash, due -> only 1 batch request
    await storageSet(worker, { secrets: { unsplashKey: 'validmockkey_validmockkey_1234567' } });
    await setSettings(worker, (s) => { s.wallpaper.source = 'unsplash'; s.wallpaper.categories = ['abstract']; s.wallpaper.interval = '1m'; });
    await sleep(1500);
    st = (await storageGet(worker, 'wallpaperState')).wallpaperState;
    await storageSet(worker, { wallpaperState: { ...st, changedAt: Date.now() - 120_000, queue: [] } });
    await resetCalls(worker);
    const pages = await Promise.all(Array.from({ length: 5 }, (_, i) => openNtp(browser, 'multi' + i)));
    await sleep(2000);
    const calls = await apiCalls(worker);
    const batches = calls.filter((c) => c.includes('/photos/random')).length;
    const ids = [];
    for (const p of pages) { await p.bringToFront(); await sleep(400); ids.push(await p.evaluate(() => document.querySelector('.wall-layer.is-active img')?.src || '')); }
    const finalSt = (await storageGet(worker, 'wallpaperState')).wallpaperState;
    check('10. Five tabs opening at once trigger exactly one API batch', batches === 1, calls.join(' , '));
    check('10. All tabs show the same wallpaper', new Set(ids).size === 1 && ids[0].includes(finalSt.current.photo.id.replace('mock', 'photo-mock')), ids.map((x) => x.slice(28, 50)).join(','));
    for (const p of pages) await p.close();
    await setSettings(worker, (s) => { s.wallpaper.interval = 'off'; });
    await page.close();
  }

  // ---------------------------------------------------------------- 12/13 responsive & a11y
  if (want('responsive')) {
    const page = await openNtp(browser, 'resp');
    await setSettings(worker, (s) => { s.wallpaper.source = 'preset'; s.wallpaper.presetId = 'sonoma'; s.dock.position = 'bottom'; s.appearance.theme = 'dark'; s.clock.format = '12'; s.shortcuts.size = 'medium'; });
    await sleep(1500);
    for (const [w, hgt, name] of [[1440, 900, 'desktop'], [820, 1180, 'tablet'], [390, 844, 'phone'], [1024, 520, 'short']]) {
      await page.setViewport({ width: w, height: hgt });
      await sleep(500);
      const m = await page.evaluate(() => ({
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
        clockVisible: document.querySelector('.clock-time').getBoundingClientRect().width > 0,
        searchW: Math.round(document.querySelector('.search-form').getBoundingClientRect().width),
        dockOverlapsTiles: (() => {
          const d = document.getElementById('dock').getBoundingClientRect();
          return [...document.querySelectorAll('.tile')].some((t) => { const r = t.getBoundingClientRect(); return r.bottom > d.top && r.top < d.bottom && r.right > d.left && r.left < d.right && r.bottom < window.innerHeight; });
        })(),
      }));
      check(`12. Layout @${name} ${w}x${hgt}: no horizontal overflow`, !m.overflowX && m.clockVisible && m.searchW <= w, JSON.stringify(m));
      await page.screenshot({ path: path.join(OUT, `06-${name}.png`) });
    }
    await page.setViewport({ width: 1280, height: 800 });
    // settings dialog at phone width
    await page.setViewport({ width: 390, height: 844 });
    await page.click('#corner-actions .round-btn');
    await page.waitForSelector('dialog[open]');
    await sleep(300);
    const dlgFits = await page.$eval('dialog[open] .sheet', (s) => s.getBoundingClientRect().width <= window.innerWidth);
    check('12. Settings window fits a narrow screen', dlgFits);
    await page.screenshot({ path: path.join(OUT, '07-settings-phone.png') });
    await page.keyboard.press('Escape');
    await page.setViewport({ width: 1280, height: 800 });
    await sleep(300);
    // tab order & labels (fresh load without autofocus so Tab starts at the document)
    await setSettings(worker, (s) => (s.search.autofocus = false));
    await page.reload();
    await page.waitForSelector('.clock-time');
    await sleep(500);
    await page.evaluate(() => document.activeElement.blur());
    const order = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      order.push(await page.evaluate(() => document.activeElement.getAttribute('aria-label') || document.activeElement.textContent.trim().slice(0, 20) || document.activeElement.tagName));
    }
    check('13. Keyboard Tab order reaches skip link, bookmarks, search', order[0] === 'Skip to search' && order.some((o) => /Search/.test(o)), order.join(' → '));
    const unlabeled = await page.evaluate(() => [...document.querySelectorAll('button, a[href], input, select')].filter((e) => !(e.getAttribute('aria-label') || e.textContent.trim() || e.title || e.closest('label'))).map((e) => e.outerHTML.slice(0, 80)));
    check('13. All interactive elements have accessible names', unlabeled.length === 0, unlabeled.join(' | '));
    // reduced motion
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await sleep(200);
    check('13. OS reduced-motion preference disables animation', (await page.evaluate(() => document.documentElement.dataset.motion)) === 'none');
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    // light wallpaper -> dark text
    await setSettings(worker, (s) => { s.wallpaper.source = 'preset'; s.wallpaper.presetId = 'daylight'; });
    await sleep(1500);
    check('Dynamic text color: light wallpaper gets dark text', (await page.evaluate(() => document.documentElement.dataset.tone)) === 'light');
    await page.screenshot({ path: path.join(OUT, '08-light-wallpaper.png') });
    await setSettings(worker, (s) => { s.wallpaper.source = 'color'; s.wallpaper.color = '#101820'; });
    await sleep(1200);
    check('Dynamic text color: dark solid color gets light text', (await page.evaluate(() => document.documentElement.dataset.tone)) === 'dark');
    await setSettings(worker, (s) => { s.wallpaper.source = 'gradient'; s.wallpaper.gradient = { from: '#ff7e5f', to: '#feb47b', angle: 135 }; });
    await sleep(1200);
    const g = await page.evaluate(() => getComputedStyle(document.querySelector('.wall-layer.is-active')).backgroundImage);
    check('Gradient wallpaper renders', g.startsWith('linear-gradient(135deg'), g.slice(0, 60));
    await page.close();
  }

  // ---------------------------------------------------------------- 11/9 restart persistence
  if (want('restart')) {
    await setSettings(worker, (s) => { s.clock.format = '24'; s.wallpaper.source = 'preset'; s.wallpaper.presetId = 'monterey'; s.wallpaper.interval = '5m'; s.dock.position = 'right'; s.widgets.visible.bookmarks = false; });
    await sleep(1200);
    const before = await storageGet(worker);
    await browser.close();
    ({ browser, swTarget, extId } = await launch({ profile: PROFILE }));
    worker = await swTarget.worker();
    const page = await openNtp(browser, 'restart');
    const after = await storageGet(worker);
    const ui = await page.evaluate(() => ({ clock: document.querySelector('.clock-time').textContent, dock: document.getElementById('dock').dataset.pos, bm: document.getElementById('bookmarks-bar').hidden, attrib: document.getElementById('attribution').textContent }));
    check('11. Settings persist after restarting Chrome', JSON.stringify(after.settings) === JSON.stringify(before.settings) && !/AM|PM/.test(ui.clock) && ui.dock === 'right' && ui.bm === true, JSON.stringify(ui));
    check('11. Shortcuts, favorites and wallpaper state persist', JSON.stringify(after.shortcuts) === JSON.stringify(before.shortcuts) && after.favorites.length === before.favorites.length && after.wallpaperState.current.id === 'monterey');
    const alarm = await worker.evaluate(() => chrome.alarms.get('wallpaper-rotate'));
    check('9. Rotation alarm exists after restart', alarm?.periodInMinutes === 5, JSON.stringify(alarm));
    // restore defaults
    await page.click('#corner-actions .round-btn');
    await page.waitForSelector('dialog[open]');
    await page.click('#tab-about');
    await page.evaluate(() => [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Restore default settings').click());
    await page.waitForSelector('dialog.form-dialog[open]');
    await page.evaluate(() => [...document.querySelectorAll('dialog.form-dialog[open] button')].find((b) => b.textContent === 'Restore').click());
    await sleep(1200);
    const reset = await storageGet(worker);
    check('Restore defaults resets settings but keeps shortcuts', reset.settings.clock.format === '12' && reset.settings.dock.position === 'bottom' && reset.shortcuts.length === 10, '');
    await page.close();
  }

  // ---------------------------------------------------------------- final
  const relevant = errors.filter((e) => !/net::ERR_ABORTED|ERR_INTERNET_DISCONNECTED|offline-page|ERR_FAILED.*images\.unsplash|Failed to load resource: the server responded with a status of 401/.test(e));
  check('15. No unexpected console errors', relevant.length === 0, relevant.join('\n'));
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ results, errors }, null, 2));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (errors.length) console.log('All logged errors:\n' + errors.join('\n'));
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('HARNESS ERROR', e);
  process.exit(2);
});

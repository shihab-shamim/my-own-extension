// End-to-end tests for the top-right Google bar (Gmail, Images, apps, avatar).
const fs = require('fs');
const { launch, watch, sleep, OUT, path, workerHandle } = require('./common');

const results = [];
const errors = [];
function check(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: String(detail).slice(0, 300) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 220) : ''}`);
}
const PROFILE = 'p-gbar';
const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

(async () => {
  fs.rmSync(path.join(__dirname, PROFILE), { recursive: true, force: true });
  let { browser, extId } = await launch({ profile: PROFILE });
  let worker = workerHandle(browser, extId);
  worker.on('console', (m) => ['error', 'warning'].includes(m.type()) && errors.push('[sw] ' + m.text()));
  let page = await browser.newPage();
  watch(page, 'gbar', errors);
  await page.setViewport({ width: 1227, height: 700 });
  await page.goto('chrome://newtab');
  await page.waitForSelector('#gbar .gavatar');
  await sleep(800);

  const links = await page.$$eval('#gbar .gbar-link', (as) => as.map((a) => [a.textContent, a.getAttribute('href')]));
  check('Google bar: Gmail and Images links like Chrome’s New Tab', JSON.stringify(links) === JSON.stringify([['Gmail', 'https://mail.google.com/mail/u/0/'], ['Images', 'https://www.google.com/imghp']]), JSON.stringify(links));
  const geo = await page.evaluate(() => {
    const g = document.getElementById('gbar').getBoundingClientRect();
    const b = document.getElementById('bookmarks-bar').getBoundingClientRect();
    return { g: { left: g.left, right: g.right, top: g.top, bottom: g.bottom }, b: { left: b.left, right: b.right, top: b.top, bottom: b.bottom }, vw: innerWidth };
  });
  check('Google bar: sits top-right', geo.vw - geo.g.right < 20 && geo.g.top < 20, JSON.stringify(geo.g));
  check('Google bar: bookmarks bar makes room (no overlap)', !overlap(geo.g, geo.b), JSON.stringify(geo));

  // apps panel by keyboard
  await page.focus('#gbar .gbar-btn');
  await page.keyboard.press('Enter');
  await sleep(300);
  const apps = await page.$$eval('.gapps-panel .gapp', (as) => as.map((a) => a.querySelector('.gapp-label').textContent));
  check('Apps: launcher opens with Google apps', apps.length === 21 && apps.includes('Drive') && apps.includes('Calendar') && apps.includes('YouTube'), apps.join(','));
  check('Apps: keyboard opening focuses the first app', (await page.evaluate(() => document.activeElement.title)) === 'Account');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  check('Apps: arrow keys move through the grid', (await page.evaluate(() => document.activeElement.title)) === 'Play');
  await page.keyboard.press('Escape');
  await sleep(200);
  check('Apps: Escape closes and returns focus', !(await page.$('.gapps-panel')) && (await page.evaluate(() => document.activeElement.classList.contains('gbar-btn'))));
  await page.click('#gbar .gbar-btn');
  await sleep(200);
  const inView = await page.$eval('.gapps-panel', (p) => { const r = p.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0; });
  check('Apps: panel fits on screen', inView);
  await page.screenshot({ path: path.join(OUT, 'gbar-apps.png') });
  await page.mouse.click(400, 400);
  await sleep(200);
  check('Apps: clicking outside closes it', !(await page.$('.gapps-panel')));
  // clicking an app navigates normally
  await page.click('#gbar .gbar-btn');
  await sleep(200);
  const driveHref = await page.$eval('.gapps-panel .gapp[title="Drive"]', (a) => a.getAttribute('href'));
  check('Apps: app tiles are real links', driveHref === 'https://drive.google.com/', driveHref);
  await page.keyboard.press('Escape');

  // avatar menu
  await page.click('#gbar .gavatar');
  await sleep(250);
  const menu = await page.$$eval('.gacct-panel a', (m) => m.map((x) => [x.textContent, x.getAttribute('href')]));
  check('Avatar: card offers Manage account and Switch account', menu.some(([t, hr]) => t === 'Manage your Google Account' && hr === 'https://myaccount.google.com/') && menu.some(([t]) => t === 'Switch account'), JSON.stringify(menu));
  await page.keyboard.press('Escape');

  // account number
  await page.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    settings.google.authuser = 2;
    await chrome.storage.local.set({ settings });
  });
  await sleep(500);
  const gm2 = await page.$eval('#gbar .gbar-link', (a) => a.getAttribute('href'));
  await page.click('#gbar .gbar-btn');
  await sleep(200);
  const drive2 = await page.$eval('.gapps-panel .gapp[title="Drive"]', (a) => a.getAttribute('href'));
  await page.keyboard.press('Escape');
  check('Account setting: links open the chosen Google account', gm2 === 'https://mail.google.com/mail/u/2/' && drive2 === 'https://drive.google.com/?authuser=2', `${gm2} ${drive2}`);

  // settings UI: account select + photo upload
  await page.click('#corner-actions .round-btn[aria-label="Customize New Tab"]');
  await page.waitForSelector('dialog.settings-dialog[open]');
  await page.click('#tab-widgets');
  await sleep(300);
  await page.select('[data-k="g-user"]', '0');
  await sleep(400);
  check('Settings: account picker updates the links', (await page.$eval('#gbar .gbar-link', (a) => a.getAttribute('href'))) === 'https://mail.google.com/mail/u/0/');
  // make a photo
  const p2 = await browser.newPage();
  await p2.setViewport({ width: 600, height: 400 });
  await p2.setContent('<body style="margin:0;height:100vh;background:radial-gradient(circle at 50% 40%,#f4c27a 0 18%,#3b6ea8 19% 100%)"></body>');
  await p2.screenshot({ path: path.join(OUT, 'avatar-src.jpg'), type: 'jpeg' });
  await p2.close();
  await page.bringToFront();
  const input = await page.$('dialog.settings-dialog[open] input[type=file][accept^="image/jpeg"]');
  await input.uploadFile(path.join(OUT, 'avatar-src.jpg'));
  await sleep(1200);
  const photo = await page.evaluate(async () => (await chrome.storage.local.get('settings')).settings.google.photo);
  check('Photo: upload is cropped/shrunk to a small WebP and saved', /^data:image\/webp;base64,/.test(photo) && photo.length < 30000, `${photo.slice(0, 30)}… ${photo.length} chars`);
  const avatarSrc = await page.$eval('#gbar .gavatar img', (i) => i.naturalWidth).catch(() => 0);
  check('Photo: shows in the avatar', avatarSrc === 128, avatarSrc);
  // invalid photo
  fs.writeFileSync(path.join(OUT, 'not-image.png'), 'nope');
  await (await page.$('dialog.settings-dialog[open] input[type=file][accept^="image/jpeg"]')).uploadFile(path.join(OUT, 'not-image.png'));
  await sleep(800);
  check('Photo: invalid file is rejected with a message', (await page.$$eval('.toast', (t) => t.map((x) => x.textContent))).some((t) => /couldn’t be read|Choose a JPG/.test(t)));
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, 'gbar-1227.png') });

  // tampered photo value (e.g. from an edited backup) is ignored
  await page.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    settings.google.photo = 'javascript:alert(1)';
    await chrome.storage.local.set({ settings });
  });
  await sleep(400);
  check('Photo: an unsafe stored value is never used as an image', !(await page.$('#gbar .gavatar img')) && !!(await page.$('#gbar .gavatar-default')));

  // palette finds Google apps
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
  await sleep(250);
  await page.keyboard.type('drive');
  await sleep(300);
  const first = await page.$eval('.pal-item[aria-selected="true"]', (e) => e.querySelector('.pal-title').textContent + '/' + e.querySelector('.pal-kind').textContent);
  check('Palette: finds Google apps ("drive" → Google Drive)', first === 'Google Drive/Google', first);
  await page.keyboard.press('Escape');

  // to-do card never overlaps the Google bar, even with the bookmarks bar hidden
  await page.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    settings.widgets.visible.bookmarks = false;
    await chrome.storage.local.set({ settings });
  });
  await sleep(600);
  const ov = await page.evaluate(() => {
    const a = document.getElementById('gbar').getBoundingClientRect();
    const b = document.getElementById('w-todo').getBoundingClientRect();
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  });
  check('Layout: to-do card stays below the Google bar', !ov);

  // narrow window
  await page.setViewport({ width: 390, height: 844 });
  await sleep(500);
  const narrow = await page.evaluate(() => ({
    linksHidden: [...document.querySelectorAll('#gbar .gbar-link')].every((a) => getComputedStyle(a).display === 'none'),
    overflowX: document.documentElement.scrollWidth > innerWidth,
    avatarVisible: document.querySelector('#gbar .gavatar').getBoundingClientRect().right <= innerWidth,
  }));
  check('Layout: on narrow windows only apps + avatar show, no overflow', narrow.linksHidden && !narrow.overflowX && narrow.avatarVisible, JSON.stringify(narrow));
  await page.setViewport({ width: 1227, height: 700 });

  // hide
  await page.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    settings.widgets.visible.bookmarks = true;
    settings.widgets.visible.gbar = false;
    await chrome.storage.local.set({ settings });
  });
  await sleep(600);
  const hidden = await page.evaluate(() => ({ g: document.getElementById('gbar').hidden, bRight: Math.round(innerWidth - document.getElementById('bookmarks-bar').getBoundingClientRect().right) }));
  check('Settings: Google bar can be hidden and the bookmarks bar takes the space back', hidden.g && hidden.bRight <= 20, JSON.stringify(hidden));

  const manifest = await page.evaluate(() => chrome.runtime.getManifest());
  check('Permissions: only the expected list (no install warnings added)', JSON.stringify(manifest.permissions) === JSON.stringify(['storage', 'bookmarks', 'alarms', 'favicon', 'search', 'declarativeNetRequestWithHostAccess']) && !manifest.host_permissions, JSON.stringify(manifest.permissions));
  const relevant = errors.filter((e) => !/net::ERR_ABORTED|ERR_NAME_NOT_RESOLVED/.test(e));
  check('No console errors', relevant.length === 0, relevant.join('\n'));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('HARNESS ERROR', e);
  process.exit(2);
});

// End-to-end tests for "Connect Google account" (real photo, name, email).
//
// Part A uses the real extension: the permission is optional and not granted.
// Part B uses a copy whose manifest pre-grants accounts.google.com, so the
// connected flow can run without Chrome's permission prompt (which automation
// can't click). Google's responses are mocked; a real signed-in session is
// verified manually in your own Chrome.
const fs = require('fs');
const { launch, watch, sleep, OUT, EXT, path, workerHandle } = require('./common');

const results = [];
const errors = [];
function check(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: String(detail).slice(0, 300) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 220) : ''}`);
}

const ACCOUNTS = JSON.stringify(['gaia.l.a.r', [
  ['gaia.l.a', 1, 'Shihab Shamim', 'shihab@example.com', 'https://lh3.googleusercontent.com/a/ACg8ocAAA=s48-c', 1, 1, 0, null, 1, '1111', null, null, null, null, 1],
  ['gaia.l.a', 1, 'Second Person', 'second.person@gmail.com', 'https://lh3.googleusercontent.com/a/ACg8ocBBB=s48-c', 1, 1, 0, null, 1, '2222', null, null, null, null, 1],
]]);
const EVIL = JSON.stringify(['gaia.l.a.r', [
  ['gaia.l.a', 1, '<img src=x onerror="window.__pwned=1">', 'evil@example.com', 'https://evil.example/tracker.jpg', 1, 1, 0, null, 1, '3333'],
]]);
let mode = 'accounts';
let accountRequests = 0;
let JPEG;

async function mock(page) {
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (u.startsWith('https://accounts.google.com/ListAccounts')) {
      accountRequests += 1;
      if (mode === 'error') return req.respond({ status: 500, body: 'oops' });
      const body = mode === 'signedout' ? '["gaia.l.a.r",[]]' : mode === 'evil' ? EVIL : ACCOUNTS;
      return req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body });
    }
    if (u.startsWith('https://lh3.googleusercontent.com/')) return req.respond({ status: 200, contentType: 'image/jpeg', body: JPEG });
    if (u.startsWith('https://evil.example/')) {
      errors.push('evil photo was requested: ' + u);
      return req.respond({ status: 404, body: '' });
    }
    req.continue();
  });
}

async function openNtp(browser, label) {
  const page = await browser.newPage();
  watch(page, label, errors);
  await mock(page);
  await page.setViewport({ width: 1227, height: 700 });
  await page.goto('chrome://newtab');
  await page.waitForSelector('#gbar .gavatar');
  await sleep(800);
  return page;
}
const avatarSrc = (page) => page.$eval('#gbar .gavatar img', (i) => i.src).catch(() => '');

(async () => {
  // a test image for profile photos
  {
    const { browser } = await launch({ profile: 'p-gacct-img' });
    const p = await browser.newPage();
    await p.setContent('<body style="margin:0;height:100vh;background:radial-gradient(circle at 50% 38%,#f1c27d 0 22%,#2f5d8a 23%)"></body>');
    JPEG = await p.screenshot({ type: 'jpeg' });
    await browser.close();
  }

  // ---------------------------------------------------------------- Part A
  fs.rmSync(path.join(__dirname, 'p-gacct-a'), { recursive: true, force: true });
  let { browser } = await launch({ profile: 'p-gacct-a' });
  let page = await openNtp(browser, 'a');
  const manifest = await page.evaluate(() => chrome.runtime.getManifest());
  check('Permission is optional, not requested at install', JSON.stringify(manifest.optional_host_permissions) === '["https://accounts.google.com/*"]' && !manifest.host_permissions && !manifest.permissions.includes('identity'), JSON.stringify({ p: manifest.permissions, o: manifest.optional_host_permissions }));
  check('Not granted by default', !(await page.evaluate(() => chrome.permissions.contains({ origins: ['https://accounts.google.com/*'] }))));
  check('Nothing is fetched from Google until you connect', accountRequests === 0, accountRequests);
  await page.click('#gbar .gavatar');
  await sleep(300);
  const cardA = await page.$eval('.gacct-panel', (p) => ({ text: p.textContent, connect: !!p.querySelector('.gacct-primary') }));
  check('Card offers "Connect Google account" with a clear explanation', cardA.connect && /Chrome will ask once/.test(cardA.text) && /Nothing leaves this computer/.test(cardA.text), cardA.text.slice(0, 160));
  await page.keyboard.press('Escape');
  await page.click('#corner-actions .round-btn[aria-label="Customize New Tab"]');
  await page.waitForSelector('dialog.settings-dialog[open]');
  await page.click('#tab-widgets');
  await sleep(300);
  check('Settings shows "Not connected"', (await page.$eval('[data-k="g-acct-status"]', (e) => e.textContent)) === 'Not connected');
  await browser.close();
  await sleep(1500);

  // ---------------------------------------------------------------- Part B
  const granted = path.join(__dirname, 'out', 'ext-granted');
  fs.rmSync(granted, { recursive: true, force: true });
  fs.cpSync(EXT, granted, { recursive: true, filter: (src) => !/[\\/](tests|dist|node_modules)([\\/]|$)/.test(src.slice(EXT.length)) });
  const m = JSON.parse(fs.readFileSync(path.join(granted, 'manifest.json'), 'utf8'));
  m.host_permissions = ['https://accounts.google.com/*'];
  fs.writeFileSync(path.join(granted, 'manifest.json'), JSON.stringify(m, null, 2));

  fs.rmSync(path.join(__dirname, 'p-gacct-b'), { recursive: true, force: true });
  let extId;
  ({ browser, extId } = await launch({ profile: 'p-gacct-b', ext: granted }));
  const worker = workerHandle(browser, extId);
  worker.on('console', (msg) => ['error', 'warning'].includes(msg.type()) && errors.push('[sw] ' + msg.text()));
  accountRequests = 0;
  page = await openNtp(browser, 'b');
  check('Even with access available, nothing is fetched before you connect', accountRequests === 0, accountRequests);

  // connect from the card
  await page.click('#gbar .gavatar');
  await sleep(250);
  await page.click('.gacct-panel .gacct-primary');
  await page.waitForFunction(() => /Shihab Shamim/.test(document.querySelector('.gacct-panel .gacct-title')?.textContent || ''), { timeout: 8000 }).catch(() => {});
  const card = await page.evaluate(() => {
    const p = document.querySelector('.gacct-panel');
    return {
      email: p?.querySelector('.gacct-email')?.textContent,
      hi: p?.querySelector('.gacct-title')?.textContent,
      big: p?.querySelector('.gacct-big img')?.src,
      others: [...(p?.querySelectorAll('.gacct-row') || [])].map((r) => r.textContent),
      manage: p?.querySelector('a.gacct-manage')?.getAttribute('href'),
    };
  });
  check('Connect: shows your real name and email (like Chrome’s card)', card.email === 'shihab@example.com' && card.hi === 'Shihab Shamim', JSON.stringify(card));
  check('Connect: "Manage your Google Account" pill links to your account', card.manage === 'https://myaccount.google.com/', card.manage);
  check('Connect: shows your real Google photo (sized for the card)', /^https:\/\/lh3\.googleusercontent\.com\/a\/ACg8ocAAA=s72-c$/.test(card.big || ''), card.big);
  check('Connect: lists your other account, "Add another account" and "Sign out of all accounts"', card.others.some((t) => t.includes('Second Person') && t.includes('second.person@gmail.com')) && card.others.some((t) => t.includes('Add another account')) && card.others.some((t) => t.includes('Sign out of all accounts')), card.others.join(' | '));
  await page.click('.gacct-panel .gacct-toggle');
  await sleep(150);
  const collapsed = await page.$eval('#gacct-list', (l) => l.hidden);
  await page.click('.gacct-panel .gacct-toggle');
  await sleep(150);
  check('Connect: the ⌃ button collapses and expands the account list', collapsed && !(await page.$eval('#gacct-list', (l) => l.hidden)));
  check('Connect: exactly one request to Google', accountRequests === 1, accountRequests);
  check('Bar avatar shows your real photo', /ACg8ocAAA=s38-c$/.test(await avatarSrc(page)), await avatarSrc(page));
  check('Bar avatar has your name and email as its label', (await page.$eval('#gbar .gavatar', (b) => b.getAttribute('aria-label'))) === 'Google Account: Shihab Shamim (shihab@example.com)');
  await page.screenshot({ path: path.join(OUT, 'gacct-card.png') });

  // switch account
  await page.evaluate(() => [...document.querySelectorAll('.gacct-panel .gacct-row')].find((r) => r.textContent.includes('Second Person')).click());
  await sleep(700);
  const after = await page.evaluate(async () => ({ gmail: document.querySelector('#gbar .gbar-link').getAttribute('href'), authuser: (await chrome.storage.local.get('settings')).settings.google.authuser }));
  check('Choosing another account switches Gmail and apps to it', after.authuser === 1 && after.gmail === 'https://mail.google.com/mail/u/1/', JSON.stringify(after));
  check('…and the avatar switches to that account’s photo', /ACg8ocBBB=s38-c$/.test(await avatarSrc(page)), await avatarSrc(page));

  // cache: reloads and other tabs don't hit Google again
  accountRequests = 0;
  await page.reload();
  await page.waitForSelector('#gbar .gavatar img');
  const p2 = await openNtp(browser, 'b2');
  const p3 = await openNtp(browser, 'b3');
  await sleep(500);
  check('Reloads and new tabs reuse the cached info (no extra requests)', accountRequests === 0, accountRequests);
  check('New tabs show the photo immediately from cache', /ACg8ocBBB=s38-c$/.test(await avatarSrc(p3)), await avatarSrc(p3));
  await p2.close();
  await p3.close();
  await page.bringToFront();

  // settings status
  await page.click('#corner-actions .round-btn[aria-label="Customize New Tab"]');
  await page.waitForSelector('dialog.settings-dialog[open]');
  await page.click('#tab-widgets');
  await sleep(300);
  check('Settings shows the connected account', (await page.$eval('[data-k="g-acct-status"]', (e) => e.textContent)) === 'Connected · second.person@gmail.com');
  await page.keyboard.press('Escape');
  await sleep(300);

  // error: keep last known info
  mode = 'error';
  await page.click('#gbar .gavatar');
  await sleep(1200);
  const errCard = await page.$eval('.gacct-panel', (p) => p.textContent);
  check('If Google can’t be reached, the last known account stays with a short note', /second\.person@gmail\.com/.test(errCard) && /Couldn’t load your Google account right now/.test(errCard), errCard.slice(0, 200));
  await page.keyboard.press('Escape');

  // signed out of Google
  mode = 'signedout';
  await page.click('#gbar .gavatar');
  await sleep(1200);
  const outCard = await page.$eval('.gacct-panel', (p) => ({ text: p.textContent, signIn: [...p.querySelectorAll('a')].find((a) => a.textContent === 'Sign in')?.getAttribute('href') }));
  check('Signed out of Google: says so and offers Sign in', /not signed in to Google/.test(outCard.text) && outCard.signIn === 'https://accounts.google.com/ServiceLogin', JSON.stringify(outCard).slice(0, 200));
  await page.keyboard.press('Escape');

  // hostile data is shown as text and never loads foreign images
  mode = 'evil';
  await page.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    settings.google.authuser = 0;
    await chrome.storage.local.set({ settings });
  });
  await sleep(400);
  await page.click('#gbar .gavatar');
  await sleep(1200);
  const evil = await page.evaluate(() => ({ pwned: !!window.__pwned, imgs: [...document.querySelectorAll('.gacct-panel img, #gbar img')].map((i) => i.src), hi: document.querySelector('.gacct-title')?.textContent }));
  check('Untrusted names are shown as plain text; non-Google photo URLs are never loaded', !evil.pwned && evil.imgs.every((s) => !s.includes('evil.example')) && /^<img/.test(evil.hi || ''), JSON.stringify(evil));
  await page.keyboard.press('Escape');
  mode = 'accounts';

  // backups never contain account info
  const backup = await page.evaluate(async () => {
    const mod = await import(chrome.runtime.getURL('src/newtab/backup.js'));
    return JSON.stringify(mod.buildBackup());
  });
  // (Your shortcut URLs legitimately contain "bplugins.com"; look for the account emails.)
  check('Backups never include your Google account info', !/shihab@example.com|second\.person@gmail\.com|evil@example\.com|googleAccounts/.test(backup));

  // disconnect
  await page.click('#gbar .gavatar');
  await sleep(1200);
  await page.evaluate(() => [...document.querySelectorAll('.gacct-panel button')].find((b) => b.textContent === 'Disconnect from Sequoia Tab').click());
  await sleep(800);
  const disc = await page.evaluate(async () => ({ cache: (await chrome.storage.local.get('googleAccounts')).googleAccounts, img: !!document.querySelector('#gbar .gavatar img') }));
  check('Disconnect removes the stored account info and the photo', disc.cache.enabled === false && disc.cache.accounts.length === 0 && !disc.img, JSON.stringify(disc));
  accountRequests = 0;
  await page.reload();
  await page.waitForSelector('#gbar .gavatar');
  await sleep(800);
  check('After disconnecting, nothing is fetched again', accountRequests === 0, accountRequests);

  await browser.close();
  await sleep(1500);

  // ---------------------------------------------------------------- Part C: the REAL Google endpoint
  // No mock: proves Google accepts the request (it answered 403 before the
  // Origin fix). The test browser isn't signed in, so "not signed in" is right.
  fs.rmSync(path.join(__dirname, 'p-gacct-c'), { recursive: true, force: true });
  ({ browser, extId } = await launch({ profile: 'p-gacct-c', ext: granted }));
  page = await browser.newPage();
  watch(page, 'c', errors);
  await page.setViewport({ width: 1227, height: 700 });
  const realStatus = [];
  page.on('response', (r) => r.url().startsWith('https://accounts.google.com/ListAccounts') && realStatus.push(r.status()));
  await page.goto('chrome://newtab');
  await page.waitForSelector('#gbar .gavatar');
  await sleep(800);
  await page.click('#gbar .gavatar');
  await sleep(250);
  await page.click('.gacct-panel .gacct-primary');
  // Wait for Google's real answer (success or error), not just the first render.
  await page.waitForFunction(async () => { const c = (await chrome.storage.local.get('googleAccounts')).googleAccounts; return c && (c.at > 0 || c.error); }, { timeout: 20000 }).catch(() => {});
  await sleep(500);
  const real = await page.evaluate(async () => ({ text: document.querySelector('.gacct-panel')?.textContent || '', cache: (await chrome.storage.local.get('googleAccounts')).googleAccounts }));
  check('Real Google: request is accepted (HTTP 200, no 403)', realStatus.length > 0 && realStatus.every((s) => s === 200), realStatus.join(','));
  check('Real Google: response parsed without error (signed-out test browser → "not signed in")', /not signed in to Google/.test(real.text) && !real.cache.error && real.cache.at > 0, JSON.stringify(real.cache));
  const rules = await page.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
  check('Header rule matches Chrome’s own request and is narrowly scoped (this URL, POST, this extension only)', rules.length === 1 && rules[0].condition.urlFilter === '|https://accounts.google.com/ListAccounts' && JSON.stringify(rules[0].condition.initiatorDomains) === JSON.stringify([extId]) && JSON.stringify(rules[0].action.requestHeaders) === '[{"header":"origin","operation":"set","value":"https://www.google.com"}]', JSON.stringify(rules));

  await browser.close();
  await sleep(1500);

  // ---------------------------------------------------------------- Part D: your exact situation
  // Installed before the header permission existed, files then updated on disk
  // without a reload. The card must offer "Finish update", which reloads the
  // extension, applies the permission and reopens a New Tab.
  const noRule = path.join(__dirname, 'out', 'ext-norule');
  fs.rmSync(noRule, { recursive: true, force: true });
  fs.cpSync(granted, noRule, { recursive: true });
  const mPath = path.join(noRule, 'manifest.json');
  const fullManifest = fs.readFileSync(mPath, 'utf8');
  const m2 = JSON.parse(fullManifest);
  m2.permissions = m2.permissions.filter((p) => p !== 'declarativeNetRequestWithHostAccess');
  m2.version = '1.3.0';
  fs.writeFileSync(mPath, JSON.stringify(m2, null, 2));
  fs.rmSync(path.join(__dirname, 'p-gacct-d'), { recursive: true, force: true });
  ({ browser, extId } = await launch({ profile: 'p-gacct-d', ext: noRule }));
  page = await browser.newPage();
  watch(page, 'd', errors);
  accountRequests = 0;
  await mock(page);
  await page.setViewport({ width: 1227, height: 700 });
  await page.goto('chrome://newtab');
  await page.waitForSelector('#gbar .gavatar');
  await sleep(800);
  fs.writeFileSync(mPath, fullManifest); // the update lands on disk, like your folder
  await page.click('#gbar .gavatar');
  await sleep(250);
  await page.click('.gacct-panel .gacct-primary'); // Connect
  await sleep(1500);
  const d = await page.$eval('.gacct-panel', (p) => ({ text: p.textContent, btn: p.querySelector('.gacct-primary')?.textContent }));
  check('Not reloaded yet: card offers a one-click "Finish update"', /One more click to finish/.test(d.text) && d.btn === 'Finish update', d.text.slice(0, 200));
  check('Not reloaded yet: no doomed request is sent to Google', accountRequests === 0, accountRequests);
  const newTab = new Promise((resolve) => browser.on('targetcreated', (t) => t.type() === 'page' && resolve(t)));
  await page.click('.gacct-panel .gacct-primary').catch(() => {}); // Finish update -> extension reloads
  const target = await Promise.race([newTab, sleep(10000).then(() => null)]);
  check('Finish update: the extension restarts and reopens a New Tab', !!target);
  const reopened = target ? await target.page() : null;
  if (reopened) {
    watch(reopened, 'd2', errors);
    await reopened.waitForSelector('#gbar .gavatar', { timeout: 10000 }).catch(() => {});
    await reopened.waitForFunction(async () => { const c = (await chrome.storage.local.get('googleAccounts')).googleAccounts; return c && (c.at > 0 || c.error); }, { timeout: 20000 }).catch(() => {});
    const st = await reopened.evaluate(async () => ({
      perm: await chrome.permissions.contains({ permissions: ['declarativeNetRequestWithHostAccess'] }),
      version: chrome.runtime.getManifest().version,
      cache: (await chrome.storage.local.get('googleAccounts')).googleAccounts,
    }));
    check('Finish update: the permission is now active and the update applied', st.perm === true && st.version !== '1.3.0', JSON.stringify({ perm: st.perm, version: st.version }));
    check('Finish update: the account then loads from the real Google server (no error)', st.cache.at > 0 && !st.cache.error && !st.cache.needsReload, JSON.stringify(st.cache));
  }

  const relevant = errors.filter((e) => !/net::ERR_ABORTED|ERR_NAME_NOT_RESOLVED|status of 500/.test(e));
  check('No console errors', relevant.length === 0, relevant.join('\n'));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('HARNESS ERROR', e);
  process.exit(2);
});

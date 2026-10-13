// End-to-end tests for the to-do list in Chrome's side panel.
const fs = require('fs');
const { launch, watch, sleep, OUT, EXT, path, workerHandle } = require('./common');

const results = [];
const errors = [];
function check(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: String(detail).slice(0, 300) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 220) : ''}`);
}
const texts = (page) => page.$$eval('.todo-text', (e) => e.map((x) => x.textContent));

(async () => {
  fs.rmSync(path.join(__dirname, 'p-sidepanel'), { recursive: true, force: true });
  let { browser, extId } = await launch({ profile: 'p-sidepanel' });
  const worker = workerHandle(browser, extId);
  worker.on('console', (m) => ['error', 'warning'].includes(m.type()) && errors.push('[sw] ' + m.text()));

  // ---- setup
  const ntp = await browser.newPage();
  watch(ntp, 'ntp', errors);
  await ntp.setViewport({ width: 1227, height: 700 });
  await ntp.goto('chrome://newtab');
  await ntp.waitForSelector('#w-todo .todo-head');
  await sleep(600);
  const manifest = await ntp.evaluate(() => chrome.runtime.getManifest());
  check('Manifest: side panel page and permission (no install warning)', manifest.side_panel?.default_path === 'sidepanel.html' && manifest.permissions.includes('sidePanel') && !manifest.host_permissions && !(manifest.content_scripts || []).length, JSON.stringify({ sp: manifest.side_panel, perms: manifest.permissions }));
  check('Shortcut: Ctrl+Shift+Y opens/closes it (changeable in chrome://extensions/shortcuts)', manifest.commands?._execute_action?.suggested_key?.default === 'Ctrl+Shift+Y');
  const behavior = await worker.evaluate(() => chrome.sidePanel.getPanelBehavior());
  const options = await worker.evaluate(() => chrome.sidePanel.getOptions({}));
  check('Toolbar button / shortcut is handled by the extension (so it can toggle)', behavior.openPanelOnActionClick === false, JSON.stringify(behavior));
  check('Side panel is enabled for every site', options.enabled === true && options.path === 'sidepanel.html', JSON.stringify(options));

  // ---- the panel page
  const panel = await browser.newPage();
  watch(panel, 'panel', errors);
  await panel.setViewport({ width: 360, height: 720 });
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  await panel.waitForSelector('#w-todo .todo-input');
  await sleep(500);
  const ui = await panel.evaluate(() => ({
    focused: document.activeElement?.classList.contains('todo-input'),
    grip: !!document.querySelector('.todo-grip'),
    sizer: !!document.querySelector('.todo-resize'),
    collapse: !!document.querySelector('.todo-head [aria-controls="todo-body"]'),
    title: document.querySelector('.todo-title')?.textContent,
    overflowX: document.documentElement.scrollWidth > innerWidth,
  }));
  check('Panel shows the to-do list, ready to type', ui.focused && ui.title === 'Today' && !ui.overflowX, JSON.stringify(ui));
  check('Panel has no move/resize/collapse controls (Chrome sizes the panel)', !ui.grip && !ui.sizer && !ui.collapse, JSON.stringify(ui));

  // ---- live sync both ways
  await panel.bringToFront();
  await panel.type('.todo-input', 'Added in the side panel');
  await panel.keyboard.press('Enter');
  await sleep(600);
  check('Task added in the panel appears on the New Tab instantly', (await texts(ntp)).includes('Added in the side panel'), (await texts(ntp)).join('|'));
  await ntp.bringToFront();
  await ntp.type('.todo-input', 'Added on the New Tab');
  await ntp.keyboard.press('Enter');
  await sleep(600);
  check('Task added on the New Tab appears in the panel instantly', (await texts(panel)).includes('Added on the New Tab'), (await texts(panel)).join('|'));
  await panel.bringToFront();
  await panel.click('.todo-item:nth-child(1) .todo-check');
  await sleep(600);
  check('Ticking a task in the panel ticks it on the New Tab', await ntp.$eval('.todo-item:nth-child(1)', (li) => li.classList.contains('done')));
  await panel.click('.todo-item:nth-child(2) .todo-act[aria-label^="Delete"]');
  await sleep(600);
  check('Deleting in the panel removes it everywhere', !(await texts(ntp)).includes('Added on the New Tab'), (await texts(ntp)).join('|'));

  // long list scrolls inside the panel
  for (let i = 0; i < 25; i++) {
    await panel.type('.todo-input', `Task ${i + 1}`);
    await panel.keyboard.press('Enter');
  }
  await sleep(500);
  const scroll = await panel.evaluate(() => {
    const l = document.querySelector('.todo-list');
    return { listScrolls: l.scrollHeight > l.clientHeight, pageScrolls: document.documentElement.scrollHeight > innerHeight + 1, inputVisible: document.querySelector('.todo-input').getBoundingClientRect().top >= 0 };
  });
  check('Long lists scroll inside the panel; the input stays visible', scroll.listScrolls && !scroll.pageScrolls && scroll.inputVisible, JSON.stringify(scroll));

  // menu
  await panel.click('.todo-head .icon-btn[aria-label="To-do options"]');
  await sleep(200);
  const pItems = await panel.$$eval('.menu .menu-item', (m) => m.map((x) => x.textContent));
  await panel.keyboard.press('Escape');
  check('Panel menu offers "Close side panel" (with the shortcut) and "Change keyboard shortcut…"', pItems.some((t) => t.startsWith('Close side panel')) && pItems.includes('Change keyboard shortcut…') && !pItems.includes('Hide to-do list'), pItems.join('|'));

  // theme follows settings
  await panel.evaluate(async () => { const { settings } = await chrome.storage.local.get('settings'); settings.appearance.theme = 'light'; await chrome.storage.local.set({ settings }); });
  await sleep(400);
  const light = await panel.evaluate(() => document.documentElement.dataset.theme);
  await panel.evaluate(async () => { const { settings } = await chrome.storage.local.get('settings'); settings.appearance.theme = 'dark'; await chrome.storage.local.set({ settings }); });
  await sleep(400);
  const dark = await panel.evaluate(() => document.documentElement.dataset.theme);
  check('Panel follows the light/dark theme setting live', light === 'light' && dark === 'dark', `${light} ${dark}`);
  await panel.screenshot({ path: path.join(OUT, 'sidepanel-dark.png') });

  // ---- New Tab: button + menu, and actually opening Chrome's side panel
  await ntp.bringToFront();
  const sideBtn = await ntp.$('.todo-head .todo-side');
  check('New Tab to-do card has an "Open in side panel" button', !!sideBtn);
  await ntp.click('.todo-head .icon-btn[aria-label="To-do options"]');
  await sleep(200);
  const nItems = await ntp.$$eval('.menu .menu-item', (m) => m.map((x) => x.textContent));
  await ntp.keyboard.press('Escape');
  check('New Tab to-do menu has "Open in side panel"', nItems.includes('Open in side panel'), nItems.join('|'));
  await panel.close();
  // Puppeteer doesn't announce side panel targets, so ask Chrome directly.
  const cdp = await browser.target().createCDPSession();
  const panelOpen = async () => (await cdp.send('Target.getTargets')).targetInfos.some((t) => t.type === 'page' && t.url.endsWith('/sidepanel.html'));
  check('(setup) no side panel open before the click', !(await panelOpen()));
  await ntp.click('.todo-head .todo-side');
  let isOpen = false;
  for (let i = 0; i < 20 && !isOpen; i++) {
    await sleep(250);
    isOpen = await panelOpen();
  }
  check('Clicking it opens Chrome’s side panel with the to-do list', isOpen);

  // ---- toggle: the same action (toolbar button / Ctrl+Shift+Y) opens AND closes.
  // Chrome only allows *opening* during a real user action (click/shortcut),
  // which automation can't produce, so "open" is verified by the attempt.
  const winId = await ntp.evaluate(async () => (await chrome.windows.getCurrent()).id);
  const realPanelOpen = async (exclude = []) => (await cdp.send('Target.getTargets')).targetInfos.some((t) => t.type === 'page' && t.url.endsWith('/sidepanel.html') && !exclude.includes(t.targetId));
  const waitFor = async (want, exclude) => {
    for (let i = 0; i < 24; i++) {
      if ((await realPanelOpen(exclude)) === want) return true;
      await sleep(250);
    }
    return false;
  };
  await sleep(800); // let the panel register with the service worker
  await worker.evaluate((id) => self.__sequoiaTogglePanel({ windowId: id }), winId);
  check('Toggle: pressing it while the panel is open closes it', await waitFor(false));
  const swLog = [];
  (await worker.current()).on('console', (m) => swLog.push(m.text()));
  await worker.evaluate((id) => self.__sequoiaTogglePanel({ windowId: id }), winId);
  await sleep(800);
  check('Toggle: pressing it while closed asks Chrome to open it (Chrome requires your real click/shortcut, which automation can’t send)', swLog.some((t) => /could not open the side panel: .*user gesture/.test(t)), swLog.join(' | '));
  // reopen with a real click (the New Tab button) and close again with the toggle
  await ntp.bringToFront();
  await ntp.click('.todo-head .todo-side');
  check('Toggle: reopened by a real click', await waitFor(true));
  await sleep(800);
  await worker.evaluate((id) => self.__sequoiaTogglePanel({ windowId: id }), winId);
  check('Toggle: and closed again', await waitFor(false));

  // the panel page opened as a normal tab must not be mistaken for the panel
  const asTab = await browser.newPage();
  await asTab.goto(`chrome-extension://${extId}/sidepanel.html`);
  await asTab.waitForSelector('.todo-input');
  await sleep(600);
  const tabTargetId = asTab.target()._targetId;
  await ntp.bringToFront();
  await ntp.click('.todo-head .todo-side');
  await waitFor(true, [tabTargetId]);
  await sleep(800);
  await worker.evaluate((id) => self.__sequoiaTogglePanel({ windowId: id }), winId);
  const closedReal = await waitFor(false, [tabTargetId]);
  check('Toggle: closes the real panel but never a to-do page open in a normal tab', closedReal && !asTab.isClosed() && (await asTab.evaluate(() => !!document.querySelector('.todo-input'))));
  await asTab.close();
  errors.splice(0, errors.length, ...errors.filter((e) => !/user gesture/.test(e))); // the expected refusal above

  const relevantA = errors.filter((e) => !/net::ERR_ABORTED|ERR_NAME_NOT_RESOLVED/.test(e));
  check('No console errors (part 1)', relevantA.length === 0, relevantA.join('\n'));
  await browser.close();
  await sleep(1500);

  // ---- updated on disk but not reloaded: the button finishes the update itself
  const dir = path.join(__dirname, 'out', 'ext-nopanel');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(EXT, dir, { recursive: true, filter: (s) => !/[\\/](tests|dist)([\\/]|$)/.test(s.slice(EXT.length)) });
  const mPath = path.join(dir, 'manifest.json');
  const full = fs.readFileSync(mPath, 'utf8');
  const old = JSON.parse(full);
  old.permissions = old.permissions.filter((p) => p !== 'sidePanel');
  delete old.side_panel;
  old.version = '1.4.2';
  fs.writeFileSync(mPath, JSON.stringify(old, null, 2));
  fs.rmSync(path.join(__dirname, 'p-sidepanel-old'), { recursive: true, force: true });
  ({ browser, extId } = await launch({ profile: 'p-sidepanel-old', ext: dir }));
  const p = await browser.newPage();
  watch(p, 'old', errors);
  await p.setViewport({ width: 1227, height: 700 });
  await p.goto('chrome://newtab');
  await p.waitForSelector('#w-todo .todo-side');
  await sleep(600);
  check('(setup) older install has no side panel API yet', await p.evaluate(() => !chrome.sidePanel));
  check('(setup) no update banner while files match', !(await p.$('.update-banner')));
  fs.writeFileSync(mPath, full); // the update lands on disk
  await p.reload();
  await p.waitForSelector('#w-todo .todo-side');
  await sleep(800);
  const banner = await p.$eval('.update-banner', (b) => b.textContent).catch(() => '');
  check('New Tab notices the update on disk and offers "Finish update"', /is ready\./.test(banner) && /Finish update/.test(banner), banner);
  const reopened = new Promise((resolve) => browser.on('targetcreated', (t) => t.type() === 'page' && resolve(t)));
  await p.click('.todo-head .todo-side').catch(() => {});
  const t2 = await Promise.race([reopened, sleep(10000).then(() => null)]);
  check('Not reloaded yet: the button finishes the update and reopens a New Tab', !!t2);
  if (t2) {
    const np = await t2.page();
    await np.waitForSelector('#w-todo .todo-side', { timeout: 10000 }).catch(() => {});
    const after = await np.evaluate(() => ({ api: !!chrome.sidePanel?.open, v: chrome.runtime.getManifest().version })).catch(() => ({}));
    check('…after which the side panel is available', after.api === true && after.v !== '1.4.2', JSON.stringify(after));
  }

  const relevant = errors.filter((e) => !/net::ERR_ABORTED|ERR_NAME_NOT_RESOLVED/.test(e));
  check('No console errors', relevant.length === 0, relevant.join('\n'));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  await browser.close().catch(() => {});
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('HARNESS ERROR', e);
  process.exit(2);
});

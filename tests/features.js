// End-to-end tests for: shortcut folders, "open all", to-do widget,
// backup export/import, and the Ctrl+K command palette.
const fs = require('fs');
const { launch, watch, sleep, OUT, path, workerHandle } = require('./common');

const results = [];
const errors = [];
function check(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: String(detail).slice(0, 300) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 200) : ''}`);
}
const PROFILE = 'p-features';
const get = (w, k = null) => w.evaluate((k) => chrome.storage.local.get(k), k);
const put = (w, o) => w.evaluate((o) => chrome.storage.local.set(o), o);
const titles = (list) => list.map((s) => (s.type === 'folder' ? `[${s.title}:${s.children.map((c) => c.title).join('|')}]` : s.title)).join(', ');

async function openNtp(browser, label, viewport = { width: 1280, height: 800 }) {
  const page = await browser.newPage();
  watch(page, label, errors);
  await page.setViewport(viewport);
  await page.goto('chrome://newtab');
  await page.waitForSelector('.clock-time', { timeout: 10000 });
  await sleep(700);
  return page;
}
const clickMenu = (page, text) => page.evaluate((t) => {
  const el = [...document.querySelectorAll('.menu .menu-item')].find((b) => b.textContent.trim() === t || b.textContent.trim().startsWith(t));
  if (!el) return false;
  el.click();
  return true;
}, text);
const tileMore = (page, title) => page.evaluate((t) => {
  const li = [...document.querySelectorAll('#w-shortcuts .tile')].find((x) => x.querySelector('.tile-label')?.textContent === t);
  li?.querySelector('.tile-more').click();
  return !!li;
}, title);
async function dropOnto(page, srcTitle, dstTitle, zone = 0.5) {
  return page.evaluate((s, d, zone) => {
    const find = (t) => [...document.querySelectorAll('#w-shortcuts .tile')].find((x) => x.querySelector('.tile-label')?.textContent === t);
    const src = find(s);
    const dst = find(d);
    if (!src || !dst) return false;
    const dt = new DataTransfer();
    const r = dst.getBoundingClientRect();
    const x = r.left + r.width * zone;
    const y = r.top + r.height / 2;
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
    dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
    src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    return true;
  }, srcTitle, dstTitle, zone);
}

(async () => {
  fs.rmSync(path.join(__dirname, PROFILE), { recursive: true, force: true });
  let { browser, swTarget, extId } = await launch({ profile: PROFILE });
  let worker = workerHandle(browser, extId);
  void swTarget;
  worker.on('console', (m) => ['error', 'warning'].includes(m.type()) && errors.push('[sw] ' + m.text()));
  let page = await openNtp(browser, 'f1');

  // ------------------------------------------------------------ 1. folders
  check('Folders: original 10 links still shown first', (await page.$$eval('#w-shortcuts .tile:not(.tile-add) .tile-label', (e) => e.map((x) => x.textContent))).join() === 'All Plugings,My plugin,Gmail,bplugins mail,Present sheet,Freemius,ClickUp,Support Desk,Daily Workshit,mail swarm');

  await tileMore(page, 'Gmail');
  await sleep(150);
  await page.evaluate(() => [...document.querySelectorAll('.menu .menu-item')].find((b) => b.textContent === 'Add to folder').click());
  await sleep(250);
  check('Folders: "Add to folder" submenu offers "New folder…"', await clickMenu(page, 'New folder…'));
  await page.waitForSelector('dialog[open] #nd-name');
  await page.type('#nd-name', 'Mail'); // value is pre-selected, typing replaces it
  await page.click('dialog[open] button[type=submit]');
  await sleep(500);
  let { shortcuts } = await get(worker, 'shortcuts');
  check('Folders: new folder created in place of the tile', titles(shortcuts).startsWith('All Plugings, My plugin, [Mail:Gmail], bplugins mail'), titles(shortcuts));
  const folderTile = await page.$eval('#w-shortcuts .tile-folder', (t) => ({ label: t.querySelector('.tile-label').textContent, minis: t.querySelectorAll('.folder-mini').length, aria: t.querySelector('.tile-link').getAttribute('aria-label') }));
  check('Folders: folder tile shows name, preview icons and accessible label', folderTile.label === 'Mail' && folderTile.minis === 1 && /Folder Mail, 1 shortcuts/.test(folderTile.aria), JSON.stringify(folderTile));

  await dropOnto(page, 'bplugins mail', 'Mail', 0.5);
  await sleep(500);
  ({ shortcuts } = await get(worker, 'shortcuts'));
  check('Folders: dropping a tile onto a folder adds it', titles(shortcuts).includes('[Mail:Gmail|bplugins mail]'), titles(shortcuts));

  await dropOnto(page, 'Freemius', 'ClickUp', 0.5);
  await page.waitForSelector('dialog.folder-dialog[open] .folder-title', { timeout: 4000 }).catch(() => {});
  const renameFocused = await page.evaluate(() => document.activeElement?.classList.contains('folder-title'));
  check('Folders: dropping a tile onto another creates a folder and focuses its name', renameFocused);
  await page.keyboard.type('Work');
  await page.keyboard.press('Enter');
  await sleep(400);
  ({ shortcuts } = await get(worker, 'shortcuts'));
  check('Folders: inline rename in the folder window saves', titles(shortcuts).includes('[Work:ClickUp|Freemius]'), titles(shortcuts));
  await page.keyboard.press('Escape');
  await sleep(300);

  // reorder by dropping on the edge (not into)
  await dropOnto(page, 'mail swarm', 'All Plugings', 0.1);
  await sleep(400);
  ({ shortcuts } = await get(worker, 'shortcuts'));
  check('Folders: dropping on a tile edge still reorders', shortcuts[0].title === 'mail swarm', titles(shortcuts));
  await dropOnto(page, 'mail swarm', 'Daily Workshit', 0.9);
  await sleep(400);

  // open folder window & child menu inside the modal
  await page.click('#w-shortcuts .tile-folder .tile-link');
  await page.waitForSelector('dialog.folder-dialog[open]');
  await sleep(300);
  const inside = await page.$$eval('dialog.folder-dialog[open] .tile:not(.tile-add) .tile-label', (e) => e.map((x) => x.textContent));
  check('Folders: clicking a folder opens it with its shortcuts', inside.join() === 'Gmail,bplugins mail', inside.join());
  const href = await page.$eval('dialog.folder-dialog[open] .tile-link', (a) => a.getAttribute('href'));
  check('Folders: links inside folders are real links', href === 'https://mail.google.com/mail/u/0/#inbox', href);
  await page.click('dialog.folder-dialog[open] .tile:nth-child(2) .tile-more');
  await sleep(250);
  const menuInDialog = await page.evaluate(() => {
    const m = document.querySelector('.menu');
    if (!m) return 'none';
    const r = m.getBoundingClientRect();
    const topEl = document.elementFromPoint(r.left + 20, r.top + 15);
    return m.closest('dialog') && m.contains(topEl) ? 'ok' : 'covered';
  });
  check('Folders: ⋯ menu inside the folder window is visible and clickable', menuInDialog === 'ok', menuInDialog);
  await clickMenu(page, 'Move out of folder');
  await sleep(500);
  ({ shortcuts } = await get(worker, 'shortcuts'));
  check('Folders: "Move out of folder" places it after the folder', titles(shortcuts).includes('[Mail:Gmail], bplugins mail'), titles(shortcuts));
  // keyboard reorder inside folder: add a second item first via + tile
  await page.click('dialog.folder-dialog[open] .tile-add .tile-link');
  await page.waitForSelector('dialog.form-dialog[open] #ld-url');
  await page.type('#ld-url', 'mail.yahoo.com');
  await page.click('dialog.form-dialog[open] button[type=submit]');
  await sleep(500);
  ({ shortcuts } = await get(worker, 'shortcuts'));
  check('Folders: "+" inside a folder adds a shortcut to that folder', titles(shortcuts).includes('[Mail:Gmail|Yahoo]'), titles(shortcuts));
  await page.focus('dialog.folder-dialog[open] .tile:nth-child(2) .tile-link');
  await page.keyboard.down('Control'); await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.up('Shift'); await page.keyboard.up('Control');
  await sleep(400);
  ({ shortcuts } = await get(worker, 'shortcuts'));
  check('Folders: Ctrl+Shift+← reorders inside a folder', titles(shortcuts).includes('[Mail:Yahoo|Gmail]'), titles(shortcuts));
  await page.screenshot({ path: path.join(OUT, 'f-folder-window.png') });

  // ------------------------------------------------------------ 5. open all
  const extraTabsKeep = await worker.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.id));
  const tabsBefore = extraTabsKeep.length;
  await page.click('dialog.folder-dialog[open] .folder-head .btn.primary');
  await sleep(1500);
  const tabsAfter = await worker.evaluate(async () => (await chrome.tabs.query({})).length);
  check('Open all: folder button opens every shortcut in background tabs', tabsAfter - tabsBefore === 2, `${tabsBefore} -> ${tabsAfter}`);
  check('Open all: the New Tab page stays in front', await page.evaluate(() => document.visibilityState === 'visible'));
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.bringToFront();
  await page.evaluate(() => [...document.querySelectorAll('#w-shortcuts .tile-folder')].find((t) => t.querySelector('.tile-label').textContent === 'Work').querySelector('.tile-more').click());
  await sleep(200);
  const before2 = await worker.evaluate(async () => (await chrome.tabs.query({})).length);
  await clickMenu(page, 'Open all 2 in new tabs');
  await sleep(1500);
  const after2 = await worker.evaluate(async () => (await chrome.tabs.query({})).length);
  check('Open all: folder ⋯ menu "Open all" works', after2 - before2 === 2, `${before2} -> ${after2}`);
  // Close the tabs "Open all" created, by id (closing still-loading real
  // sites through Puppeteer can stall).
  await worker.evaluate(async (keep) => {
    const tabs = await chrome.tabs.query({});
    await chrome.tabs.remove(tabs.map((t) => t.id).filter((id) => !keep.includes(id)));
  }, extraTabsKeep);
  await page.bringToFront();

  // ungroup + empty-folder removal + delete
  await page.evaluate(() => [...document.querySelectorAll('#w-shortcuts .tile-folder')].find((t) => t.querySelector('.tile-label').textContent === 'Work').querySelector('.tile-more').click());
  await sleep(200);
  await clickMenu(page, 'Ungroup');
  await sleep(400);
  ({ shortcuts } = await get(worker, 'shortcuts'));
  check('Folders: Ungroup puts the shortcuts back on the page', !titles(shortcuts).includes('[Work') && titles(shortcuts).includes('ClickUp, Freemius'), titles(shortcuts));

  await page.reload();
  await page.waitForSelector('.tile-folder');
  check('Folders: persist after reload', (await page.$$eval('.tile-folder .tile-label', (e) => e.map((x) => x.textContent))).join() === 'Mail');

  // settings list shows folder row
  await page.click('#corner-actions .round-btn[aria-label="Customize New Tab"]');
  await page.waitForSelector('dialog.settings-dialog[open]');
  await page.click('#tab-shortcuts');
  await sleep(300);
  const folderRow = await page.$$eval('dialog[open] .list-item .li-sub', (e) => e.map((x) => x.textContent).find((t) => t.startsWith('Folder')));
  check('Folders: settings list shows folders with their size', folderRow === 'Folder · 2 shortcuts', folderRow);
  await page.keyboard.press('Escape');
  await sleep(300);

  // removing every shortcut from a folder removes the folder
  await page.click('#w-shortcuts .tile-folder .tile-link');
  await page.waitForSelector('dialog.folder-dialog[open]');
  for (let i = 0; i < 2; i++) {
    await page.click('dialog.folder-dialog[open] .tile:not(.tile-add) .tile-more');
    await sleep(200);
    await clickMenu(page, 'Remove');
    await sleep(400);
  }
  ({ shortcuts } = await get(worker, 'shortcuts'));
  const dlgOpen = await page.$('dialog.folder-dialog[open]');
  check('Folders: an emptied folder disappears and its window closes', !shortcuts.some((s) => s.type === 'folder') && !dlgOpen, titles(shortcuts));

  // ------------------------------------------------------------ 3. to-do
  check('To-do: widget visible by default', await page.$eval('#w-todo', (e) => !e.hidden && !!e.querySelector('.todo-input')));
  await page.click('.todo-input');
  await page.type('.todo-input', 'Reply to support tickets');
  await page.keyboard.press('Enter');
  await page.click('.todo-form .todo-daily'); // next task repeats daily
  await page.type('.todo-input', 'Check Freemius sales');
  await page.keyboard.press('Enter');
  await page.type('.todo-input', 'Write release notes');
  await page.keyboard.press('Enter');
  await sleep(500);
  let { todos } = await get(worker, 'todos');
  check('To-do: tasks are added with Enter and saved', todos.items.length === 3 && todos.items[1].daily === true && todos.items[0].daily === false, JSON.stringify(todos.items.map((t) => [t.text, t.daily])));
  check('To-do: count shows tasks left', (await page.$eval('.todo-count', (e) => e.textContent)) === '3 left');
  const p2 = await openNtp(browser, 'f2');
  const synced = await p2.$$eval('.todo-text', (e) => e.map((x) => x.textContent));
  check('To-do: list is shared across open tabs', synced.length === 3, synced.join('|'));
  await page.bringToFront();
  await page.click('.todo-item:nth-child(1) .todo-check');
  await page.click('.todo-item:nth-child(2) .todo-check');
  await sleep(500);
  ({ todos } = await get(worker, 'todos'));
  check('To-do: checking off saves and strikes through', todos.items[0].done && todos.items[1].done && (await page.$$eval('.todo-item.done', (e) => e.length)) === 2);
  // edit by double-click
  await page.click('.todo-item:nth-child(3) .todo-text', { clickCount: 2 });
  await page.waitForSelector('.todo-edit');
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
  await page.keyboard.type('Write release notes v1.1');
  await page.keyboard.press('Enter');
  await sleep(400);
  ({ todos } = await get(worker, 'todos'));
  check('To-do: double-click edits a task', todos.items[2].text === 'Write release notes v1.1', todos.items[2].text);
  // new day rollover
  await put(worker, { todos: { ...todos, day: '2000-01-01' } });
  await sleep(200);
  await page.reload();
  await page.waitForSelector('.todo-item');
  await sleep(500);
  ({ todos } = await get(worker, 'todos'));
  check('To-do: on a new day, daily tasks reset and one-off tasks keep their state', todos.items[1].done === false && todos.items[0].done === true && todos.day !== '2000-01-01', JSON.stringify(todos.items.map((t) => [t.text.slice(0, 10), t.done, t.daily])));
  // clear completed
  await page.click('.todo-head .icon-btn[aria-label="To-do options"]');
  await sleep(200);
  await clickMenu(page, 'Clear completed');
  await sleep(400);
  ({ todos } = await get(worker, 'todos'));
  check('To-do: "Clear completed" removes finished one-off tasks only', todos.items.length === 2 && !todos.items.some((t) => t.text.startsWith('Reply')), JSON.stringify(todos.items.map((t) => t.text)));
  // delete via button keeps focus nearby
  await page.focus('.todo-item:nth-child(2) .todo-check');
  await page.click('.todo-item:nth-child(2) .todo-act[aria-label^="Delete"]');
  await sleep(400);
  ({ todos } = await get(worker, 'todos'));
  check('To-do: delete button removes a task', todos.items.length === 1);
  // layout: floating at the user's window size without covering anything
  for (const [w, hgt] of [[1227, 700], [1440, 900], [1024, 700], [390, 844]]) {
    await page.setViewport({ width: w, height: hgt });
    await sleep(500);
    const m = await page.evaluate(() => {
      const card = document.getElementById('w-todo');
      const cr = card.getBoundingClientRect();
      const hit = [...document.querySelectorAll('#stage .clock-date, #stage .clock-time, #stage .search-form, #stage .tile')].filter((n) => {
        const r = n.getBoundingClientRect();
        return r.width && r.left < cr.right && r.right > cr.left && r.top < cr.bottom && r.bottom > cr.top;
      }).map((n) => n.className);
      return { floating: card.classList.contains('floating'), overlaps: hit, overflowX: document.documentElement.scrollWidth > innerWidth };
    });
    check(`To-do: @${w}x${hgt} never covers clock, search or tiles`, m.overlaps.length === 0 && !m.overflowX, JSON.stringify(m));
    await page.screenshot({ path: path.join(OUT, `f-todo-${w}.png`) });
  }
  await page.setViewport({ width: 1280, height: 800 });
  // stage content reachable on a short window with the card in flow
  await page.setViewport({ width: 700, height: 560 });
  await sleep(500);
  const reach = await page.evaluate(() => {
    const st = document.getElementById('stage');
    st.scrollTop = 0;
    const d = document.querySelector('.clock-date').getBoundingClientRect();
    return { dateTop: Math.round(d.top), scrollable: st.scrollHeight > st.clientHeight };
  });
  check('Layout: on a short window content scrolls instead of being cut off at the top', reach.dateTop >= 0, JSON.stringify(reach));
  await page.setViewport({ width: 1280, height: 800 });
  // hide via settings
  await page.click('#corner-actions .round-btn[aria-label="Customize New Tab"]');
  await page.waitForSelector('dialog.settings-dialog[open]');
  await page.click('#tab-widgets');
  await page.click('[data-k="w-todo"] input');
  await sleep(400);
  check('To-do: can be hidden in Settings → Widgets', await page.$eval('#w-todo', (e) => e.hidden));
  await page.click('[data-k="w-todo"] input');
  await sleep(300);

  // ------------------------------------------------------------ 18. backup
  await page.click('#tab-about');
  await sleep(300);
  const tabLabel = await page.$eval('#tab-about', (t) => t.textContent);
  check('Backup: section is in Settings', /Backup/.test(tabLabel), tabLabel);
  // export via the real button, capture the download
  const dlDir = path.join(__dirname, 'out', 'downloads');
  fs.rmSync(dlDir, { recursive: true, force: true });
  fs.mkdirSync(dlDir, { recursive: true });
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
  await put(worker, { secrets: { unsplashKey: 'secret_key_should_not_be_exported_123' } });
  await page.evaluate(() => [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent.includes('Export backup')).click());
  let file = null;
  for (let i = 0; i < 30 && !file; i++) {
    await sleep(200);
    file = fs.readdirSync(dlDir).find((f) => f.endsWith('.json'));
  }
  check('Backup: export downloads a dated JSON file', !!file && /^sequoia-tab-backup-\d{4}-\d{2}-\d{2}\.json$/.test(file), file);
  const backupText = file ? fs.readFileSync(path.join(dlDir, file), 'utf8') : '{}';
  const backup = JSON.parse(backupText);
  check('Backup: contains settings, shortcuts, dock, favorites and to-dos', backup.app === 'sequoia-tab' && backup.format === 1 && backup.settings && Array.isArray(backup.shortcuts) && Array.isArray(backup.dock) && backup.todos?.items?.length === 1);
  check('Backup: never contains the Unsplash key', !backupText.includes('secret_key_should_not_be_exported'));

  // change things, then import the backup through the UI
  await put(worker, { shortcuts: [], todos: { items: [], day: '' } });
  await sleep(400);
  check('Backup: (setup) data cleared before import', (await page.$$eval('#w-shortcuts .tile:not(.tile-add)', (e) => e.length)) === 0);
  const fileInput = await page.$('dialog.settings-dialog[open] input[type=file]');
  await fileInput.uploadFile(path.join(dlDir, file));
  await page.waitForSelector('dialog.form-dialog[open]');
  const confirmText = await page.$eval('dialog.form-dialog[open] .note', (e) => e.textContent);
  check('Backup: import asks for confirmation with a summary', /shortcuts/.test(confirmText) && /1 tasks/.test(confirmText), confirmText);
  await page.evaluate(() => [...document.querySelectorAll('dialog.form-dialog[open] button')].find((b) => b.textContent === 'Restore').click());
  await sleep(800);
  const restored = await get(worker, ['shortcuts', 'todos', 'secrets']);
  check('Backup: import restores shortcuts and to-dos', restored.shortcuts.length === backup.shortcuts.length && restored.todos.items.length === 1, titles(restored.shortcuts));
  check('Backup: import keeps the Unsplash key untouched', restored.secrets.unsplashKey === 'secret_key_should_not_be_exported_123');
  check('Backup: the page updates immediately after import', (await page.$$eval('#w-shortcuts .tile:not(.tile-add)', (e) => e.length)) === backup.shortcuts.length);
  // malicious / invalid backups
  const evil = { app: 'sequoia-tab', format: 1, shortcuts: [{ title: 'xss', url: 'javascript:alert(1)' }, { type: 'folder', title: 'F', children: [{ title: 'ok', url: 'https://ok.example/' }, { title: 'bad', url: 'data:text/html,hi' }] }], dock: [{ title: 'D', url: 'https://d.example', icon: 'http://insecure.example/i.png' }], favorites: [{ id: 'x', raw: 'https://evil.example/a.jpg', author: 'x' }], todos: { items: [{ text: 'a'.repeat(1000) }] } };
  fs.writeFileSync(path.join(OUT, 'evil.json'), JSON.stringify(evil));
  fs.writeFileSync(path.join(OUT, 'notbackup.json'), JSON.stringify({ hello: 1 }));
  await fileInput.uploadFile(path.join(OUT, 'notbackup.json'));
  await sleep(600);
  check('Backup: unrelated JSON is rejected with a message', (await page.$$eval('.toast', (t) => t.map((x) => x.textContent))).some((t) => /isn’t a Sequoia Tab backup/.test(t)));
  await (await page.$('dialog.settings-dialog[open] input[type=file]')).uploadFile(path.join(OUT, 'evil.json'));
  await page.waitForSelector('dialog.form-dialog[open]');
  await page.evaluate(() => [...document.querySelectorAll('dialog.form-dialog[open] button')].find((b) => b.textContent === 'Restore').click());
  await sleep(800);
  const ev = await get(worker, ['shortcuts', 'dock', 'favorites', 'todos']);
  check('Backup: unsafe URLs and data are stripped on import', ev.shortcuts.length === 1 && ev.shortcuts[0].children.length === 1 && ev.shortcuts[0].children[0].url === 'https://ok.example/' && !ev.dock[0].icon && ev.favorites.length === 0 && ev.todos.items[0].text.length === 300, JSON.stringify({ sc: ev.shortcuts, dock: ev.dock, fav: ev.favorites.length }));
  // restore the good backup for the next tests
  await (await page.$('dialog.settings-dialog[open] input[type=file]')).uploadFile(path.join(dlDir, file));
  await page.waitForSelector('dialog.form-dialog[open]');
  await page.evaluate(() => [...document.querySelectorAll('dialog.form-dialog[open] button')].find((b) => b.textContent === 'Restore').click());
  await sleep(800);
  await page.keyboard.press('Escape');
  await sleep(300);

  // ------------------------------------------------------------ 20. palette
  // Known data: the original links with Gmail + bplugins mail in a "Mail" folder.
  await page.evaluate(async () => {
    const { shortcuts } = await chrome.storage.local.get('shortcuts');
    const flat = [];
    for (const s of shortcuts) (s.type === 'folder' ? s.children : [s]).forEach((x) => flat.push(x));
    const keep = flat.filter((x) => !['Gmail', 'bplugins mail'].includes(x.title));
    keep.splice(2, 0, { id: 'fd_mail', type: 'folder', title: 'Mail', children: [
      { id: 'sc_gmail', title: 'Gmail', url: 'https://mail.google.com/mail/u/0/#inbox' },
      { id: 'sc_bpm', title: 'bplugins mail', url: 'https://gcam1012.siteground.biz/webmail/mail/' },
    ] });
    await chrome.storage.local.set({ shortcuts: keep });
  });
  await page.reload();
  await page.waitForSelector('.clock-time');
  await sleep(500);
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
  await sleep(300);
  check('Palette: Ctrl+K opens it with the input focused', await page.evaluate(() => !!document.querySelector('dialog.palette-dialog[open]') && document.activeElement.classList.contains('pal-input')));
  await page.keyboard.type('supp');
  await sleep(300);
  let first = await page.$eval('.pal-item[aria-selected="true"] .pal-title', (e) => e.textContent);
  check('Palette: finds shortcuts by name', first === 'Support Desk', first);
  await page.$eval('.pal-input', (e) => (e.value = ''));
  await page.keyboard.type('sd');
  await sleep(300);
  first = await page.$eval('.pal-item[aria-selected="true"] .pal-title', (e) => e.textContent);
  check('Palette: matches word initials ("sd" → Support Desk)', first === 'Support Desk', first);
  await page.$eval('.pal-input', (e) => (e.value = ''));
  await page.keyboard.type('gm');
  await sleep(300);
  const gm = await page.$$eval('.pal-item .pal-title', (e) => e.map((x) => x.textContent));
  check('Palette: no loose junk matches ("gm" doesn\'t match "My plugin")', gm[0] === 'Gmail' && !gm.includes('My plugin'), gm.join('|'));
  // folder shortcut by folder name
  await page.$eval('.pal-input', (e) => (e.value = ''));
  await page.keyboard.type('mail');
  await sleep(300);
  const mailItems = await page.$$eval('.pal-item', (e) => e.map((x) => x.querySelector('.pal-title').textContent + '/' + x.querySelector('.pal-kind').textContent));
  check('Palette: finds folders and offers "Open all in …"', mailItems.some((t) => t === 'Open all in Mail/Folder'), mailItems.join(' | '));
  // bookmarks
  await worker.evaluate(async () => {
    const tree = await chrome.bookmarks.getTree();
    await chrome.bookmarks.create({ parentId: tree[0].children[0].id, title: 'Palette bookmark test', url: 'https://example.com/palette' });
  });
  await page.$eval('.pal-input', (e) => (e.value = ''));
  await page.keyboard.type('palette book');
  await sleep(500);
  const bm = await page.$$eval('.pal-item', (e) => e.map((x) => x.querySelector('.pal-title').textContent + '/' + x.querySelector('.pal-kind').textContent));
  check('Palette: searches Chrome bookmarks', bm.includes('Palette bookmark test/Bookmark'), bm.join(' | '));
  // arrow keys + Enter opens
  await page.$eval('.pal-input', (e) => (e.value = ''));
  await page.keyboard.type('support');
  await sleep(300);
  let nav = page.waitForNavigation({ timeout: 8000 }).catch(() => null);
  await page.keyboard.press('Enter');
  await nav;
  check('Palette: Enter opens the selected shortcut', page.url().startsWith('https://tickets.bplugins.com/'), page.url());
  await page.goto('chrome://newtab');
  await page.waitForSelector('.clock-time');
  await sleep(400);
  // actions: add task
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
  await sleep(250);
  await page.keyboard.type('Call the designer');
  await sleep(300);
  const items = await page.$$eval('.pal-item .pal-title', (e) => e.map((x) => x.textContent));
  const idx = items.indexOf('Add task: Call the designer');
  for (let i = 0; i < idx; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await sleep(500);
  const t2 = (await get(worker, 'todos')).todos;
  check('Palette: arrow keys + Enter run actions ("Add task")', idx >= 0 && t2.items.some((t) => t.text === 'Call the designer'), items.join(' | '));
  // web search fallback & URL
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
  await sleep(250);
  await page.keyboard.type('example.com/hello');
  await sleep(300);
  first = await page.$eval('.pal-item[aria-selected="true"] .pal-kind', (e) => e.textContent);
  check('Palette: typing an address offers "Go to" first', first === 'Go to', first);
  await page.$eval('.pal-input', (e) => (e.value = ''));
  await page.keyboard.type('zzqx unlikely words');
  await sleep(300);
  first = await page.$eval('.pal-item[aria-selected="true"] .pal-title', (e) => e.textContent);
  check('Palette: with no local match, web search is first', first === 'Search for “zzqx unlikely words”', first);
  // settings action
  await page.$eval('.pal-input', (e) => (e.value = ''));
  await page.keyboard.type('settings dock');
  await sleep(300);
  await page.keyboard.press('Enter');
  await sleep(500);
  const sec = await page.evaluate(() => document.querySelector('dialog.settings-dialog[open] .settings-head h3')?.textContent);
  check('Palette: settings commands open the right section', sec === 'Dock', sec);
  await page.keyboard.press('Escape');
  await sleep(300);
  // Ctrl+K toggles closed, Escape closes, corner button opens
  await page.click('#corner-actions .round-btn[aria-label^="Command palette"]');
  await sleep(250);
  const viaButton = !!(await page.$('dialog.palette-dialog[open]'));
  await page.keyboard.press('Escape');
  await sleep(250);
  check('Palette: corner button opens it, Escape closes it', viaButton && !(await page.$('dialog.palette-dialog[open]')));
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
  await sleep(250);
  await page.screenshot({ path: path.join(OUT, 'f-palette.png') });
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
  await sleep(250);
  check('Palette: Ctrl+K again closes it', !(await page.$('dialog.palette-dialog[open]')));

  // ------------------------------------------------------------ persistence across restart
  const beforeAll = await page.evaluate(() => chrome.storage.local.get(null));
  for (const p of await browser.pages()) await p.close().catch(() => {});
  await browser.close();
  await sleep(3000); // let Chrome release the profile lock
  ({ browser, swTarget, extId } = await launch({ profile: PROFILE }));
  worker = workerHandle(browser, extId);
  page = await openNtp(browser, 'f-restart');
  const afterAll = await page.evaluate(() => chrome.storage.local.get(null));
  check('Restart: folders and to-dos persist after restarting Chrome', JSON.stringify(afterAll.shortcuts) === JSON.stringify(beforeAll.shortcuts) && JSON.stringify(afterAll.todos) === JSON.stringify(beforeAll.todos) && (await page.$$('.tile-folder')).length === 1);

  const relevant = errors.filter((e) => !/net::ERR_ABORTED|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED/.test(e));
  check('No console errors from extension pages or the service worker', relevant.length === 0, relevant.join('\n'));
  fs.writeFileSync(path.join(OUT, 'features-report.json'), JSON.stringify({ results, errors }, null, 2));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('HARNESS ERROR', e);
  process.exit(2);
});

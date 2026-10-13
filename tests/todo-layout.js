// End-to-end tests: drag the to-do card to move it, drag its corner to resize.
const fs = require('fs');
const { launch, watch, sleep, OUT, path } = require('./common');

const results = [];
const errors = [];
function check(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: String(detail).slice(0, 300) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 220) : ''}`);
}
const rect = (page) => page.$eval('#w-todo', (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), placed: e.classList.contains('placed'), floating: e.classList.contains('floating') }; });
const saved = (page) => page.evaluate(async () => (await chrome.storage.local.get('settings')).settings.widgets.todoBox);

async function dragMouse(page, from, to, steps = 12) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
  await sleep(500);
}

(async () => {
  fs.rmSync(path.join(__dirname, 'p-todo-layout'), { recursive: true, force: true });
  const { browser } = await launch({ profile: 'p-todo-layout' });
  const page = await browser.newPage();
  watch(page, 'todo', errors);
  await page.setViewport({ width: 1227, height: 700 });
  await page.goto('chrome://newtab');
  await page.waitForSelector('#w-todo .todo-head');
  await sleep(800);
  // a few tasks so height matters
  for (const t of ['Reply to tickets', 'Check sales', 'Write notes', 'Plan release', 'Review PRs', 'Update docs']) {
    await page.type('.todo-input', t);
    await page.keyboard.press('Enter');
  }
  await sleep(400);

  const r0 = await rect(page);
  check('Starts in its automatic spot (floating top-right)', r0.floating && !r0.placed, JSON.stringify(r0));
  check('Move grip and resize corner are shown on the floating card', await page.evaluate(() => getComputedStyle(document.querySelector('.todo-grip')).display !== 'none' && getComputedStyle(document.querySelector('.todo-resize')).display !== 'none'));

  // ---- drag by the header title area
  const title = await page.$eval('.todo-title', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2 }; });
  await dragMouse(page, title, { x: title.x - 600, y: title.y + 180 });
  const r1 = await rect(page);
  check('Drag the header: the card moves with the mouse', r1.placed && Math.abs(r1.x - (r0.x - 600)) <= 2 && Math.abs(r1.y - (r0.y + 180)) <= 2, JSON.stringify({ before: r0, after: r1 }));
  let s = await saved(page);
  check('…and the new position is saved', s.custom === true && Math.abs(s.x - r1.x) <= 1 && Math.abs(s.y - r1.y) <= 1, JSON.stringify(s));
  await page.screenshot({ path: path.join(OUT, 'todo-moved.png') });

  // buttons in the header still work (no accidental drag)
  await page.click('.todo-head .icon-btn[aria-label="To-do options"]');
  await sleep(200);
  const menuOpen = !!(await page.$('.menu'));
  await page.keyboard.press('Escape');
  const r1b = await rect(page);
  check('Header buttons still click normally (no accidental move)', menuOpen && r1b.x === r1.x && r1b.y === r1.y);

  // ---- resize by the corner
  const corner = await page.$eval('.todo-resize', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await dragMouse(page, corner, { x: corner.x + 120, y: corner.y - 40 });
  const r2 = await rect(page);
  check('Drag the corner: width changes', Math.abs(r2.w - (r1.w + 120)) <= 2, `${r1.w} -> ${r2.w}`);
  check('Drag the corner: height changes and position stays', Math.abs(r2.h - (r1.h - 40)) <= 2 && r2.x === r1.x && r2.y === r1.y, `${r1.h} -> ${r2.h}`);
  s = await saved(page);
  check('…and the size is saved', Math.abs(s.w - r2.w) <= 1 && Math.abs(s.h - r2.h) <= 1, JSON.stringify(s));
  const scrolls = await page.$eval('.todo-list', (l) => l.scrollHeight > l.clientHeight || getComputedStyle(l).overflowY === 'auto');
  check('A smaller card keeps the task list scrollable', scrolls);

  // min / max limits
  const c2 = await page.$eval('.todo-resize', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + 9, y: r.top + 9 }; });
  await dragMouse(page, c2, { x: c2.x - 900, y: c2.y - 900 });
  const rMin = await rect(page);
  check('Resize stops at a sensible minimum (240×140)', rMin.w === 240 && rMin.h === 140, JSON.stringify(rMin));
  const c3 = await page.$eval('.todo-resize', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + 9, y: r.top + 9 }; });
  await dragMouse(page, c3, { x: c3.x + 2000, y: c3.y + 2000 });
  const rMax = await rect(page);
  check('Resize stops at a maximum and stays inside the window', rMax.w <= 640 && rMax.x + rMax.w <= 1227 - 8 + 1 && rMax.y + rMax.h <= 700 - 8 + 1, JSON.stringify(rMax));

  // ---- keep inside the window when dragged off-screen
  const t2 = await page.$eval('.todo-title', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + 20, y: r.top + 8 }; });
  await dragMouse(page, t2, { x: t2.x + 3000, y: t2.y + 3000 });
  const rOff = await rect(page);
  check('Dragging past the edge keeps the card on screen', rOff.x + rOff.w <= 1227 - 7 && rOff.y + rOff.h <= 700 - 7 && rOff.x >= 8 && rOff.y >= 8, JSON.stringify(rOff));

  // ---- keyboard (start from a mid-size card so every direction has room)
  await page.evaluate(async () => { const { settings } = await chrome.storage.local.get('settings'); settings.widgets.todoBox = { custom: true, x: 400, y: 200, w: 320, h: 300 }; await chrome.storage.local.set({ settings }); });
  await sleep(600);
  const k0 = await rect(page);
  await page.focus('.todo-grip');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.down('Shift'); await page.keyboard.press('ArrowRight'); await page.keyboard.up('Shift');
  await sleep(500);
  const k1 = await rect(page);
  check('Keyboard: arrow keys on the grip move the card (Shift = bigger steps)', k1.x === k0.x + 60 && k1.y === k0.y + 10, `${JSON.stringify(k0)} -> ${JSON.stringify(k1)}`);
  await page.focus('.todo-resize');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowUp');
  await sleep(500);
  const k2 = await rect(page);
  check('Keyboard: arrow keys on the corner resize the card', k2.w === k1.w + 20 && k2.h === k1.h - 10, `${k1.w}x${k1.h} -> ${k2.w}x${k2.h}`);
  await sleep(400);
  s = await saved(page);
  check('Keyboard changes are saved too', s.x === k2.x && s.w === k2.w, JSON.stringify(s));

  // ---- persists after reload and syncs to another tab
  await page.reload();
  await page.waitForSelector('#w-todo .todo-head');
  await sleep(700);
  const rr = await rect(page);
  check('Position and size persist after reload', rr.placed && rr.x === k2.x && rr.y === k2.y && rr.w === k2.w && rr.h === k2.h, JSON.stringify(rr));
  const other = await browser.newPage();
  await other.setViewport({ width: 1227, height: 700 });
  await other.goto('chrome://newtab');
  await other.waitForSelector('#w-todo .todo-head');
  await sleep(700);
  const ro = await rect(other);
  check('Other New Tabs use the same position and size', ro.x === k2.x && ro.y === k2.y && ro.w === k2.w, JSON.stringify(ro));
  await other.close();
  await page.bringToFront();

  // ---- collapse with a fixed height
  await page.click('.todo-head .icon-btn[aria-controls="todo-body"]');
  await sleep(300);
  const rc = await rect(page);
  check('Collapsing a resized card shrinks it to its header', rc.h < 70, rc.h);
  await page.click('.todo-head .icon-btn[aria-controls="todo-body"]');
  await sleep(300);

  // ---- window gets smaller: card stays visible
  await page.setViewport({ width: 800, height: 520 });
  await sleep(600);
  const rs = await rect(page);
  check('When the window shrinks, the card is pulled back into view', rs.x + rs.w <= 800 - 7 && rs.y + rs.h <= 520 - 7 && rs.x >= 8 && rs.y >= 8, JSON.stringify(rs));
  // narrow window: simple stacked layout, no drag handles
  await page.setViewport({ width: 390, height: 844 });
  await sleep(600);
  const rn = await rect(page);
  const noHandles = await page.evaluate(() => getComputedStyle(document.querySelector('.todo-resize')).display === 'none' && getComputedStyle(document.querySelector('.todo-grip')).display === 'none');
  check('Narrow window: card sits in the page normally (no overlap, no handles)', !rn.floating && noHandles && !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), JSON.stringify(rn));
  await page.setViewport({ width: 1227, height: 700 });
  await sleep(600);
  const rBack = await rect(page);
  check('Wide again: your saved spot comes back', rBack.placed && rBack.x === k2.x && rBack.y === k2.y, JSON.stringify(rBack));

  // ---- reset
  await page.click('.todo-head .icon-btn[aria-label="To-do options"]');
  await sleep(200);
  await page.evaluate(() => [...document.querySelectorAll('.menu .menu-item')].find((b) => b.textContent.startsWith('Reset size & position')).click());
  await sleep(600);
  const rReset = await rect(page);
  s = await saved(page);
  check('"Reset size & position" returns it to the automatic spot', !rReset.placed && rReset.floating && s.custom === false && Math.abs(rReset.x - r0.x) <= 2 && Math.abs(rReset.w - r0.w) <= 2, JSON.stringify({ rReset, r0 }));
  await page.screenshot({ path: path.join(OUT, 'todo-reset.png') });

  // double-click grip also resets
  await dragMouse(page, await page.$eval('.todo-title', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + 20, y: r.top + 8 }; }), { x: 300, y: 300 });
  await page.click('.todo-grip', { clickCount: 2 });
  await sleep(600);
  check('Double-clicking the grip also resets', !(await rect(page)).placed);

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

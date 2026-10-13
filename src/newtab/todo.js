// To-do widget: quick tasks plus "daily" routine tasks that reset each day.
// Stored locally in chrome.storage and kept in sync across open tabs.

import { h, clear } from './dom.js';
import { icon } from '../lib/icons.js';
import { MAX_TODOS, MAX_TODO_LENGTH, rollover, newTodo, dayKey } from '../lib/todo-model.js';
import { openMenu } from './menu.js';
import { store, saveTodos, updateSettings, on } from './store.js';
import { toast } from './ui.js';

const el = document.getElementById('w-todo');
let listEl;
let countEl;
let input;
let dailyBtn;
let collapsed = false;
let midnightTimer = null;
let editingId = null;
let panelMode = false; // true inside Chrome's side panel (sidepanel.html)
let shortcutLabel = ''; // e.g. "Ctrl+Shift+Y", shown in the panel menu
let windowId = null; // cached so "Open in side panel" keeps the click's user gesture

try {
  collapsed = localStorage.getItem('sequoia:todo-collapsed') === '1';
} catch {
  /* storage unavailable */
}

const items = () => store.todos.items;
const commit = (next) => saveTodos({ day: store.todos.day || dayKey(), items: next });

export function checkRollover() {
  const next = rollover(store.todos);
  if (next) saveTodos(next);
}

function scheduleMidnight() {
  clearTimeout(midnightTimer);
  const d = new Date();
  d.setHours(24, 0, 2, 0);
  midnightTimer = setTimeout(() => {
    checkRollover();
    scheduleMidnight();
  }, d.getTime() - Date.now());
}

export function addTodo(text, daily = false) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (items().length >= MAX_TODOS) {
    toast(`You can keep up to ${MAX_TODOS} tasks. Clear completed ones first.`, { error: true });
    return false;
  }
  commit([...items(), newTodo(t, daily)]);
  return true;
}

const patchItem = (id, patch) => commit(items().map((t) => (t.id === id ? { ...t, ...patch } : t)));

function startEdit(item, textEl) {
  editingId = item.id;
  const edit = h('input', { class: 'todo-edit', maxlength: String(MAX_TODO_LENGTH), 'aria-label': 'Edit task' });
  edit.value = item.text;
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    editingId = null;
    const v = edit.value.trim();
    if (save && v && v !== item.text) patchItem(item.id, { text: v.slice(0, MAX_TODO_LENGTH) });
    else render();
  };
  edit.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    }
  });
  edit.addEventListener('blur', () => finish(true));
  textEl.replaceWith(edit);
  edit.focus();
  edit.select();
}

function row(item) {
  const id = `todo-${item.id}`;
  const check = h('input', { type: 'checkbox', id, class: 'todo-check', checked: item.done, 'aria-label': item.text });
  check.addEventListener('change', () => patchItem(item.id, { done: check.checked }));
  // Plain text (not a <label>): double-click edits without toggling the box.
  const text = h('span', { class: 'todo-text', title: 'Double-click to edit' }, item.text);
  text.addEventListener('dblclick', (e) => {
    e.preventDefault();
    startEdit(item, text);
  });
  const daily = h('button', { type: 'button', class: 'icon-btn todo-daily', 'aria-pressed': String(!!item.daily), 'aria-label': item.daily ? `“${item.text}” repeats daily. Make it one-off` : `Repeat “${item.text}” daily`, title: item.daily ? 'Repeats every day' : 'Repeat daily' }, icon('repeat', { size: 14 }));
  daily.addEventListener('click', () => patchItem(item.id, { daily: !item.daily }));
  const edit = h('button', { type: 'button', class: 'icon-btn todo-act', 'aria-label': `Edit “${item.text}”` }, icon('edit', { size: 14 }));
  edit.addEventListener('click', () => startEdit(item, text));
  const del = h('button', { type: 'button', class: 'icon-btn todo-act', 'aria-label': `Delete “${item.text}”` }, icon('trash', { size: 14 }));
  del.addEventListener('click', () => {
    const idx = items().findIndex((t) => t.id === item.id);
    commit(items().filter((t) => t.id !== item.id));
    // Keep keyboard focus nearby after deleting.
    requestAnimationFrame(() => {
      const rows = listEl?.querySelectorAll('.todo-check');
      (rows?.[Math.min(idx, rows.length - 1)] || input)?.focus();
    });
  });
  return h('li', { class: 'todo-item' + (item.done ? ' done' : ''), 'data-id': item.id }, check, text, daily, edit, del);
}

function menu(btn, kb) {
  const doneCount = items().filter((t) => t.done && !t.daily).length;
  openMenu(
    btn,
    [
      { label: `Clear completed (${doneCount})`, icon: icon('trash', { size: 15 }), onSelect: () => commit(items().filter((t) => !t.done || t.daily)) },
      { label: 'Uncheck all', icon: icon('refresh', { size: 15 }), onSelect: () => commit(items().map((t) => ({ ...t, done: false }))) },
      { sep: true },
      ...(panelMode
        ? [
            { label: shortcutLabel ? `Close side panel (${shortcutLabel})` : 'Close side panel', icon: icon('close', { size: 15 }), onSelect: () => window.close() },
            { label: 'Change keyboard shortcut…', icon: icon('settings', { size: 15 }), onSelect: () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }) },
          ]
        : [
            { label: 'Open in side panel', icon: icon('sidebar', { size: 15 }), onSelect: openSidePanel },
            ...(box().custom ? [{ label: 'Reset size & position', icon: icon('refresh', { size: 15 }), onSelect: resetBox }] : []),
            { label: 'Hide to-do list', icon: icon('close', { size: 15 }), onSelect: () => updateSettings((s) => (s.widgets.visible.todo = false)).then(() => toast('To-do list hidden. Turn it back on in Settings → Widgets.')) },
          ]),
    ],
    { label: 'To-do options', focusFirst: kb },
  );
}

function updateCount() {
  const left = items().filter((t) => !t.done).length;
  countEl.textContent = items().length ? (left ? `${left} left` : 'All done ✓') : '';
}

function render() {
  if (!listEl || editingId) return;
  const focusedId = document.activeElement?.closest?.('.todo-item')?.dataset.id;
  const focusedCls = document.activeElement?.className;
  clear(listEl);
  if (!items().length) listEl.append(h('li', { class: 'todo-empty' }, 'Nothing planned yet. Add a task above.'));
  for (const it of items()) listEl.append(row(it));
  updateCount();
  if (focusedId) {
    const li = listEl.querySelector(`[data-id="${CSS.escape(focusedId)}"]`);
    const sel = typeof focusedCls === 'string' && focusedCls.includes('todo-daily') ? '.todo-daily' : '.todo-check';
    li?.querySelector(sel)?.focus();
  }
}

function applyCollapsed(toggleBtn, body) {
  el.classList.toggle('collapsed', collapsed);
  body.hidden = collapsed;
  toggleBtn.setAttribute('aria-expanded', String(!collapsed));
  toggleBtn.setAttribute('aria-label', collapsed ? 'Expand to-do list' : 'Collapse to-do list');
  clear(toggleBtn).append(icon(collapsed ? 'chevronDown' : 'chevronUp', { size: 14 }));
}

export function initTodo({ panel = false } = {}) {
  panelMode = panel;
  checkRollover();
  scheduleMidnight();
  countEl = h('span', { class: 'todo-count', 'aria-live': 'polite' });
  const toggleBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-controls': 'todo-body' });
  const more = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'To-do options', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon('more', { size: 14 }));
  more.addEventListener('click', (e) => menu(more, e.detail === 0));

  input = h('input', { class: 'todo-input', placeholder: 'Add a task…', maxlength: String(MAX_TODO_LENGTH), 'aria-label': 'New task', autocomplete: 'off' });
  let dailyNew = false;
  dailyBtn = h('button', { type: 'button', class: 'icon-btn todo-daily', 'aria-pressed': 'false', 'aria-label': 'New task repeats daily', title: 'Repeat daily' }, icon('repeat', { size: 14 }));
  dailyBtn.addEventListener('click', () => {
    dailyNew = !dailyNew;
    dailyBtn.setAttribute('aria-pressed', String(dailyNew));
    input.focus();
  });
  const form = h('form', { class: 'todo-form' }, input, dailyBtn);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (addTodo(input.value, dailyNew)) input.value = '';
  });
  listEl = h('ul', { class: 'todo-list', 'aria-label': 'Tasks' });
  const body = h('div', { id: 'todo-body', class: 'todo-body' }, form, listEl);
  const grip = h('button', { type: 'button', class: 'icon-btn todo-grip', 'aria-label': 'Move to-do list. Drag, or use the arrow keys.', title: 'Drag to move' }, icon('grip', { size: 14, filled: true }));
  const sideBtn = h('button', { type: 'button', class: 'icon-btn todo-side', 'aria-label': 'Open in side panel (stays open on every site)', title: 'Open in side panel' }, icon('sidebar', { size: 14 }));
  sideBtn.addEventListener('click', openSidePanel);
  const head = panel
    ? h('div', { class: 'todo-head' }, h('h2', { class: 'todo-title' }, icon('list', { size: 16 }), 'Today'), countEl, more)
    : h('div', { class: 'todo-head' }, grip, h('h2', { class: 'todo-title' }, icon('list', { size: 16 }), 'Today'), countEl, sideBtn, more, toggleBtn);
  const sizer = h('button', { type: 'button', class: 'todo-resize', 'aria-label': 'Resize to-do list. Drag, or use the arrow keys.', title: 'Drag to resize' });
  toggleBtn.addEventListener('click', () => {
    collapsed = !collapsed;
    try {
      localStorage.setItem('sequoia:todo-collapsed', collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
    applyCollapsed(toggleBtn, body);
    if (!collapsed) input.focus();
  });
  if (panel) {
    chrome.commands?.getAll?.().then((cmds) => (shortcutLabel = cmds.find((c) => c.name === '_execute_action')?.shortcut || ''), () => {});
    // Side panel: full height, no moving/resizing/collapsing (Chrome sizes it).
    clear(el).append(head, body);
    render();
    on('todos', render);
    input.focus();
  } else {
    el.classList.add('glass');
    clear(el).append(head, body, sizer);
    enableMoveResize(head, grip, sizer);
    applyCollapsed(toggleBtn, body);
    render();
    on('todos', render);
    window.addEventListener('resize', queueTodoLayout);
    const ro = new ResizeObserver(queueTodoLayout);
    for (const id of ['w-clock', 'w-search', 'w-shortcuts']) ro.observe(document.getElementById(id));
    layoutTodo();
    chrome.windows?.getCurrent?.().then((w) => (windowId = w.id), () => {});
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      checkRollover();
      scheduleMidnight();
    }
  });
}

// Float the card top-right only if the clock, search and tiles leave enough
// free room there; otherwise keep it in the page flow so it never covers them.
const CARD_WIDTH = 300;
const MIN_FLOAT_SPACE = 150;
let layoutQueued = false;

export function layoutTodo() {
  if (!el || el.hidden || panelMode) return;
  // The user placed it themselves: keep their spot (clamped to the window).
  if (box().custom && canPlace()) {
    applyBox(box());
    return;
  }
  el.classList.remove('placed');
  const root = document.documentElement;
  const dockIcon = parseFloat(getComputedStyle(root).getPropertyValue('--dock-icon')) || 48;
  const right = root.dataset.dock === 'right' ? dockIcon + 44 : 18;
  const topBarShown = !document.getElementById('bookmarks-bar').hidden || root.dataset.gbar === 'on';
  const top = topBarShown ? 62 : 18;
  const left = window.innerWidth - right - CARD_WIDTH;
  el.classList.add('floating'); // measure the other widgets with the card out of the flow
  if (left < 320) {
    el.classList.remove('floating');
    return;
  }
  let limit = window.innerHeight - (root.dataset.dock === 'bottom' ? dockIcon + 44 : 64);
  for (const node of document.querySelectorAll('#stage .clock-date, #stage .clock-time, #stage .search-form, #stage .tile')) {
    if (node.closest('[hidden]')) continue;
    const r = node.getBoundingClientRect();
    if (r.width && r.right > left - 16 && r.bottom > top) limit = Math.min(limit, r.top);
  }
  const space = Math.floor(limit - top - 14);
  if (space < MIN_FLOAT_SPACE) {
    el.classList.remove('floating');
    return;
  }
  el.style.setProperty('--todo-top', `${top}px`);
  el.style.setProperty('--todo-right', `${right}px`);
  el.style.setProperty('--todo-max', `${space}px`);
}

// ------------------------------------------------------------ side panel

// Open the list in Chrome's side panel, where it stays on every site.
export async function openSidePanel() {
  if (!chrome.sidePanel?.open) {
    // Files were updated but the extension wasn't reloaded yet, so the new
    // side panel permission isn't active: restart once, then reopen a tab.
    toast('Finishing the Sequoia Tab update…');
    await chrome.storage.local.set({ reopenAfterReload: Date.now() });
    chrome.runtime.reload();
    return;
  }
  try {
    // Called straight from the click, so Chrome sees the user gesture.
    await chrome.sidePanel.open(windowId != null ? { windowId } : { tabId: (await chrome.tabs.getCurrent()).id });
  } catch (err) {
    console.warn('[Sequoia Tab] could not open the side panel:', err?.message || err);
    toast('Click the Sequoia Tab toolbar button (or press Ctrl+Shift+Y) to open the side panel.', { error: true });
  }
}

// ------------------------------------------------------------ move & resize

const MIN_W = 240;
const MAX_W = 640;
const MIN_H = 140;
const EDGE = 8;
const box = () => store.settings.widgets.todoBox || { custom: false, x: 0, y: 0, w: 300, h: 0 };
const canPlace = () => window.innerWidth >= 600; // narrow windows keep the simple stacked layout
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

// Keep the card fully usable inside the window, whatever was saved.
function fit(b) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = clamp(Math.round(b.w) || 300, MIN_W, Math.min(MAX_W, vw - EDGE * 2));
  const h = b.h ? clamp(Math.round(b.h), MIN_H, vh - EDGE * 2) : 0;
  const x = clamp(Math.round(b.x), EDGE, vw - w - EDGE);
  const y = clamp(Math.round(b.y), EDGE, vh - (h || 120) - EDGE);
  return { custom: true, x, y, w, h };
}

function applyBox(b) {
  const f = fit(b);
  el.classList.add('floating', 'placed');
  el.style.setProperty('--todo-x', `${f.x}px`);
  el.style.setProperty('--todo-y', `${f.y}px`);
  el.style.setProperty('--todo-w', `${f.w}px`);
  el.style.setProperty('--todo-h', f.h ? `${f.h}px` : 'auto');
  el.style.setProperty('--todo-max', `${window.innerHeight - f.y - EDGE}px`);
  return f;
}

function saveBox(b, { immediate = true } = {}) {
  const f = fit(b);
  return updateSettings((s) => (s.widgets.todoBox = f), { immediate });
}

function resetBox() {
  updateSettings((s) => (s.widgets.todoBox = { custom: false, x: 0, y: 0, w: 300, h: 0 }), { immediate: true }).then(() => {
    layoutTodo();
    toast('To-do list moved back to its automatic spot.');
  });
}

// Current on-screen box, used as the starting point of a drag.
function currentBox() {
  const r = el.getBoundingClientRect();
  const b = box();
  return { custom: true, x: r.left, y: r.top, w: r.width, h: b.custom ? b.h : 0 };
}

function enableMoveResize(head, grip, sizer) {
  let drag = null; // { mode, startX, startY, start, moved, id }

  const begin = (e, mode) => {
    if (e.button !== 0 || !canPlace()) return;
    // Pointer capture starts only once it's really a drag, so plain clicks and
    // double-clicks still reach the header's buttons.
    drag = { mode, startX: e.clientX, startY: e.clientY, start: currentBox(), moved: false, id: e.pointerId, target: e.currentTarget };
    // Follow the pointer anywhere on the page until it's released.
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    if (mode === 'resize') e.preventDefault();
  };
  const move = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return; // a click, not a drag
    if (!drag.moved) {
      drag.moved = true;
      drag.target.setPointerCapture(e.pointerId);
      el.classList.add(drag.mode === 'move' ? 'moving' : 'resizing');
      if (drag.mode === 'resize' && !drag.start.h) drag.start.h = el.getBoundingClientRect().height;
    }
    e.preventDefault();
    const s = drag.start;
    drag.now = drag.mode === 'move' ? { ...s, x: s.x + dx, y: s.y + dy } : { ...s, w: s.w + dx, h: s.h + dy };
    drag.now = applyBox(drag.now);
  };
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    el.classList.remove('moving', 'resizing');
    if (d.target.hasPointerCapture?.(e.pointerId)) d.target.releasePointerCapture(e.pointerId);
    if (d.moved && d.now) saveBox(d.now);
  };

  // Drag by the header (but not by its buttons), or by the grip.
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') && !e.target.closest('.todo-grip')) return;
    begin(e, 'move');
  });
  sizer.addEventListener('pointerdown', (e) => begin(e, 'resize'));

  // Keyboard: arrows move (grip) or resize (corner); Shift = bigger steps.
  const nudge = (e, mode) => {
    const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!k || !canPlace()) return;
    e.preventDefault();
    const step = e.shiftKey ? 50 : 10;
    const s = currentBox();
    if (mode === 'resize' && !s.h) s.h = el.getBoundingClientRect().height;
    const next = mode === 'move' ? { ...s, x: s.x + k[0] * step, y: s.y + k[1] * step } : { ...s, w: s.w + k[0] * step, h: s.h + k[1] * step };
    applyBox(next);
    saveBox(next, { immediate: false });
  };
  grip.addEventListener('keydown', (e) => nudge(e, 'move'));
  sizer.addEventListener('keydown', (e) => nudge(e, 'resize'));
  // Double-click the grip to return to the automatic spot.
  grip.addEventListener('dblclick', () => box().custom && resetBox());
}

export function queueTodoLayout() {
  if (layoutQueued) return;
  layoutQueued = true;
  requestAnimationFrame(() => {
    layoutQueued = false;
    layoutTodo();
  });
}

export function focusTodoInput() {
  if (el.hidden) return false;
  if (collapsed) el.querySelector('.todo-head [aria-controls]')?.click();
  input?.focus();
  return true;
}

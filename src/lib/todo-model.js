// To-do data helpers. Items: { id, text, done, daily, createdAt }.
// "Daily" items are routine tasks that un-tick themselves every new day.

import { uid } from './defaults.js';

export const MAX_TODOS = 100;
export const MAX_TODO_LENGTH = 300;

export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Returns a new object if the day changed (daily items reset), else null.
export function rollover(todos, today = dayKey()) {
  if (todos.day === today) return null;
  return {
    day: today,
    items: todos.items.map((t) => (t.daily && t.done ? { ...t, done: false } : t)),
  };
}

export function newTodo(text, daily = false) {
  return { id: uid('td'), text: String(text).trim().slice(0, MAX_TODO_LENGTH), done: false, daily: !!daily, createdAt: Date.now() };
}

export function sanitizeTodos(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) return null;
  const seen = new Set();
  const items = [];
  for (const t of raw.items.slice(0, MAX_TODOS)) {
    if (!t || typeof t.text !== 'string' || !t.text.trim()) continue;
    const id = typeof t.id === 'string' && /^[\w-]{1,64}$/.test(t.id) && !seen.has(t.id) ? t.id : uid('td');
    seen.add(id);
    items.push({ id, text: t.text.trim().slice(0, MAX_TODO_LENGTH), done: !!t.done, daily: !!t.daily, createdAt: Number(t.createdAt) || Date.now() });
  }
  return { items, day: typeof raw.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.day) ? raw.day : dayKey() };
}

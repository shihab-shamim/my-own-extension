// Clock & date widget. Ticks once per minute (or second) aligned to the
// wall clock, and pauses while the tab is hidden.

import { h, clear } from './dom.js';

const el = document.getElementById('w-clock');
let timer = null;
let cfg = null;

const DATE_FORMATS = {
  long: { weekday: 'long', month: 'long', day: 'numeric' },
  short: { weekday: 'short', month: 'short', day: 'numeric' },
  numeric: { year: 'numeric', month: '2-digit', day: '2-digit' },
};

function formatDate(d, fmt) {
  if (fmt === 'none') return '';
  if (fmt === 'iso') {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  return new Intl.DateTimeFormat(undefined, DATE_FORMATS[fmt] || DATE_FORMATS.long).format(d);
}

function render() {
  if (!cfg) return;
  const d = new Date();
  const h24 = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  let hours;
  let ampm = null;
  if (cfg.format === '24') {
    hours = String(h24).padStart(2, '0');
  } else {
    hours = String(h24 % 12 || 12);
    ampm = h24 < 12 ? 'AM' : 'PM';
  }
  const dateText = formatDate(d, cfg.dateFormat);
  const time = h(
    'p',
    { class: 'clock-time' },
    h('time', { datetime: d.toISOString() }, `${hours}:${mm}`),
    cfg.showSeconds ? h('span', { class: 'secs' }, `:${ss}`) : null,
    ampm ? h('span', { class: 'ampm' }, ampm) : null,
  );
  clear(el).append(dateText ? h('p', { class: 'clock-date' }, dateText) : '', time);
  el.setAttribute('aria-label', `${dateText ? dateText + ', ' : ''}${hours}:${mm}${ampm ? ' ' + ampm : ''}`);
}

function schedule() {
  clearTimeout(timer);
  if (!cfg || document.hidden) return;
  const now = Date.now();
  const step = cfg.showSeconds ? 1000 : 60_000;
  timer = setTimeout(() => {
    render();
    schedule();
  }, step - (now % step) + 15);
}

export function initClock(settings) {
  updateClock(settings);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) render();
    schedule();
  });
}

export function updateClock(settings) {
  cfg = settings.clock;
  render();
  schedule();
}

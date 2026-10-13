// Small shared UI pieces: toasts, confirm dialogs, form controls.

import { h } from './dom.js';

export function toast(message, { error = false, timeout = 4200 } = {}) {
  const host = document.getElementById('toasts');
  if (!host) return;
  // Avoid stacking identical messages.
  for (const t of host.children) if (t.textContent === message) t.remove();
  const el = h('div', { class: 'toast glass' + (error ? ' error' : '') }, message);
  host.append(el);
  setTimeout(() => el.remove(), timeout);
}

// Create a modal <dialog>, which gives us a focus trap, Escape-to-close and
// an inert background for free.
export function modal(className, content, { onClose, label } = {}) {
  const dlg = h('dialog', { class: className, 'aria-label': label || null }, content);
  dlg.addEventListener('close', () => {
    onClose?.(dlg.returnValue);
    dlg.remove();
  });
  // Clicking the backdrop closes the dialog.
  dlg.addEventListener('mousedown', (e) => {
    if (e.target === dlg) dlg.close('cancel');
  });
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

export function confirmDialog({ title, message, confirmLabel = 'OK', danger = false }) {
  return new Promise((resolve) => {
    const ok = h('button', { type: 'button', class: 'btn primary', style: danger ? { background: 'var(--danger)' } : null }, confirmLabel);
    const cancel = h('button', { type: 'button', class: 'btn' }, 'Cancel');
    const dlg = modal(
      'form-dialog',
      h('div', { class: 'sheet' }, h('h2', {}, title), h('p', { class: 'note', style: { fontSize: '13px' } }, message), h('div', { class: 'form-actions' }, cancel, ok)),
      { onClose: (v) => resolve(v === 'ok'), label: title },
    );
    cancel.addEventListener('click', () => dlg.close('cancel'));
    ok.addEventListener('click', () => dlg.close('ok'));
    cancel.focus();
  });
}

// --- form controls used by the settings panel ---

let ctrlId = 0;
export function nextId(prefix = 'c') {
  ctrlId += 1;
  return `${prefix}-${ctrlId}`;
}

export function toggle(checked, onChange, label) {
  const input = h('input', { type: 'checkbox', role: 'switch', checked: !!checked, 'aria-label': label });
  input.addEventListener('change', () => onChange(input.checked));
  return h('span', { class: 'switch' }, input, h('span', { class: 'track', 'aria-hidden': 'true' }));
}

export function segmented(options, value, onChange, label) {
  const group = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label });
  const buttons = options.map((o) =>
    h('button', { type: 'button', role: 'radio', 'aria-checked': String(o.id === value), tabindex: o.id === value ? '0' : '-1', 'data-id': o.id }, o.label),
  );
  const select = (btn, focus) => {
    for (const b of buttons) {
      const on = b === btn;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    if (focus) btn.focus();
    onChange(btn.dataset.id);
  };
  buttons.forEach((b, i) => {
    b.addEventListener('click', () => select(b, false));
    b.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      select(buttons[(i + d + buttons.length) % buttons.length], true);
    });
  });
  if (!buttons.some((b) => b.tabIndex === 0) && buttons[0]) buttons[0].tabIndex = 0;
  group.append(...buttons);
  return group;
}

export function selectBox(options, value, onChange, label) {
  const sel = h('select', { class: 'field', 'aria-label': label });
  for (const o of options) sel.append(h('option', { value: o.id, selected: o.id === value }, o.label));
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

export function range({ min, max, step = 1, value, unit = '', onInput, label }) {
  const out = h('span', { class: 'range-val', 'aria-hidden': 'true' }, `${value}${unit}`);
  const input = h('input', { type: 'range', min, max, step, 'aria-label': label });
  input.value = String(value);
  input.addEventListener('input', () => {
    out.textContent = `${input.value}${unit}`;
    onInput(Number(input.value));
  });
  return h('span', { class: 'row-controls' }, input, out);
}

export function row(labelText, control, hint) {
  return h(
    'div',
    { class: 'row' },
    h('div', { class: 'row-label' }, labelText, hint ? h('span', { class: 'hint' }, hint) : null),
    control,
  );
}

export function group(title, ...rows) {
  return h('div', {}, title ? h('div', { class: 'group-title' }, title) : null, h('div', { class: 'group' }, rows));
}

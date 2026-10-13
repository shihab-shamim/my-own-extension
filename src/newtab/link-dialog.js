// Add/edit dialogs for links (shortcuts, folder items, dock) and names.

import { h } from './dom.js';
import { normalizeUrl, hostOf } from '../lib/url.js';
import { validIconUrl } from './site-icon.js';
import { modal } from './ui.js';

export function editLinkDialog({ title, item, onSave, allowChrome = true }) {
  const nameIn = h('input', { class: 'field', id: 'ld-name', maxlength: '80', required: true, autocomplete: 'off' });
  const urlIn = h('input', { class: 'field', id: 'ld-url', maxlength: '2048', required: true, autocomplete: 'off', inputmode: 'url', placeholder: 'example.com' });
  const iconIn = h('input', { class: 'field', id: 'ld-icon', maxlength: '2048', autocomplete: 'off', placeholder: 'https://… (optional)' });
  nameIn.value = item?.title || '';
  urlIn.value = item?.url || '';
  iconIn.value = item?.icon || '';
  const err = h('p', { class: 'form-error', role: 'alert' });
  const cancel = h('button', { type: 'button', class: 'btn' }, 'Cancel');
  const save = h('button', { type: 'submit', class: 'btn primary' }, item ? 'Save' : 'Add');
  const form = h(
    'form',
    { class: 'sheet', novalidate: true },
    h('h2', {}, title),
    h('div', { class: 'form-row' }, h('label', { for: 'ld-name' }, 'Name'), nameIn),
    h('div', { class: 'form-row' }, h('label', { for: 'ld-url' }, 'URL'), urlIn),
    h('div', { class: 'form-row' }, h('label', { for: 'ld-icon' }, 'Custom icon URL'), iconIn),
    err,
    h('div', { class: 'form-actions' }, cancel, save),
  );
  const dlg = modal('form-dialog', form, { label: title });
  cancel.addEventListener('click', () => dlg.close('cancel'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = normalizeUrl(urlIn.value);
    if (!url || (!allowChrome && !/^https?:/i.test(url))) {
      err.textContent = 'Enter a valid web address (http or https).';
      urlIn.focus();
      return;
    }
    const iconUrl = validIconUrl(iconIn.value.trim());
    if (iconUrl === null) {
      err.textContent = 'The icon URL must start with https://';
      iconIn.focus();
      return;
    }
    const name = nameIn.value.trim().slice(0, 80) || hostOf(url) || url;
    const data = { ...(item || {}), title: name, url };
    if (iconUrl) data.icon = iconUrl;
    else delete data.icon;
    onSave(data);
    dlg.close('ok');
  });
  (item ? nameIn : urlIn).focus();
  if (!item) {
    // Suggest a name from the domain; it is selected on focus so typing replaces it.
    let suggested = false;
    urlIn.addEventListener('blur', () => {
      if (!nameIn.value.trim() || suggested) {
        const u = normalizeUrl(urlIn.value);
        const name = u ? hostOf(u).split('.').slice(-2, -1)[0]?.replace(/^./, (c) => c.toUpperCase()) || '' : '';
        nameIn.value = name;
        suggested = !!name;
      }
    });
    nameIn.addEventListener('focus', () => suggested && nameIn.select());
    nameIn.addEventListener('input', () => (suggested = false));
  }
  return dlg;
}

// Single text field dialog (folder names).
export function nameDialog({ title, label = 'Name', value = '', confirmLabel = 'Save', onSave }) {
  const input = h('input', { class: 'field', id: 'nd-name', maxlength: '60', autocomplete: 'off', required: true });
  input.value = value;
  const err = h('p', { class: 'form-error', role: 'alert' });
  const cancel = h('button', { type: 'button', class: 'btn' }, 'Cancel');
  const form = h(
    'form',
    { class: 'sheet', novalidate: true },
    h('h2', {}, title),
    h('div', { class: 'form-row' }, h('label', { for: 'nd-name' }, label), input),
    err,
    h('div', { class: 'form-actions' }, cancel, h('button', { type: 'submit', class: 'btn primary' }, confirmLabel)),
  );
  const dlg = modal('form-dialog', form, { label: title });
  cancel.addEventListener('click', () => dlg.close('cancel'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) {
      err.textContent = 'Enter a name.';
      input.focus();
      return;
    }
    onSave(v.slice(0, 60));
    dlg.close('ok');
  });
  input.focus();
  input.select();
  return dlg;
}

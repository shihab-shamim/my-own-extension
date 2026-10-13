// Top-right "Google bar" like Chrome's own New Tab: Gmail, Images, a Google
// apps launcher and an account button. With the optional "Connect Google
// account" (see gaccount.js) the button shows your real photo, name and email;
// otherwise it shows a photo you uploaded, or a generic icon.

import { h, clear } from './dom.js';
import { icon } from '../lib/icons.js';
import { store, updateSettings } from './store.js';
import { siteIcon } from './site-icon.js';
import { toast } from './ui.js';
import * as GA from './gaccount.js';

const el = document.createElement('nav');
el.id = 'gbar';
el.className = 'gbar';
el.setAttribute('aria-label', 'Google');

export const PHOTO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_PHOTO_CHARS = 200_000;

const authuser = () => Math.max(0, Math.min(9, Math.trunc(Number(store.settings.google?.authuser) || 0)));

function withUser(url, n = authuser()) {
  const u = new URL(url);
  if (n > 0) u.searchParams.set('authuser', String(n));
  return u.toString();
}

export function gmailUrl(n = authuser()) {
  return `https://mail.google.com/mail/u/${n}/`;
}

export function googleApps() {
  return [
    { title: 'Account', url: withUser('https://myaccount.google.com/') },
    { title: 'Search', url: withUser('https://www.google.com/') },
    { title: 'Maps', url: withUser('https://maps.google.com/') },
    { title: 'YouTube', url: 'https://www.youtube.com/' },
    { title: 'Play', url: withUser('https://play.google.com/') },
    { title: 'News', url: withUser('https://news.google.com/') },
    { title: 'Gmail', url: gmailUrl() },
    { title: 'Meet', url: withUser('https://meet.google.com/') },
    { title: 'Chat', url: withUser('https://chat.google.com/') },
    { title: 'Contacts', url: withUser('https://contacts.google.com/') },
    { title: 'Drive', url: withUser('https://drive.google.com/') },
    { title: 'Calendar', url: withUser('https://calendar.google.com/') },
    { title: 'Translate', url: 'https://translate.google.com/' },
    { title: 'Photos', url: withUser('https://photos.google.com/') },
    { title: 'Docs', url: withUser('https://docs.google.com/document/') },
    { title: 'Sheets', url: withUser('https://docs.google.com/spreadsheets/') },
    { title: 'Slides', url: withUser('https://docs.google.com/presentation/') },
    { title: 'Keep', url: withUser('https://keep.google.com/') },
    { title: 'Gemini', url: withUser('https://gemini.google.com/') },
    { title: 'Forms', url: withUser('https://docs.google.com/forms/') },
    { title: 'Sites', url: withUser('https://sites.google.com/') },
  ];
}

// ------------------------------------------------------------ popovers

let pop = null; // { panel, btn }

function closePop(focusBtn = false) {
  if (!pop) return;
  const { panel, btn } = pop;
  pop = null;
  panel.remove();
  btn.setAttribute('aria-expanded', 'false');
  document.removeEventListener('pointerdown', onOutside, true);
  document.removeEventListener('keydown', onDocKey, true);
  window.removeEventListener('resize', onWinChange);
  window.removeEventListener('blur', onWinChange);
  if (focusBtn) btn.focus();
}
const onWinChange = () => closePop();
// Esc closes the popover wherever focus is (e.g. after opening it with the mouse).
function onDocKey(e) {
  if (e.key === 'Escape' && pop) {
    e.preventDefault();
    e.stopPropagation();
    closePop(true);
  }
}

function onOutside(e) {
  if (pop && !pop.panel.contains(e.target) && !pop.btn.contains(e.target)) closePop();
}

function focusables(panel) {
  return [...panel.querySelectorAll('a[href], button:not([disabled])')];
}

function openPop(btn, className, label, build, { viaKeyboard = false, gridCols = 0 } = {}) {
  const same = pop?.btn === btn;
  closePop();
  if (same) return null;
  const panel = h('div', { class: `gpop ${className}`, role: 'dialog', 'aria-label': label, tabindex: '-1' });
  build(panel);
  panel.addEventListener('keydown', (e) => {
    const items = focusables(panel);
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closePop(true);
      return;
    }
    if (gridCols) {
      const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: gridCols, ArrowUp: -gridCols }[e.key];
      if (step && i >= 0) {
        e.preventDefault();
        items[Math.max(0, Math.min(items.length - 1, i + step))].focus();
        return;
      }
    }
    if (e.key === 'Tab' && ((e.shiftKey && i === 0) || (!e.shiftKey && i === items.length - 1))) closePop();
  });
  document.body.append(panel);
  const r = btn.getBoundingClientRect();
  panel.style.top = `${Math.round(r.bottom + 8)}px`;
  panel.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right - 8))}px`;
  btn.setAttribute('aria-expanded', 'true');
  pop = { panel, btn };
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onDocKey, true);
  window.addEventListener('resize', onWinChange);
  window.addEventListener('blur', onWinChange);
  if (viaKeyboard) focusables(panel)[0]?.focus();
  else panel.focus({ preventScroll: true });
  return panel;
}

function buildApps(panel) {
  const grid = h('ul', { class: 'gapps-grid', role: 'list' });
  for (const app of googleApps()) {
    const a = h('a', { class: 'gapp', href: app.url, title: app.title }, h('span', { class: 'gapp-icon' }, siteIcon(app, 64)), h('span', { class: 'gapp-label' }, app.title));
    a.addEventListener('click', (e) => {
      if (!(e.ctrlKey || e.metaKey || e.shiftKey)) closePop();
    });
    grid.append(h('li', {}, a));
  }
  panel.append(grid);
}

// ------------------------------------------------------------ account

let acct = { connected: false, accounts: [], error: '', loading: false, needsReload: false, detail: '' };
let openSettingsFn = () => {};

const currentAccount = () => acct.accounts.find((a) => a.index === authuser()) || null;

function uploadedPhoto() {
  const photo = store.settings.google?.photo;
  return typeof photo === 'string' && photo.length < MAX_PHOTO_CHARS && PHOTO_RE.test(photo) ? photo : '';
}

// Real Google photo when connected, else the uploaded one, else an icon.
function face(size, account = acct.connected ? currentAccount() : null, cls = 'gavatar-img') {
  const real = account ? GA.photoAt(account.photo, size * 2) : '';
  const src = real || (!account || account.index === authuser() ? uploadedPhoto() : '');
  if (src) {
    const img = h('img', { class: cls, src, alt: '', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => img.replaceWith(initialFace(account, cls)), { once: true });
    return img;
  }
  return initialFace(account, cls);
}

function initialFace(account, cls) {
  const letter = (account?.name || account?.email || '').trim()[0];
  if (letter) return h('span', { class: `${cls} gavatar-letter`, 'aria-hidden': 'true' }, letter.toUpperCase());
  return h('span', { class: 'gavatar-default', 'aria-hidden': 'true' }, icon('person', { size: 18 }));
}

function linkBtn(text, href, cls = 'gacct-btn') {
  const a = h('a', { class: cls, href }, text);
  a.addEventListener('click', (e) => {
    if (!(e.ctrlKey || e.metaKey || e.shiftKey)) closePop();
  });
  return a;
}

function switchTo(account) {
  updateSettings((s) => (s.google.authuser = account.index), { immediate: true }).then(() => {
    toast(`Google links now open ${account.email}.`);
  });
  closePop(true);
}

// Google's multicolour "G" (static, trusted markup).
function googleG() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML =
    '<path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8a10 10 0 0 1-4.4 6.6v5.5h7.1c4.2-3.8 6.6-9.5 6.6-16.1z"/>' +
    '<path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.6-3.9-12.3-9.1H4.4v5.7A22 22 0 0 0 24 46z"/>' +
    '<path fill="#FBBC05" d="M11.7 28.2a13.2 13.2 0 0 1 0-8.4v-5.7H4.4a22 22 0 0 0 0 19.8z"/>' +
    '<path fill="#EA4335" d="M24 10.7c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3A22 22 0 0 0 4.4 14.1l7.3 5.7C13.4 14.6 18.3 10.7 24 10.7z"/>';
  return svg;
}

let listOpen = true;

function rowLink(text, href, iconNode) {
  const a = h('a', { class: 'gacct-row', href }, h('span', { class: 'gacct-small gacct-ico' }, iconNode), h('span', { class: 'gacct-who' }, h('span', { class: 'gacct-name' }, text)));
  a.addEventListener('click', (e) => {
    if (!(e.ctrlKey || e.metaKey || e.shiftKey)) closePop();
  });
  return h('li', {}, a);
}

function manageLink() {
  const a = h('a', { class: 'gacct-manage', href: withUser('https://myaccount.google.com/') }, googleG(), h('span', {}, 'Manage your Google Account'));
  a.addEventListener('click', (e) => {
    if (!(e.ctrlKey || e.metaKey || e.shiftKey)) closePop();
  });
  return a;
}

function disconnectLink() {
  const disc = h('button', { type: 'button', class: 'gacct-link' }, 'Disconnect from Sequoia Tab');
  disc.addEventListener('click', async () => {
    await GA.disconnect();
    await loadAccounts();
    toast('Google account disconnected. Its info was removed from this computer.');
    closePop(true);
  });
  return disc;
}

// Header block: big photo + title + subtitle (+ optional collapse toggle).
function head(account, title, subtitle, toggle = null) {
  return h(
    'div',
    { class: 'gacct-head' },
    h('span', { class: 'gacct-big' }, face(36, account, 'gacct-big-img')),
    h('div', { class: 'gacct-id' }, h('div', { class: 'gacct-title' }, title), subtitle ? h('div', { class: 'gacct-email' }, subtitle) : null),
    toggle,
  );
}

function buildAccount(panel) {
  const close = h('button', { type: 'button', class: 'icon-btn gacct-close', 'aria-label': 'Close' }, icon('close', { size: 18 }));
  close.addEventListener('click', () => closePop(true));
  panel.append(close);
  const me = acct.connected ? currentAccount() : null;

  if (acct.connected && me) {
    const others = acct.accounts.filter((a) => a.index !== me.index);
    const list = h('ul', { class: 'gacct-list', id: 'gacct-list', 'aria-label': 'Accounts' });
    for (const a of others) {
      const row = h(
        'button',
        { type: 'button', class: 'gacct-row', title: `Open Google links with ${a.email}` },
        h('span', { class: 'gacct-small' }, face(16, a, 'gacct-small-img')),
        h('span', { class: 'gacct-who' }, h('span', { class: 'gacct-name' }, a.name || a.email), a.name ? h('span', { class: 'gacct-mail' }, a.email) : null),
      );
      row.addEventListener('click', () => switchTo(a));
      list.append(h('li', {}, row));
    }
    list.append(rowLink('Add another account', 'https://accounts.google.com/AddSession', icon('plus', { size: 18 })));
    list.append(rowLink('Sign out of all accounts', 'https://accounts.google.com/Logout', icon('logout', { size: 18 })));
    list.hidden = !listOpen;
    const toggle = h('button', { type: 'button', class: 'gacct-toggle', 'aria-controls': 'gacct-list', 'aria-expanded': String(listOpen), 'aria-label': listOpen ? 'Hide more accounts' : 'Show more accounts' }, icon(listOpen ? 'chevronUp' : 'chevronDown', { size: 18 }));
    toggle.addEventListener('click', () => {
      listOpen = !listOpen;
      list.hidden = !listOpen;
      toggle.setAttribute('aria-expanded', String(listOpen));
      toggle.setAttribute('aria-label', listOpen ? 'Hide more accounts' : 'Show more accounts');
      clear(toggle).append(icon(listOpen ? 'chevronUp' : 'chevronDown', { size: 18 }));
    });
    panel.append(h('div', { class: 'gacct-card' }, head(me, me.name || me.email, me.name ? me.email : '', toggle), list), manageLink());
    if (acct.error) panel.append(h('p', { class: 'gacct-note' }, acct.error));
    panel.append(h('div', { class: 'gacct-foot' }, disconnectLink()));
    return;
  }

  if (acct.connected && acct.loading) {
    panel.append(h('div', { class: 'gacct-card', 'aria-busy': 'true' }, head(null, 'Loading your Google account…', '')));
    return;
  }

  if (acct.connected) {
    // Connected, but Google couldn't be reached / needs a reload, or nobody is signed in.
    const card = h('div', { class: 'gacct-card' }, head(null, acct.error || 'You’re not signed in to Google', acct.error ? '' : 'Sign in to see your account here.'));
    const list = h('ul', { class: 'gacct-list' });
    list.append(rowLink(acct.error ? 'Sign in to Google' : 'Sign in', 'https://accounts.google.com/ServiceLogin', icon('person', { size: 18 })));
    card.append(list);
    panel.append(card);
    if (acct.needsReload) {
      // One click: reload the extension (which applies the updated permissions)
      // and the service worker reopens a New Tab afterwards.
      const finish = h('button', { type: 'button', class: 'gacct-btn gacct-primary' }, 'Finish update');
      finish.addEventListener('click', async () => {
        finish.disabled = true;
        finish.textContent = 'Updating…';
        await chrome.storage.local.set({ reopenAfterReload: Date.now() });
        chrome.runtime.reload();
      });
      panel.append(finish, h('p', { class: 'gacct-note' }, 'Sequoia Tab will restart and open a new tab — about a second.'));
    } else if (acct.error) {
      const retry = h('button', { type: 'button', class: 'gacct-btn gacct-primary' }, 'Try again');
      retry.addEventListener('click', async () => {
        retry.disabled = true;
        await GA.refreshAccounts({ force: true });
        await loadAccounts();
      });
      panel.append(retry);
      if (acct.detail) panel.append(h('p', { class: 'gacct-note gacct-detail' }, `Details: ${acct.detail}`));
    }
    panel.append(h('div', { class: 'gacct-foot' }, disconnectLink()));
    return;
  }

  // Not connected: offer the opt-in, plus the plain links.
  const connectBtn = h('button', { type: 'button', class: 'gacct-btn gacct-primary' }, 'Connect Google account');
  connectBtn.addEventListener('click', async () => {
    connectBtn.disabled = true;
    const ok = await GA.connect();
    await loadAccounts();
    if (ok) {
      const me2 = currentAccount();
      toast(me2 ? `Connected as ${me2.email}.` : 'Connected.');
      closePop();
      openAccount(false, false); // connect() just fetched; no second request
    } else {
      connectBtn.disabled = false;
      toast('Not connected — Chrome’s permission was not granted.', { error: true });
    }
  });
  const upload = h('button', { type: 'button', class: 'gacct-link' }, uploadedPhoto() ? 'Change uploaded photo' : 'Upload a photo instead');
  upload.addEventListener('click', () => {
    closePop();
    openSettingsFn('widgets');
  });
  panel.append(
    h(
      'div',
      { class: 'gacct-card' },
      head(null, 'Google account', ''),
      h('p', { class: 'gacct-explain' }, 'Show your Google photo, name and email here, like Chrome does. Chrome will ask once for permission to read your signed-in accounts from accounts.google.com. Nothing leaves this computer.'),
      connectBtn,
    ),
    manageLink(),
    h('div', { class: 'gacct-foot' }, linkBtn('Switch account', 'https://accounts.google.com/AccountChooser', 'gacct-link'), upload),
  );
}

function openAccount(viaKeyboard, refresh = true) {
  const btn = el.querySelector('.gavatar');
  if (!btn) return;
  openPop(btn, 'gacct-panel', 'Google account', buildAccount, { viaKeyboard });
  // Refresh in the background; the card re-renders if anything changed.
  if (refresh && acct.connected) GA.refreshAccounts({ force: true });
}

async function loadAccounts() {
  const [connected, cache] = await Promise.all([GA.isConnected(), GA.readCache()]);
  // "loading": connected but Google hasn't answered yet (first fetch).
  acct = {
    connected,
    accounts: connected ? cache.accounts : [],
    error: connected ? cache.error : '',
    loading: connected && !cache.at && !cache.error,
    needsReload: connected && cache.needsReload,
    detail: connected ? cache.detail : '',
  };
  renderAvatar();
  if (pop?.panel.classList.contains('gacct-panel')) {
    const focused = document.activeElement && pop.panel.contains(document.activeElement);
    clear(pop.panel);
    buildAccount(pop.panel);
    if (focused) focusables(pop.panel)[0]?.focus();
  }
}

export async function connectFromSettings() {
  const ok = await GA.connect();
  await loadAccounts();
  return ok;
}

export async function disconnectFromSettings() {
  await GA.disconnect();
  await loadAccounts();
}

export function accountStatus() {
  return { ...acct, current: currentAccount() };
}

// ------------------------------------------------------------ render

let avatarBtn = null;

function renderAvatar() {
  if (!avatarBtn) return;
  const me = acct.connected ? currentAccount() : null;
  clear(avatarBtn).append(face(19));
  const label = me ? `Google Account: ${me.name ? me.name + ' ' : ''}(${me.email})` : 'Google account';
  avatarBtn.setAttribute('aria-label', label);
  avatarBtn.title = label;
}

export function initGbar(openSettings) {
  openSettingsFn = openSettings;
  document.body.append(el);
  // Tell the bookmarks bar how much room to leave on the right.
  new ResizeObserver(() => document.documentElement.style.setProperty('--gbar-w', `${Math.ceil(el.offsetWidth)}px`)).observe(el);
  renderGbar();
  GA.onAccountsChanged(() => loadAccounts());
  loadAccounts().then(() => acct.connected && GA.refreshAccounts());
}

export function renderGbar() {
  const visible = !!store.settings.widgets.visible.gbar;
  el.hidden = !visible;
  document.documentElement.dataset.gbar = visible ? 'on' : 'off';
  closePop();
  if (!visible) return;
  const gmail = h('a', { class: 'gbar-link', href: gmailUrl() }, 'Gmail');
  const images = h('a', { class: 'gbar-link', href: withUser('https://www.google.com/imghp') }, 'Images');
  const appsBtn = h('button', { type: 'button', class: 'gbar-btn', 'aria-label': 'Google apps', title: 'Google apps', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, icon('apps', { size: 20, filled: true }));
  appsBtn.addEventListener('click', (e) => openPop(appsBtn, 'gapps-panel', 'Google apps', buildApps, { viaKeyboard: e.detail === 0, gridCols: 3 }));
  avatarBtn = h('button', { type: 'button', class: 'gavatar', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' });
  avatarBtn.addEventListener('click', (e) => openAccount(e.detail === 0));
  renderAvatar();
  clear(el).append(gmail, images, appsBtn, avatarBtn);
}

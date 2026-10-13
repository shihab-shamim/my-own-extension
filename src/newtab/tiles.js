// Link tiles shared by the shortcuts grid and the folder view, plus the
// "open all" launcher.

import { h } from './dom.js';
import { needsTabsApi, openUrl } from '../lib/url.js';
import { siteIcon } from './site-icon.js';
import { toast, confirmDialog } from './ui.js';

// Real <a> so middle-click, Ctrl-click and the context menu keep working;
// chrome:// URLs go through the tabs API because links can't open them.
export function linkAnchor(item) {
  const a = h(
    'a',
    { class: 'tile-link', href: item.url, draggable: 'true', title: `${item.title}\n${item.url}` },
    h('span', { class: 'tile-icon glass' }, siteIcon(item)),
    h('span', { class: 'tile-label' }, item.title),
  );
  a.addEventListener('click', (e) => {
    if (needsTabsApi(item.url)) {
      e.preventDefault();
      const newTab = e.ctrlKey || e.metaKey || e.shiftKey;
      openUrl(item.url, { newTab, background: newTab && !e.shiftKey });
    }
  });
  a.addEventListener('auxclick', (e) => {
    if (e.button === 1 && needsTabsApi(item.url)) {
      e.preventDefault();
      openUrl(item.url, { newTab: true, background: true });
    }
  });
  return a;
}

// Drag & drop reordering for a list of tiles. When `onInto` is given,
// dropping on the middle of a tile means "put it inside" (folders).
let drag = null; // { id, isFolder, scope }

function clearMarks(root) {
  for (const t of root.querySelectorAll('.drop-before, .drop-after, .drop-into')) t.classList.remove('drop-before', 'drop-after', 'drop-into');
}

export function enableDrag(li, item, { scope, url, isFolder = false, canReceive = false, onReorder, onInto }) {
  li.addEventListener('dragstart', (e) => {
    drag = { id: item.id, isFolder, scope };
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    if (url) {
      e.dataTransfer.setData('text/uri-list', url);
      e.dataTransfer.setData('text/plain', url);
    } else {
      e.dataTransfer.setData('text/plain', item.title || '');
    }
  });
  li.addEventListener('dragend', () => {
    drag = null;
    li.classList.remove('dragging');
    clearMarks(li.parentElement || document);
  });
  li.addEventListener('dragover', (e) => {
    if (!drag || drag.scope !== scope || drag.id === item.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const r = li.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    clearMarks(li.parentElement);
    if (onInto && canReceive && !drag.isFolder && x > 0.25 && x < 0.75) li.classList.add('drop-into');
    else li.classList.add(x > 0.5 ? 'drop-after' : 'drop-before');
  });
  li.addEventListener('dragleave', (e) => {
    if (!li.contains(e.relatedTarget)) li.classList.remove('drop-before', 'drop-after', 'drop-into');
  });
  li.addEventListener('drop', (e) => {
    if (!drag || drag.scope !== scope || drag.id === item.id) return;
    e.preventDefault();
    const into = li.classList.contains('drop-into');
    const after = li.classList.contains('drop-after');
    const id = drag.id;
    clearMarks(li.parentElement);
    if (into) onInto(id, item.id);
    else onReorder(id, item.id, after);
  });
}

export const OPEN_ALL_CONFIRM = 15;

// Open every link in background tabs, keeping this New Tab where it is.
export async function openAll(links, label = 'these shortcuts') {
  const urls = links.map((l) => l.url).filter(Boolean);
  if (!urls.length) {
    toast('There’s nothing to open here.');
    return 0;
  }
  if (urls.length > OPEN_ALL_CONFIRM) {
    const ok = await confirmDialog({ title: `Open ${urls.length} tabs?`, message: `All of ${label} will open in new background tabs.`, confirmLabel: 'Open all' });
    if (!ok) return 0;
  }
  let opened = 0;
  for (const url of urls) {
    try {
      await chrome.tabs.create({ url, active: false });
      opened += 1;
    } catch (err) {
      console.warn('[Sequoia Tab] could not open', url, err);
    }
  }
  toast(`Opened ${opened} tab${opened === 1 ? '' : 's'}.`);
  return opened;
}

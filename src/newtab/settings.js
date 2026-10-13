// Settings window (macOS "System Settings" style). Changes apply instantly
// and persist through chrome.storage.local.

import { h, clear } from './dom.js';
import { icon } from '../lib/icons.js';
import {
  ROTATION_INTERVALS, WALLPAPER_SOURCES, UNSPLASH_CATEGORIES, SEARCH_ENGINES, STACK_WIDGETS,
  CHROME_APPS, DEFAULT_SETTINGS, seedShortcuts, seedDock, uid, deepClone,
} from '../lib/defaults.js';
import { PRESETS, GRADIENT_SWATCHES, COLOR_SWATCHES, gradientCss, isHexColor } from '../lib/presets.js';
import { KEYS, getSecrets, set } from '../lib/storage.js';
import { store, on, updateSettings, replaceSettings, saveShortcuts, saveDock, saveFavorites } from './store.js';
import { modal, toast, confirmDialog, toggle, segmented, selectBox, range, row, group } from './ui.js';
import { checkWallpaper, nextWallpaper, testUnsplashKey } from './bridge.js';
import { addUpload, deleteWallpaper, listWallpapers, MAX_UPLOADS } from './uploads.js';
import { MAX_SHORTCUTS, deleteFolder } from './shortcuts.js';
import { siteIcon } from './site-icon.js';
import { editLinkDialog } from './link-dialog.js';
import { openFolder } from './folder-view.js';
import { isFolder, countLinks } from '../lib/shortcut-model.js';
import { normalizeUrl } from '../lib/url.js';
import { exportBackup, importBackupFile } from './backup.js';
import { PHOTO_RE, accountStatus, connectFromSettings, disconnectFromSettings } from './gbar.js';
import { appFace } from './dock.js';
import { validCustomTemplate } from './search.js';
import { withUtm } from '../lib/unsplash.js';

const SECTIONS = [
  { id: 'wallpaper', label: 'Wallpaper', icon: 'image', color: '#0a84ff' },
  { id: 'appearance', label: 'Appearance', icon: 'settings', color: '#5e5ce6' },
  { id: 'widgets', label: 'Widgets', icon: 'extensions', color: '#ff9f0a' },
  { id: 'clock', label: 'Clock & Date', icon: 'history', color: '#ff375f' },
  { id: 'search', label: 'Search', icon: 'search', color: '#30b0c7' },
  { id: 'shortcuts', label: 'Shortcuts', icon: 'globe', color: '#34c759' },
  { id: 'dock', label: 'Dock', icon: 'downloads', color: '#64d2ff' },
  { id: 'bookmarks', label: 'Bookmarks', icon: 'bookmarks', color: '#ffcc00' },
  { id: 'about', label: 'Backup & Privacy', icon: 'backup', color: '#8e8e93' },
];

let dlg = null;
let current = 'wallpaper';
let body;
let head;
let tabs = [];
let unsubs = [];
let objectUrls = [];

const S = () => store.settings;
const upd = (fn, opts) => updateSettings(fn, opts);

function revokeUrls() {
  for (const u of objectUrls) URL.revokeObjectURL(u);
  objectUrls = [];
}

export function openSettings(section) {
  if (dlg) {
    if (section) select(section);
    return;
  }
  if (section) current = section;
  const side = h('div', { class: 'settings-side', role: 'tablist', 'aria-label': 'Settings sections', 'aria-orientation': 'vertical' }, h('h2', {}, 'Customize'));
  tabs = SECTIONS.map((s) => {
    const b = h(
      'button',
      { type: 'button', class: 'side-tab', role: 'tab', id: `tab-${s.id}`, 'aria-controls': 'settings-panel', 'aria-selected': 'false', tabindex: '-1', 'data-id': s.id },
      h('span', { class: 'badge', style: { background: s.color } }, icon(s.icon, { size: 14 })),
      h('span', { class: 'label' }, s.label),
    );
    b.addEventListener('click', () => select(s.id));
    b.addEventListener('keydown', (e) => {
      const i = SECTIONS.findIndex((x) => x.id === s.id);
      const d = ['ArrowDown', 'ArrowRight'].includes(e.key) ? 1 : ['ArrowUp', 'ArrowLeft'].includes(e.key) ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const n = SECTIONS[(i + d + SECTIONS.length) % SECTIONS.length].id;
      select(n);
      tabs.find((t) => t.dataset.id === n).focus();
    });
    return b;
  });
  side.append(...tabs);
  head = h('div', { class: 'settings-head' });
  body = h('div', { class: 'settings-body', id: 'settings-panel', role: 'tabpanel' });
  const sheet = h('div', { class: 'sheet' }, side, h('div', { class: 'settings-main' }, head, body));
  dlg = modal('settings-dialog', sheet, {
    label: 'Customize New Tab',
    onClose: () => {
      for (const u of unsubs) u();
      unsubs = [];
      revokeUrls();
      dlg = null;
    },
  });
  // Live-refresh the parts that other tabs / the service worker can change.
  unsubs.push(
    on('wallpaper', () => ['wallpaper'].includes(current) && refreshStatus()),
    on('favorites', () => current === 'wallpaper' && S().wallpaper.source === 'favorites' && render()),
    on('shortcuts', () => current === 'shortcuts' && render()),
    on('dock', () => current === 'dock' && render()),
  );
  select(current);
  tabs.find((t) => t.dataset.id === current)?.focus();
}

function select(id) {
  current = id;
  for (const t of tabs) {
    const on = t.dataset.id === id;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
  }
  body.setAttribute('aria-labelledby', `tab-${id}`);
  render();
  body.scrollTop = 0;
}

function render() {
  if (!dlg) return;
  const focusKey = document.activeElement?.closest?.('[data-k]')?.dataset.k;
  const scroll = body.scrollTop;
  revokeUrls();
  const sec = SECTIONS.find((s) => s.id === current);
  const close = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close settings' }, icon('close', { size: 16 }));
  close.addEventListener('click', () => dlg.close());
  clear(head).append(h('h3', {}, sec.label), close);
  clear(body).append(...RENDERERS[current]());
  body.scrollTop = scroll;
  if (focusKey) body.querySelector(`[data-k="${CSS.escape(focusKey)}"] :is(input,select,button,textarea), [data-k="${CSS.escape(focusKey)}"]:is(input,select,button,textarea)`)?.focus();
}

function k(key, node) {
  node.dataset.k = key;
  return node;
}

// ---------------------------------------------------------------- wallpaper

let statusEl = null;
function refreshStatus() {
  if (!statusEl) return;
  const st = store.wallpaper?.status;
  const w = S().wallpaper;
  if (st?.state === 'error' && st.source === w.source) {
    statusEl.className = 'status-line err';
    statusEl.textContent = st.message;
  } else {
    statusEl.className = 'status-line';
    statusEl.textContent = '';
  }
}

function wallpaperSection() {
  const w = S().wallpaper;
  const out = [];
  statusEl = h('p', { class: 'status-line', role: 'status', 'aria-live': 'polite' });

  out.push(
    group(
      'Source',
      h('div', { class: 'row block' },
        k('source', segmented(WALLPAPER_SOURCES, w.source, (v) => {
          upd((s) => (s.wallpaper.source = v), { immediate: true }).then(() => checkWallpaper());
          render();
        }, 'Wallpaper source')),
        statusEl,
      ),
    ),
  );
  refreshStatus();

  const rotates = !['gradient', 'color'].includes(w.source);
  if (rotates) {
    const nextBtn = h('button', { type: 'button', class: 'btn small' }, icon('refresh', { size: 14 }), 'Next now');
    nextBtn.addEventListener('click', async () => {
      nextBtn.disabled = true;
      const r = await nextWallpaper();
      nextBtn.disabled = false;
      if (r?.error?.message) toast(r.error.message, { error: true });
    });
    out.push(
      group(
        'Rotation',
        row('Change wallpaper', h('div', { class: 'row-controls' },
          k('interval', selectBox(ROTATION_INTERVALS, w.interval, (v) => upd((s) => (s.wallpaper.interval = v), { immediate: true }), 'Rotation interval')),
          nextBtn,
        ), w.source === 'preset' ? 'Cycles through the built-in wallpapers.' : 'Rotation is checked whenever a New Tab is open; Chrome must be running.'),
        row('Pause rotation', k('paused', toggle(w.paused, (v) => upd((s) => (s.wallpaper.paused = v), { immediate: true }), 'Pause rotation'))),
      ),
    );
  }

  out.push(...(SOURCE_PANELS[w.source] || (() => []))());

  out.push(
    group(
      'Effects',
      row('Dim overlay', k('overlay', range({ min: 0, max: 70, value: w.overlay, unit: '%', label: 'Overlay intensity', onInput: (v) => upd((s) => (s.wallpaper.overlay = v)) }))),
      row('Blur', k('blur', range({ min: 0, max: 30, value: w.blur, unit: 'px', label: 'Wallpaper blur', onInput: (v) => upd((s) => (s.wallpaper.blur = v)) }))),
    ),
  );
  return out;
}

function unsplashPanel() {
  const w = S().wallpaper;
  const keyIn = h('input', { class: 'field', type: 'password', id: 'unsplash-key', autocomplete: 'off', spellcheck: 'false', placeholder: 'Unsplash Access Key', style: { flex: '1', minWidth: '200px' }, 'aria-label': 'Unsplash Access Key' });
  getSecrets().then((s) => (keyIn.value = s.unsplashKey || ''));
  const keyStatus = h('p', { class: 'status-line', role: 'status', 'aria-live': 'polite' });
  const showBtn = h('button', { type: 'button', class: 'btn small', 'aria-pressed': 'false' }, 'Show');
  showBtn.addEventListener('click', () => {
    const shown = keyIn.type === 'text';
    keyIn.type = shown ? 'password' : 'text';
    showBtn.textContent = shown ? 'Show' : 'Hide';
    showBtn.setAttribute('aria-pressed', String(!shown));
  });
  const saveBtn = h('button', { type: 'button', class: 'btn small primary' }, 'Save & test');
  saveBtn.addEventListener('click', async () => {
    const key = keyIn.value.trim();
    if (key && !/^[A-Za-z0-9_-]{20,128}$/.test(key)) {
      keyStatus.className = 'status-line err';
      keyStatus.textContent = 'That doesn’t look like an Unsplash Access Key (letters, numbers, - and _).';
      return;
    }
    saveBtn.disabled = true;
    keyStatus.className = 'status-line';
    keyStatus.textContent = key ? 'Testing…' : 'Key removed.';
    await set({ [KEYS.secrets]: { ...(await getSecrets()), unsplashKey: key } });
    if (key) {
      const r = await testUnsplashKey();
      keyStatus.className = 'status-line ' + (r?.ok ? 'ok' : 'err');
      keyStatus.textContent = r?.ok ? 'Connected — the key works.' : r?.message || r?.error || 'Test failed.';
    }
    saveBtn.disabled = false;
  });
  keyIn.addEventListener('keydown', (e) => e.key === 'Enter' && saveBtn.click());

  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Categories' },
    UNSPLASH_CATEGORIES.map((c) => {
      const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(w.categories.includes(c)) }, c);
      b.addEventListener('click', () => {
        const on = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', String(on));
        upd((s) => {
          const set = new Set(s.wallpaper.categories);
          if (on) set.add(c);
          else set.delete(c);
          s.wallpaper.categories = UNSPLASH_CATEGORIES.filter((x) => set.has(x));
        });
      });
      return b;
    }),
  );
  const q = h('input', { class: 'field', maxlength: '200', placeholder: 'e.g. iceland, northern lights', style: { flex: '1' }, 'aria-label': 'Custom keywords' });
  q.value = w.customQuery;
  q.addEventListener('change', () => upd((s) => (s.wallpaper.customQuery = q.value.trim().slice(0, 200))));

  return [
    group(
      'Unsplash',
      h('div', { class: 'row block' },
        h('div', { class: 'row-label' }, 'Access Key', h('span', { class: 'hint' }, 'Stored only on this computer and sent only to api.unsplash.com.')),
        h('div', { class: 'row-controls', style: { justifyContent: 'flex-start' } }, keyIn, showBtn, saveBtn),
        keyStatus,
        h('p', { class: 'note' },
          'Create a free app at ',
          h('a', { href: 'https://unsplash.com/oauth/applications', target: '_blank', rel: 'noopener noreferrer' }, 'unsplash.com/oauth/applications'),
          ' and paste its Access Key. Photos are fetched 30 at a time, but each wallpaper change also sends one required download ping. Demo keys allow 50 requests/hour, so for 1-minute rotation use an approved (production) key or a 5-minute+ interval.'),
      ),
      h('div', { class: 'row block' }, h('div', { class: 'row-label' }, 'Categories', h('span', { class: 'hint' }, 'Pick none for random editorial-quality photos.')), chips),
      h('div', { class: 'row block' }, h('div', { class: 'row-label' }, 'Custom keywords', h('span', { class: 'hint' }, 'Comma-separated; each becomes its own topic.')), h('div', { class: 'row-controls', style: { justifyContent: 'stretch' } }, q)),
    ),
  ];
}

function uploadsPanel() {
  const gallery = h('div', { class: 'thumbs' });
  const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true, hidden: true });
  const pick = h('button', { type: 'button', class: 'btn small primary' }, icon('upload', { size: 14 }), 'Choose photos…');
  pick.addEventListener('click', () => input.click());
  const drop = h('div', { class: 'dropzone' }, icon('image', { size: 28 }), h('div', {}, 'Drop JPG, PNG or WebP images here (up to 25 MB each)'), pick, input);
  const progress = h('p', { class: 'status-line', role: 'status', 'aria-live': 'polite' });

  const handle = async (files) => {
    const list = [...files];
    if (!list.length) return;
    let ok = 0;
    let lastId = null;
    for (const [i, f] of list.entries()) {
      progress.className = 'status-line';
      progress.textContent = `Adding ${i + 1} of ${list.length}…`;
      try {
        const meta = await addUpload(f);
        ok += 1;
        lastId = meta.id;
      } catch (err) {
        toast(err.message || 'Could not add that image.', { error: true });
      }
    }
    progress.className = 'status-line ' + (ok ? 'ok' : 'err');
    progress.textContent = ok ? `Added ${ok} photo${ok > 1 ? 's' : ''}.` : 'No photos were added.';
    if (ok && (S().wallpaper.source !== 'uploads' || !S().wallpaper.uploadsDefaultId)) {
      await upd((s) => {
        s.wallpaper.source = 'uploads';
        if (!s.wallpaper.uploadsDefaultId) s.wallpaper.uploadsDefaultId = lastId;
      }, { immediate: true });
      checkWallpaper();
    }
    fill();
  };
  input.addEventListener('change', () => {
    handle(input.files);
    input.value = '';
  });
  drop.addEventListener('dragover', (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    handle(e.dataTransfer.files);
  });

  async function fill() {
    const items = await listWallpapers().catch(() => []);
    for (const u of objectUrls) URL.revokeObjectURL(u);
    objectUrls = [];
    clear(gallery);
    if (!items.length) {
      gallery.append(h('p', { class: 'note' }, 'No photos yet.'));
      return;
    }
    const def = S().wallpaper.uploadsDefaultId;
    const showing = store.wallpaper?.current?.kind === 'upload' ? store.wallpaper.current.id : null;
    for (const it of items) {
      const url = it.thumbBlob ? URL.createObjectURL(it.thumbBlob) : '';
      if (url) objectUrls.push(url);
      const isDef = it.id === def;
      const t = h('button', { type: 'button', class: 'thumb' + (showing === it.id ? ' selected' : ''), style: { backgroundImage: url ? `url("${url}")` : '' }, 'aria-label': `${it.name}${isDef ? ' (default)' : ''}. Set as default and show` },
        h('span', { class: 'thumb-name' }, it.name));
      t.addEventListener('click', async () => {
        await upd((s) => {
          s.wallpaper.source = 'uploads';
          s.wallpaper.uploadsDefaultId = it.id;
        }, { immediate: true });
        checkWallpaper();
        fill();
      });
      const del = h('button', { type: 'button', 'aria-label': `Remove ${it.name}`, title: 'Remove' }, icon('trash', { size: 13 }));
      del.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: 'Remove photo?', message: `“${it.name}” will be removed from Sequoia Tab. The original file on your computer is not affected.`, confirmLabel: 'Remove', danger: true }))) return;
        await deleteWallpaper(it.id);
        if (S().wallpaper.uploadsDefaultId === it.id) await upd((s) => (s.wallpaper.uploadsDefaultId = null), { immediate: true });
        checkWallpaper();
        fill();
      });
      gallery.append(h('div', { class: 'thumb-wrap' }, t, isDef ? h('span', { class: 'thumb-badge' }, 'Default') : null, h('div', { class: 'thumb-actions' }, del)));
    }
  }
  fill();
  return [group(`My Photos (max ${MAX_UPLOADS})`, h('div', { class: 'row block' }, drop, progress, gallery))];
}

function favoritesPanel() {
  const favs = store.favorites;
  const grid = h('div', { class: 'thumbs' });
  if (!favs.length) grid.append(h('p', { class: 'note' }, 'Tap the ♥ button next to an Unsplash photo credit to save it here. Favorites rotate without using your API quota.'));
  for (const f of favs) {
    const t = h('a', { class: 'thumb', href: withUtm(f.photoUrl), target: '_blank', rel: 'noopener noreferrer', style: { backgroundImage: `url("${f.thumb.replace(/"/g, '%22')}")`, backgroundColor: f.color }, 'aria-label': `Photo by ${f.author} on Unsplash (opens in new tab)` },
      h('span', { class: 'thumb-name' }, f.author));
    const del = h('button', { type: 'button', 'aria-label': `Remove photo by ${f.author} from favorites`, title: 'Remove' }, icon('close', { size: 13 }));
    del.addEventListener('click', () => {
      saveFavorites(store.favorites.filter((x) => x.id !== f.id));
      checkWallpaper();
    });
    grid.append(h('div', { class: 'thumb-wrap' }, t, h('div', { class: 'thumb-actions' }, del)));
  }
  return [group('Favorites', h('div', { class: 'row block' }, grid))];
}

function presetPanel() {
  const w = S().wallpaper;
  const grid = h('div', { class: 'thumbs', role: 'group', 'aria-label': 'Built-in wallpapers' });
  for (const p of PRESETS) {
    const b = h('button', { type: 'button', class: 'thumb', 'aria-pressed': String(w.presetId === p.id), style: { backgroundImage: p.css } }, h('span', { class: 'thumb-name' }, p.name));
    b.addEventListener('click', () => {
      upd((s) => {
        s.wallpaper.source = 'preset';
        s.wallpaper.presetId = p.id;
      }, { immediate: true }).then(() => checkWallpaper());
      for (const x of grid.children) x.setAttribute('aria-pressed', String(x === b));
    });
    grid.append(b);
  }
  return [group('Built-in wallpapers', h('div', { class: 'row block' }, grid, h('p', { class: 'note' }, 'Drawn with CSS — they work offline and load instantly.')))];
}

function gradientPanel() {
  const g = S().wallpaper.gradient;
  const preview = h('div', { class: 'thumb', style: { backgroundImage: gradientCss(g), aspectRatio: '16 / 5' }, 'aria-hidden': 'true' });
  const apply = (patch) =>
    upd((s) => {
      s.wallpaper.source = 'gradient';
      Object.assign(s.wallpaper.gradient, patch);
      preview.style.backgroundImage = gradientCss(s.wallpaper.gradient);
    });
  const from = h('input', { type: 'color', 'aria-label': 'Start color' });
  from.value = g.from;
  const to = h('input', { type: 'color', 'aria-label': 'End color' });
  to.value = g.to;
  from.addEventListener('input', () => apply({ from: from.value }));
  to.addEventListener('input', () => apply({ to: to.value }));
  const swatches = h('div', { class: 'chips' },
    GRADIENT_SWATCHES.map((sw) => {
      const b = h('button', { type: 'button', class: 'chip', style: { width: '44px', background: gradientCss(sw) }, 'aria-label': `Gradient ${sw.from} to ${sw.to}` });
      b.addEventListener('click', () => {
        apply({ ...sw });
        render();
      });
      return b;
    }),
  );
  return [
    group('Gradient',
      h('div', { class: 'row block' }, preview),
      row('Colors', h('div', { class: 'row-controls' }, from, to)),
      row('Angle', k('angle', range({ min: 0, max: 360, step: 5, value: g.angle, unit: '°', label: 'Gradient angle', onInput: (v) => apply({ angle: v }) }))),
      h('div', { class: 'row block' }, h('div', { class: 'row-label' }, 'Presets'), swatches),
    ),
  ];
}

function colorPanel() {
  const c = S().wallpaper.color;
  const pick = h('input', { type: 'color', 'aria-label': 'Background color' });
  pick.value = isHexColor(c) ? c : '#1f2933';
  const apply = (v) => upd((s) => {
    s.wallpaper.source = 'color';
    s.wallpaper.color = v;
  });
  pick.addEventListener('input', () => apply(pick.value));
  const swatches = h('div', { class: 'chips' },
    COLOR_SWATCHES.map((hex) => {
      const b = h('button', { type: 'button', class: 'chip', style: { width: '34px', background: hex }, 'aria-label': `Color ${hex}` });
      b.addEventListener('click', () => {
        pick.value = hex;
        apply(hex);
      });
      return b;
    }),
  );
  return [group('Solid color', row('Color', pick), h('div', { class: 'row block' }, swatches))];
}

const SOURCE_PANELS = {
  unsplash: unsplashPanel,
  uploads: uploadsPanel,
  favorites: favoritesPanel,
  preset: presetPanel,
  gradient: gradientPanel,
  color: colorPanel,
};

// ---------------------------------------------------------------- appearance

function appearanceSection() {
  const a = S().appearance;
  return [
    group('Theme',
      row('Appearance', k('theme', segmented([{ id: 'auto', label: 'Auto' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }], a.theme, (v) => upd((s) => (s.appearance.theme = v)), 'Theme')), 'Panels, menus and the dock.'),
      row('Text on wallpaper', k('tone', segmented([{ id: 'auto', label: 'Auto' }, { id: 'dark', label: 'Light text' }, { id: 'light', label: 'Dark text' }], a.textTone, (v) => upd((s) => (s.appearance.textTone = v)), 'Text color')), 'Auto picks based on wallpaper brightness.'),
    ),
    group('Glass',
      row('Transparency', k('transp', range({ min: 0, max: 100, value: a.transparency, unit: '%', label: 'Transparency', onInput: (v) => upd((s) => (s.appearance.transparency = v)) }))),
      row('Corner radius', k('radius', range({ min: 4, max: 28, value: a.radius, unit: 'px', label: 'Corner radius', onInput: (v) => upd((s) => (s.appearance.radius = v)) }))),
    ),
    group('Motion',
      row('Animations', k('anim', segmented([{ id: 'full', label: 'Full' }, { id: 'subtle', label: 'Subtle' }, { id: 'none', label: 'Off' }], a.animation, (v) => upd((s) => (s.appearance.animation = v)), 'Animation intensity'))),
      row('Reduce motion', k('rm', selectBox([{ id: 'system', label: 'Follow system setting' }, { id: 'always', label: 'Always' }], a.reducedMotion, (v) => upd((s) => (s.appearance.reducedMotion = v)), 'Reduce motion'))),
    ),
  ];
}

// ---------------------------------------------------------------- widgets

function widgetsSection() {
  const wd = S().widgets;
  const order = wd.order;
  const list = h('ul', { class: 'list' });
  order.forEach((id, i) => {
    const meta = STACK_WIDGETS.find((w) => w.id === id);
    const up = h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Move ${meta.label} up`, disabled: i === 0 }, icon('up', { size: 14 }));
    const down = h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Move ${meta.label} down`, disabled: i === order.length - 1 }, icon('down', { size: 14 }));
    const mv = (d) => {
      upd((s) => {
        const o = s.widgets.order;
        [o[i], o[i + d]] = [o[i + d], o[i]];
      });
      render();
    };
    up.addEventListener('click', () => mv(-1));
    down.addEventListener('click', () => mv(1));
    k(`w-up-${id}`, up);
    k(`w-down-${id}`, down);
    list.append(h('li', { class: 'list-item' }, h('div', { class: 'li-text' }, h('div', { class: 'li-title' }, meta.label)), up, down,
      k(`w-vis-${id}`, toggle(wd.visible[id], (v) => upd((s) => (s.widgets.visible[id] = v)), `Show ${meta.label}`))));
  });
  return [
    group('Layout',
      row('Position', k('align', segmented([{ id: 'center', label: 'Centered' }, { id: 'top', label: 'Top' }], wd.align, (v) => upd((s) => (s.widgets.align = v)), 'Widget position'))),
    ),
    group('Main widgets (top to bottom)', list),
    group('Other',
      row('Bookmarks bar', k('w-bm', toggle(wd.visible.bookmarks, (v) => upd((s) => (s.widgets.visible.bookmarks = v)), 'Show bookmarks bar'))),
      row('Dock', k('w-dock', toggle(wd.visible.dock, (v) => upd((s) => (s.widgets.visible.dock = v)), 'Show dock'))),
      row('To-do list', k('w-todo', toggle(wd.visible.todo, (v) => upd((s) => (s.widgets.visible.todo = v)), 'Show to-do list')), 'Floats on the right on wide windows; daily tasks reset each morning.'),
      row('Wallpaper info & controls', k('w-attr', toggle(wd.visible.attribution, (v) => upd((s) => (s.widgets.visible.attribution = v)), 'Show wallpaper info')), 'Next / pause / favorite buttons and the wallpaper name (bottom-left).'),
      row('Unsplash photo credit', k('w-credit', toggle(S().wallpaper.showCredit !== false, (v) => upd((s) => (s.wallpaper.showCredit = v)), 'Show Unsplash photo credit')), 'Unsplash’s API rules require crediting the photographer. Turning this off breaks those rules and Unsplash may revoke your Access Key — your choice.'),
    ),
    googleBarGroup(),
  ];
}

// Square-crop and shrink an uploaded avatar to a small data: URL.
async function avatarDataUrl(file) {
  if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Choose a JPG, PNG or WebP image.');
  if (file.size > 15 * 1024 * 1024) throw new Error('That image is larger than 15 MB.');
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error('That image couldn’t be read.');
  }
  const side = Math.min(bmp.width, bmp.height);
  const canvas = new OffscreenCanvas(128, 128);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 128, 128);
  bmp.close();
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 });
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('That image couldn’t be read.'));
    r.readAsDataURL(blob);
  });
}

function googleBarGroup() {
  const g = S().google;
  const accounts = Array.from({ length: 6 }, (_, i) => ({ id: String(i), label: i === 0 ? 'First signed-in account (u/0)' : `Account ${i + 1} (u/${i})` }));
  const preview = h('span', { class: 'gavatar', style: { cursor: 'default' }, 'aria-hidden': 'true' },
    PHOTO_RE.test(g.photo || '') ? h('img', { class: 'gavatar-img', src: g.photo, alt: '' }) : h('span', { class: 'gavatar-default' }, icon('person', { size: 18 })));
  const fileIn = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true });
  const choose = h('button', { type: 'button', class: 'btn small' }, icon('upload', { size: 14 }), g.photo ? 'Change photo…' : 'Upload photo…');
  choose.addEventListener('click', () => fileIn.click());
  fileIn.addEventListener('change', async () => {
    const file = fileIn.files?.[0];
    fileIn.value = '';
    try {
      const url = await avatarDataUrl(file);
      await upd((s) => (s.google.photo = url), { immediate: true });
      render();
    } catch (err) {
      toast(err.message, { error: true });
    }
  });
  const removeBtn = g.photo ? h('button', { type: 'button', class: 'btn small' }, 'Remove') : null;
  removeBtn?.addEventListener('click', async () => {
    await upd((s) => (s.google.photo = ''), { immediate: true });
    render();
  });
  return group('Google bar',
    row('Show Gmail, Images, apps & account', k('w-gbar', toggle(S().widgets.visible.gbar, (v) => upd((s) => (s.widgets.visible.gbar = v)), 'Show Google bar')), 'Top-right, like Chrome’s own New Tab page.'),
    row('Google account for links', k('g-user', selectBox(accounts, String(g.authuser), (v) => upd((s) => (s.google.authuser = Number(v))), 'Google account')), 'If you’re signed in to several Google accounts, pick which one Gmail and the apps open.'),
    googleAccountRow(),
    row('Profile photo (fallback)', h('div', { class: 'row-controls' }, preview, choose, removeBtn, fileIn), 'Used when your Google account isn’t connected. Stored only on this computer.'),
  );
}

function googleAccountRow() {
  const st = accountStatus();
  const btn = h('button', { type: 'button', class: 'btn small' + (st.connected ? '' : ' primary') }, st.connected ? 'Disconnect' : 'Connect…');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    if (st.connected) {
      await disconnectFromSettings();
      toast('Google account disconnected. Its info was removed from this computer.');
    } else if (!(await connectFromSettings())) {
      toast('Not connected — Chrome’s permission was not granted.', { error: true });
    }
    render();
  });
  const who = st.connected ? (st.current ? `Connected · ${st.current.email}` : 'Connected · not signed in to Google') : 'Not connected';
  return row(h('span', {}, 'Real Google photo, name & email', h('span', { class: 'hint', 'data-k': 'g-acct-status' }, who)), k('g-acct', btn),
    'Optional. Reads your signed-in accounts from accounts.google.com after Chrome asks you once. Nothing is sent anywhere else, and backups never include it.');
}

// ---------------------------------------------------------------- clock

function clockSection() {
  const c = S().clock;
  const sample = new Date();
  const fmt = (o) => new Intl.DateTimeFormat(undefined, o).format(sample);
  const p = (n) => String(n).padStart(2, '0');
  return [
    group('Clock',
      row('Time format', k('fmt', segmented([{ id: '12', label: '12-hour' }, { id: '24', label: '24-hour' }], c.format, (v) => upd((s) => (s.clock.format = v)), 'Time format'))),
      row('Show seconds', k('secs', toggle(c.showSeconds, (v) => upd((s) => (s.clock.showSeconds = v)), 'Show seconds'))),
      row('Date', k('date', selectBox([
        { id: 'long', label: fmt({ weekday: 'long', month: 'long', day: 'numeric' }) },
        { id: 'short', label: fmt({ weekday: 'short', month: 'short', day: 'numeric' }) },
        { id: 'numeric', label: fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }) },
        { id: 'iso', label: `${sample.getFullYear()}-${p(sample.getMonth() + 1)}-${p(sample.getDate())}` },
        { id: 'none', label: 'Hide date' },
      ], c.dateFormat, (v) => upd((s) => (s.clock.dateFormat = v)), 'Date format'))),
    ),
  ];
}

// ---------------------------------------------------------------- search

function searchSection() {
  const s = S().search;
  const custom = h('input', { class: 'field', placeholder: 'https://example.com/search?q=%s', maxlength: '2048', style: { flex: '1', minWidth: '240px' }, 'aria-label': 'Custom search URL' });
  custom.value = s.customUrl;
  const err = h('p', { class: 'status-line', role: 'status' });
  custom.addEventListener('change', () => {
    const v = custom.value.trim();
    if (v && !validCustomTemplate(v)) {
      err.className = 'status-line err';
      err.textContent = 'Use an http(s) URL containing %s where the search terms go.';
      return;
    }
    err.className = 'status-line ok';
    err.textContent = v ? 'Saved.' : '';
    upd((x) => {
      x.search.customUrl = v;
      if (v) x.search.engine = 'custom';
      else if (x.search.engine === 'custom') x.search.engine = 'default';
    });
    render();
  });
  return [
    group('Search',
      row('Search engine', k('engine', selectBox(SEARCH_ENGINES, s.engine, (v) => {
        upd((x) => (x.search.engine = v));
        render();
      }, 'Search engine')), '“Chrome default” uses the engine chosen in Chrome’s settings.'),
      s.engine === 'custom' || s.customUrl
        ? h('div', { class: 'row block' }, h('div', { class: 'row-label' }, 'Custom engine URL'), k('custom', h('div', { class: 'row-controls', style: { justifyContent: 'stretch' } }, custom)), err)
        : null,
      row('Focus search on open', k('af', toggle(s.autofocus, (v) => upd((x) => (x.search.autofocus = v)), 'Focus search on open')), 'Chrome may keep focus in the address bar for new tabs.'),
    ),
    h('p', { class: 'note' }, 'Tip: press / to jump to the search box, Alt+Enter to open results in a new tab. Typing an address (like github.com) opens it directly.'),
  ];
}

// ---------------------------------------------------------------- list manager

function linkList(items, { save, kind, max, iconFor }) {
  const ul = h('ul', { class: 'list' });
  if (!items.length) ul.append(h('li', { class: 'list-item' }, h('span', { class: 'note' }, 'Nothing here yet.')));
  items.forEach((it, i) => {
    const mv = (d) => {
      const arr = items.slice();
      [arr[i], arr[i + d]] = [arr[i + d], arr[i]];
      save(arr);
    };
    const up = k(`${kind}-up-${it.id}`, h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Move ${it.title} up`, disabled: i === 0 }, icon('up', { size: 14 })));
    const down = k(`${kind}-down-${it.id}`, h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Move ${it.title} down`, disabled: i === items.length - 1 }, icon('down', { size: 14 })));
    const edit = h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Edit ${it.title}` }, icon('edit', { size: 14 }));
    const del = h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remove ${it.title}` }, icon('trash', { size: 14 }));
    up.addEventListener('click', () => mv(-1));
    down.addEventListener('click', () => mv(1));
    if (isFolder(it)) {
      // Folders: "edit" opens the folder window, delete asks first.
      edit.setAttribute('aria-label', `Open folder ${it.title}`);
      edit.addEventListener('click', () => openFolder(it.id));
      del.addEventListener('click', () => deleteFolder(it));
    } else {
      edit.addEventListener('click', () =>
        editLinkDialog({ title: 'Edit', item: it, onSave: (data) => save(items.map((x) => (x.id === it.id ? { ...data, id: it.id, glyph: data.url === it.url ? it.glyph : undefined } : x))) }),
      );
      del.addEventListener('click', () => save(items.filter((x) => x.id !== it.id)));
    }
    const sub = isFolder(it) ? `Folder · ${it.children.length} shortcut${it.children.length === 1 ? '' : 's'}` : it.url;
    ul.append(h('li', { class: 'list-item' }, iconFor(it), h('div', { class: 'li-text' }, h('div', { class: 'li-title' }, it.title), h('div', { class: 'li-sub' }, sub)), up, down, edit, del));
  });
  const add = h('button', { type: 'button', class: 'btn small', disabled: items.length >= max }, icon('plus', { size: 14 }), 'Add website…');
  add.addEventListener('click', () => editLinkDialog({ title: 'Add website', onSave: (data) => save([...items, { ...data, id: uid(kind) }]) }));
  return { ul, add };
}

function shortcutsSection() {
  const s = S().shortcuts;
  const { ul, add } = linkList(store.shortcuts, {
    save: saveShortcuts,
    kind: 'sc',
    max: MAX_SHORTCUTS,
    iconFor: (it) => (isFolder(it) ? h('span', { class: 'mini', style: { background: '#0a84ff' } }, icon('folder', { size: 13 })) : h('span', { class: 'mini' }, siteIcon(it, 32))),
  });
  const restore = h('button', { type: 'button', class: 'btn small' }, 'Restore original shortcuts');
  restore.addEventListener('click', async () => {
    if (await confirmDialog({ title: 'Restore original shortcuts?', message: 'This replaces the current list with your 10 original Chrome shortcuts (All Plugings, My plugin, Gmail, …).', confirmLabel: 'Restore' })) {
      saveShortcuts(seedShortcuts());
    }
  });
  const cols = [{ id: 'auto', label: 'Automatic' }, ...Array.from({ length: 10 }, (_, i) => ({ id: String(i + 3), label: `${i + 3} per row` }))];
  return [
    group('Layout',
      row('Size', k('size', segmented([{ id: 'small', label: 'Small' }, { id: 'medium', label: 'Medium' }, { id: 'large', label: 'Large' }], s.size, (v) => upd((x) => (x.shortcuts.size = v)), 'Shortcut size'))),
      row('Columns', k('cols', selectBox(cols, String(s.columns), (v) => upd((x) => (x.shortcuts.columns = v === 'auto' ? 'auto' : v)), 'Columns'))),
      row('Show names', k('labels', toggle(s.showLabels, (v) => upd((x) => (x.shortcuts.showLabels = v)), 'Show names'))),
    ),
    group(`On the page (${store.shortcuts.length}/${MAX_SHORTCUTS}) · ${countLinks(store.shortcuts)} shortcuts in total`, ul),
    h('div', { class: 'row-controls', style: { justifyContent: 'flex-start' } }, add, restore),
    h('p', { class: 'note' }, 'Drag tiles on the page to reorder them, or drop one tile onto another to make a folder. Ctrl+Shift+← / → also reorders a focused tile. Folder ⋯ menus have “Open all in new tabs”.'),
  ];
}

// ---------------------------------------------------------------- dock

function dockSection() {
  const d = S().dock;
  const { ul, add } = linkList(store.dock, {
    save: saveDock,
    kind: 'dk',
    max: 24,
    iconFor: (it) => h('span', { class: 'mini', style: { width: '22px', height: '22px' } }, appFace(it)),
  });
  const missing = CHROME_APPS.filter((a) => !store.dock.some((x) => normalizeUrl(x.url) === normalizeUrl(a.url)));
  const chromeAdd = selectBox([{ id: '', label: 'Add Chrome page…' }, ...missing.map((a) => ({ id: a.url, label: a.title }))], '', (v) => {
    const app = CHROME_APPS.find((a) => a.url === v);
    if (app) saveDock([...store.dock, { ...app, id: uid('dk') }]);
  }, 'Add a Chrome page');
  const restore = h('button', { type: 'button', class: 'btn small' }, 'Restore default dock');
  restore.addEventListener('click', () => saveDock(seedDock()));
  return [
    group('Dock',
      row('Show dock', k('d-show', toggle(S().widgets.visible.dock, (v) => upd((x) => (x.widgets.visible.dock = v)), 'Show dock'))),
      row('Position', k('d-pos', segmented([{ id: 'bottom', label: 'Bottom' }, { id: 'left', label: 'Left' }, { id: 'right', label: 'Right' }], d.position, (v) => upd((x) => (x.dock.position = v)), 'Dock position'))),
      row('Icon size', k('d-size', range({ min: 32, max: 72, step: 2, value: d.iconSize, unit: 'px', label: 'Dock icon size', onInput: (v) => upd((x) => (x.dock.iconSize = v)) }))),
      row('Magnification', k('d-mag', toggle(d.magnify, (v) => upd((x) => (x.dock.magnify = v)), 'Magnification'))),
      row('Automatically hide', k('d-hide', toggle(d.autohide, (v) => upd((x) => (x.dock.autohide = v)), 'Automatically hide the dock')), 'Move the pointer to the screen edge to reveal it.'),
    ),
    group('Apps & websites', ul),
    h('div', { class: 'row-controls', style: { justifyContent: 'flex-start' } }, add, missing.length ? chromeAdd : null, restore),
  ];
}

// ---------------------------------------------------------------- bookmarks

function bookmarksSection() {
  const open = h('button', { type: 'button', class: 'btn small' }, icon('external', { size: 14 }), 'Open Bookmark Manager');
  open.addEventListener('click', () => chrome.tabs.create({ url: 'chrome://bookmarks' }));
  return [
    group('Bookmarks bar',
      row('Show bookmarks bar', k('b-show', toggle(S().widgets.visible.bookmarks, (v) => upd((x) => (x.widgets.visible.bookmarks = v)), 'Show bookmarks bar'))),
      row('Show “Other” and “Mobile” folders', k('b-other', toggle(S().bookmarks.showOther, (v) => upd((x) => (x.bookmarks.showOther = v)), 'Show other bookmarks'))),
    ),
    h('p', { class: 'note' }, 'Your bookmarks are read directly from Chrome and are never modified. Hiding the bar only hides it on this page. To add or organise bookmarks, use Chrome as usual.'),
    h('div', { class: 'row-controls', style: { justifyContent: 'flex-start' } }, open),
  ];
}

// ---------------------------------------------------------------- about

function aboutSection() {
  const reset = h('button', { type: 'button', class: 'btn small danger' }, 'Restore default settings');
  reset.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Restore default settings?',
      message: 'Appearance, wallpaper, widget, clock, search and dock options go back to their defaults. Your shortcuts, dock items, uploaded photos, favorites and Unsplash key are kept.',
      confirmLabel: 'Restore',
      danger: true,
    });
    if (!ok) return;
    await replaceSettings(deepClone(DEFAULT_SETTINGS));
    checkWallpaper();
    toast('Settings restored to defaults.');
    render();
  });
  const perms = [
    ['storage', 'saves your settings, shortcuts and dock on this computer.'],
    ['bookmarks', 'shows your bookmarks bar and folders. Read-only: the extension never changes them.'],
    ['alarms', 'wakes the extension to rotate wallpapers on schedule.'],
    ['favicon', 'shows site icons from Chrome’s local icon cache (no requests to the sites).'],
    ['search', 'lets “Chrome default” search with the engine you set in Chrome.'],
  ];
  const exp = h('button', { type: 'button', class: 'btn small' }, icon('downloads', { size: 14 }), 'Export backup');
  exp.addEventListener('click', () => exportBackup());
  const fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  const imp = h('button', { type: 'button', class: 'btn small' }, icon('upload', { size: 14 }), 'Import backup…');
  imp.addEventListener('click', () => fileIn.click());
  fileIn.addEventListener('change', async () => {
    const file = fileIn.files?.[0];
    fileIn.value = '';
    if (await importBackupFile(file)) {
      checkWallpaper();
      render();
    }
  });
  return [
    group('Backup',
      row('Settings backup', h('div', { class: 'row-controls' }, exp, imp, fileIn), 'Settings, shortcuts & folders, dock, favorites and to-dos as a JSON file. Your Unsplash key and uploaded photos are not included.'),
    ),
    group('Permissions', h('ul', { class: 'perm-list' }, perms.map(([p, d]) => h('li', {}, h('b', {}, p), ' — ', d)))),
    group('Privacy',
      h('div', { class: 'row block' }, h('p', { class: 'note' },
        'Everything stays on this device in Chrome’s extension storage. No analytics, no tracking, and your history, passwords and browsing data are never read or sent. ',
        'The only network requests are to Unsplash (api.unsplash.com and images.unsplash.com) when you choose Unsplash wallpapers, using your own key.')),
    ),
    group('Reset', row('Restore default settings', reset)),
    h('p', { class: 'note' }, `Sequoia Tab ${chrome.runtime.getManifest().version}`),
  ];
}

const RENDERERS = {
  wallpaper: wallpaperSection,
  appearance: appearanceSection,
  widgets: widgetsSection,
  clock: clockSection,
  search: searchSection,
  shortcuts: shortcutsSection,
  dock: dockSection,
  bookmarks: bookmarksSection,
  about: aboutSection,
};

export function isSettingsOpen() {
  return !!dlg;
}


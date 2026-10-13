// Pure operations on the shortcuts list. Items are either links
// { id, title, url, icon? } or folders { id, type: 'folder', title, children: [links] }.
// Folders are one level deep (like Launchpad). Every function returns a new
// list and never mutates its input.

import { uid } from './defaults.js';
import { normalizeUrl } from './url.js';

export const MAX_TOP_LEVEL = 48;
export const MAX_IN_FOLDER = 48;

export const isFolder = (item) => item?.type === 'folder';

const clone = (list) => list.map((it) => (isFolder(it) ? { ...it, children: it.children.slice() } : { ...it }));

// Where an item lives: { folder: folderItem|null, index }
export function locate(list, id) {
  const top = list.findIndex((it) => it.id === id);
  if (top >= 0) return { folder: null, index: top };
  for (const f of list) {
    if (!isFolder(f)) continue;
    const i = f.children.findIndex((c) => c.id === id);
    if (i >= 0) return { folder: f, index: i };
  }
  return null;
}

export function findItem(list, id) {
  const loc = locate(list, id);
  if (!loc) return null;
  return loc.folder ? loc.folder.children[loc.index] : list[loc.index];
}

function containerOf(list, id) {
  const loc = locate(list, id);
  if (!loc) return null;
  return { arr: loc.folder ? list.find((f) => f.id === loc.folder.id).children : list, index: loc.index };
}

// Swap with a neighbour inside the same container (top level or folder).
export function move(list, id, delta) {
  const out = clone(list);
  const c = containerOf(out, id);
  if (!c) return list;
  const j = c.index + delta;
  if (j < 0 || j >= c.arr.length) return list;
  [c.arr[c.index], c.arr[j]] = [c.arr[j], c.arr[c.index]];
  return out;
}

// Move `id` to sit before/after `targetId` within the target's container.
export function reorder(list, id, targetId, after) {
  if (id === targetId) return list;
  const out = clone(list);
  const src = containerOf(out, id);
  const dstLoc = locate(out, targetId);
  if (!src || !dstLoc) return list;
  const [item] = src.arr.splice(src.index, 1);
  if (isFolder(item) && dstLoc.folder) return list; // no nested folders
  const dst = containerOf(out, targetId);
  dst.arr.splice(dst.index + (after ? 1 : 0), 0, item);
  return out;
}

// Folders never stay empty (like Launchpad).
const pruneEmpty = (list) => list.filter((it) => !isFolder(it) || it.children.length);

export function remove(list, id) {
  const out = clone(list);
  const c = containerOf(out, id);
  if (!c) return list;
  c.arr.splice(c.index, 1);
  return pruneEmpty(out);
}

export function update(list, id, patch) {
  const out = clone(list);
  const c = containerOf(out, id);
  if (!c) return list;
  c.arr[c.index] = { ...c.arr[c.index], ...patch, id };
  return out;
}

export function addLink(list, link, folderId = null) {
  const out = clone(list);
  const item = { ...link, id: link.id || uid('sc') };
  if (folderId) {
    const f = out.find((x) => x.id === folderId && isFolder(x));
    if (!f || f.children.length >= MAX_IN_FOLDER) return list;
    f.children.push(item);
  } else {
    if (out.length >= MAX_TOP_LEVEL) return list;
    out.push(item);
  }
  return out;
}

export function addToFolder(list, id, folderId) {
  const item = findItem(list, id);
  const folder = list.find((f) => f.id === folderId && isFolder(f));
  if (!item || isFolder(item) || !folder || folder.children.length >= MAX_IN_FOLDER) return list;
  const out = clone(remove(list, id));
  out.find((f) => f.id === folderId).children.push(item);
  return out;
}

// Create a folder at the target's position holding target + dragged item.
export function createFolder(list, targetId, otherId = null, title = 'Folder') {
  const target = list.find((it) => it.id === targetId);
  const other = otherId ? findItem(list, otherId) : null;
  if (!target || isFolder(target) || (otherId && (!other || isFolder(other) || otherId === targetId))) {
    return { list, folderId: null };
  }
  let out = otherId ? remove(list, otherId) : clone(list);
  const at = out.findIndex((it) => it.id === targetId);
  const folder = { id: uid('fd'), type: 'folder', title: String(title).slice(0, 60) || 'Folder', children: other ? [target, other] : [target] };
  out = out.slice();
  out.splice(at, 1, folder);
  return { list: out, folderId: folder.id };
}

// Move an item out of its folder, right after the folder.
export function moveOut(list, id) {
  const loc = locate(list, id);
  if (!loc?.folder || list.length >= MAX_TOP_LEVEL) return list;
  const item = loc.folder.children[loc.index];
  const out = clone(list);
  const fi = out.findIndex((f) => f.id === loc.folder.id);
  out[fi].children.splice(loc.index, 1);
  out.splice(fi + 1, 0, item);
  return pruneEmpty(out);
}

// Replace a folder with its contents.
export function ungroup(list, folderId) {
  const fi = list.findIndex((f) => f.id === folderId && isFolder(f));
  if (fi < 0) return list;
  const out = clone(list);
  out.splice(fi, 1, ...out[fi].children);
  return out.slice(0, MAX_TOP_LEVEL + MAX_IN_FOLDER);
}

// [{ item, folder }] for every link, in display order.
export function flattenLinks(list) {
  const out = [];
  for (const it of list) {
    if (isFolder(it)) for (const c of it.children) out.push({ item: c, folder: it });
    else out.push({ item: it, folder: null });
  }
  return out;
}

export function countLinks(list) {
  return flattenLinks(list).length;
}

// ---- validation for imported / untrusted data ----

function cleanIcon(v) {
  if (typeof v !== 'string' || !v) return undefined;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}

export function sanitizeLink(raw, seen = new Set()) {
  if (!raw || typeof raw !== 'object') return null;
  const url = normalizeUrl(raw.url);
  if (!url) return null;
  let id = typeof raw.id === 'string' && /^[\w-]{1,64}$/.test(raw.id) && !seen.has(raw.id) ? raw.id : uid('sc');
  seen.add(id);
  const title = (typeof raw.title === 'string' ? raw.title : '').trim().slice(0, 80) || url;
  const out = { id, title, url };
  const ic = cleanIcon(raw.icon);
  if (ic) out.icon = ic;
  if (typeof raw.glyph === 'string' && /^[a-z]{1,20}$/.test(raw.glyph)) out.glyph = raw.glyph;
  return out;
}

export function sanitizeShortcuts(raw) {
  if (!Array.isArray(raw)) return null;
  const seen = new Set();
  const out = [];
  for (const it of raw.slice(0, MAX_TOP_LEVEL)) {
    if (it && it.type === 'folder') {
      const children = (Array.isArray(it.children) ? it.children : []).slice(0, MAX_IN_FOLDER).map((c) => sanitizeLink(c, seen)).filter(Boolean);
      if (!children.length) continue;
      let id = typeof it.id === 'string' && /^[\w-]{1,64}$/.test(it.id) && !seen.has(it.id) ? it.id : uid('fd');
      seen.add(id);
      out.push({ id, type: 'folder', title: (typeof it.title === 'string' ? it.title : '').trim().slice(0, 60) || 'Folder', children });
    } else {
      const link = sanitizeLink(it, seen);
      if (link) out.push(link);
    }
  }
  return out;
}

export function sanitizeLinks(raw, max = 48) {
  if (!Array.isArray(raw)) return null;
  const seen = new Set();
  return raw.slice(0, max).map((x) => sanitizeLink(x, seen)).filter(Boolean);
}

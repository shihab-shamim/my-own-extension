// Validates and stores user-uploaded wallpapers in IndexedDB.

import { putWallpaper, deleteWallpaper, listWallpapers } from '../lib/idb.js';
import { uid } from '../lib/defaults.js';
import { toneForRgb } from '../lib/presets.js';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_UPLOADS = 60;
const MAX_EDGE = 3840;
const TYPES = { 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/webp': 'WebP' };

async function sniff(file) {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  const ascii = (i, n) => String.fromCharCode(...b.slice(i, i + n));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  return null;
}

function canvas(w, h) {
  const c = new OffscreenCanvas(w, h);
  return [c, c.getContext('2d')];
}

function averageColor(bitmap) {
  const [, ctx] = canvas(24, 14);
  ctx.drawImage(bitmap, 0, 0, 24, 14);
  const d = ctx.getImageData(5, 2, 14, 8).data;
  let r = 0;
  let g = 0;
  let b = 0;
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    r += d[i];
    g += d[i + 1];
    b += d[i + 2];
  }
  const rgb = [r / n, g / n, b / n].map(Math.round);
  return { hex: '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join(''), tone: toneForRgb(rgb) };
}

async function resize(bitmap, maxEdge, type, quality) {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const [c, ctx] = canvas(w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  return { blob: await c.convertToBlob({ type, quality }), width: w, height: h };
}

// Returns the stored metadata, or throws an Error with a user-facing message.
export async function addUpload(file) {
  if (!file || !TYPES[file.type]) throw new Error(`“${file?.name || 'File'}” isn’t a JPG, PNG or WebP image.`);
  if (file.size > MAX_UPLOAD_BYTES) throw new Error(`“${file.name}” is larger than 25 MB.`);
  if (file.size < 100) throw new Error(`“${file.name}” is empty or damaged.`);
  const real = await sniff(file);
  if (!real) throw new Error(`“${file.name}” doesn’t look like a valid image.`);
  const existing = await listWallpapers();
  if (existing.length >= MAX_UPLOADS) throw new Error(`You can keep up to ${MAX_UPLOADS} photos. Remove some first.`);

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`“${file.name}” couldn’t be decoded.`);
  }
  try {
    if (bitmap.width < 16 || bitmap.height < 16) throw new Error(`“${file.name}” is too small to use as a wallpaper.`);
    let blob = file;
    let width = bitmap.width;
    let height = bitmap.height;
    if (Math.max(width, height) > MAX_EDGE) {
      ({ blob, width, height } = await resize(bitmap, MAX_EDGE, 'image/jpeg', 0.9));
    } else {
      blob = new Blob([await file.arrayBuffer()], { type: real });
    }
    const thumb = await resize(bitmap, 360, 'image/webp', 0.8);
    const { hex, tone } = averageColor(bitmap);
    const record = {
      id: uid('up'),
      name: String(file.name || 'Photo').replace(/\.[a-z0-9]+$/i, '').slice(0, 80),
      type: blob.type,
      size: blob.size,
      width,
      height,
      color: hex,
      tone,
      addedAt: Date.now(),
      blob,
      thumbBlob: thumb.blob,
    };
    await putWallpaper(record);
    const { blob: _b, ...meta } = record;
    return meta;
  } finally {
    bitmap.close();
  }
}

export { deleteWallpaper, listWallpapers };

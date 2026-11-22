/**
 * Natural pixel size of reader pages, learned from the loaded images.
 *
 * Every page of a chapter used to occupy a fake ~200/1200 px placeholder until
 * its image arrived. Manga pages are ~1.4× taller than wide, and WEBTOON pages
 * are single strips of 16383 px (≈12 000 px tall on screen): when such a page
 * finally loaded, the document jumped by twelve thousand pixels — the reader's
 * scroll felt sharp and torn. Once a page's dimensions are known the scroll view
 * renders an exact-height placeholder, so nothing moves when the image appears.
 *
 * The cache is shared with PageImg (which records dimensions on load) and with
 * the scroll view's look-ahead probes.
 */
export interface ImageDims {
  w: number;
  h: number;
}

const dims = new Map<string, ImageDims>();
const listeners = new Set<() => void>();
const MAX_ENTRIES = 6000;

function key(galleryId: string, index: number): string {
  return `${galleryId}:${index}`;
}

export function getImageDims(galleryId: string, index: number): ImageDims | null {
  return dims.get(key(galleryId, index)) ?? null;
}

export function recordImageDims(galleryId: string, index: number, w: number, h: number): void {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
  const k = key(galleryId, index);
  const current = dims.get(k);
  if (current && current.w === w && current.h === h) return;
  if (dims.size >= MAX_ENTRIES) dims.clear();
  dims.set(k, { w, h });
  for (const fn of listeners) fn();
}

export function subscribeImageDims(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const probing = new Set<string>();

/** Fetches just the dimensions of a page (via a detached Image). Requests go
 * through the same `manga://page` handler as the reader, so the bytes land in
 * the shared page cache and the real <img> later renders instantly. `thumb=1`
 * keeps the request at background queue priority. */
export function probeImageDims(galleryId: string, index: number): void {
  const k = key(galleryId, index);
  if (dims.has(k) || probing.has(k)) return;
  probing.add(k);
  const img = new Image();
  img.onload = () => {
    probing.delete(k);
    recordImageDims(galleryId, index, img.naturalWidth, img.naturalHeight);
  };
  img.onerror = () => {
    probing.delete(k);
  };
  img.src = `manga://page/${galleryId}/${index}?thumb=1`;
}

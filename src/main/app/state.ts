import { app } from 'electron';
import { join } from 'path';
import type { Gallery } from '../services/gallery';
import type { CatalogItem } from '../services/sources/catalog-types';
import { CoverDiskCache } from '../services/cover-cache';

export const galleries = new Map<string, Gallery>();

export const onlineHeaders = new Map<string, Record<string, string>>();
// In-memory cover cache is bounded by entry count (an LRU — the oldest entry
// is dropped past the cap) so long catalog sessions don't grow it unbounded;
// the on-disk cache is bounded separately by cover_cache_mb.
const COVER_CACHE_MAX = 400;
export const coverCache = new Map<string, Buffer>();
export function cacheCover(url: string, buf: Buffer): void {
  coverCache.delete(url); // re-insert to refresh LRU recency
  coverCache.set(url, buf);
  while (coverCache.size > COVER_CACHE_MAX) {
    const oldest = coverCache.keys().next().value;
    if (oldest === undefined) break;
    coverCache.delete(oldest);
  }
}
export const coverInFlight = new Map<string, Promise<Buffer>>();
let coverDisk: CoverDiskCache | null = null;

export function getCoverDisk(getMaxBytes: () => number): CoverDiskCache {
  if (!coverDisk) {
    coverDisk = new CoverDiskCache(join(app.getPath('userData'), 'cover-cache'), getMaxBytes());
  }
  return coverDisk;
}

export function setCoverDiskMaxBytes(maxBytes: number): void {
  coverDisk?.setMaxBytes(maxBytes);
}

export const zipMeta = new Map<string, { zipPath: string; entries: string[] }>();
export const ZIP_TMP = join(app.getPath('userData'), 'tmp', 'zip');

export const groupleCache = new Map<string, { base: string; items: CatalogItem[]; ts: number }>();
let groupleWarming = false;

export function isGroupleWarming(): boolean {
  return groupleWarming;
}

export function setGroupleWarming(value: boolean): void {
  groupleWarming = value;
}

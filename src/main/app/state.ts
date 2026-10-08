import { app } from 'electron';
import { join } from 'path';
import type { Gallery } from '../services/gallery';
import type { CatalogItem } from '../services/sources/catalog-types';
import { CoverDiskCache } from '../services/cover-cache';

export const galleries = new Map<string, Gallery>();

export const onlineHeaders = new Map<string, Record<string, string>>();
export const coverCache = new Map<string, Buffer>();
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

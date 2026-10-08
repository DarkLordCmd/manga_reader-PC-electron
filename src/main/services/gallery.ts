import { readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { naturalCompare } from './natural-sort';

const SUPPORTED_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']);

export function listPageFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => {
      const full = join(dir, name);
      try {
        if (!statSync(full).isFile()) return false;
      } catch {
        return false;
      }
      const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
      return SUPPORTED_EXTS.has(ext);
    })
    .map((name) => join(dir, name))
    .sort((a, b) => naturalCompare(basename(a), basename(b)));
}

export interface Gallery {
  id: string;
  title: string;
  pages: string[];
}

let nextId = 1;

export function galleryFromFolder(dir: string): Gallery | null {
  const pages = listPageFiles(dir);
  if (pages.length === 0) return null;
  return { id: `local-${nextId++}`, title: basename(dir) || 'Local', pages };
}

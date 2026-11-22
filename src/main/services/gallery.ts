import { readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { naturalCompare } from './natural-sort';

// Must stay in sync with the ZIP reader (zip-gallery.ts) and the downloader
// (download-manager.ts extFromUrl): a page saved as .avif was listed by ZIP
// archives and by finished downloads, but a plain folder gallery silently
// skipped it (Chromium renders AVIF fine, so this was a pure inconsistency).
const SUPPORTED_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif']);

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

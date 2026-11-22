import { readFileSync, writeFileSync } from 'fs';
import { fetchSenkuroR34Flags } from './senkuro-r34-labels';
import { logger } from './logger';
import type { SeriesRepository } from './series-repository';

/** Library rows imported from Senkuro used to be stored as category "main".
 * Senkuro's EXPLICIT age rating is not enough for R34: it is also used for
 * violent action/horror. The actual NSFW signal is the label set
 * (`hentai`/`smut`), so this backfill resolves labels for every Senkuro row and
 * moves only those to R34 — including moving previously misclassified rows
 * (e.g. EXPLICIT battle manhwa) back to Main. */

export function senkuroSlugFromUrl(url: string): string | null {
  const m = String(url ?? '').match(/senkuro\.[a-z]+\/manga\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

interface DiskFlag {
  r34: boolean;
  at: number;
}
const diskFlags = new Map<string, DiskFlag>();
let diskLoadedFor: string | null = null;
const FLAG_TTL_MS = 30 * 24 * 60 * 60_000;

function loadDiskFlags(file: string | undefined): void {
  if (!file || diskLoadedFor === file) return;
  diskLoadedFor = file;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, DiskFlag>;
    for (const [slug, v] of Object.entries(parsed)) {
      // v2 format only; the old {rating} file is ignored and refetched.
      if (v && typeof v.r34 === 'boolean' && typeof v.at === 'number') diskFlags.set(slug, v);
    }
  } catch {
    /* first run / corrupt cache */
  }
}

function saveDiskFlags(file: string | undefined): void {
  if (!file) return;
  try {
    writeFileSync(file, JSON.stringify(Object.fromEntries(diskFlags)), 'utf8');
  } catch {
    /* best-effort */
  }
}

/** Resolves the R34 flag for every Senkuro row (batched) and applies it both
 * ways: hentai/smut → r34, everything else → back to main if it was r34. */
export async function reclassifySenkuroR34(opts: {
  repo: SeriesRepository;
  cookieHeader?: string;
  proxy?: string;
  onChange?: () => void;
  cacheFile?: string;
}): Promise<{ checked: number; updated: number }> {
  loadDiskFlags(opts.cacheFile);
  const rows = opts.repo.all().filter((i) => /senkuro\.[a-z]+\/manga\//i.test(i.url));
  if (rows.length === 0) return { checked: 0, updated: 0 };

  const bySlug = new Map<string, typeof rows>();
  for (const row of rows) {
    const slug = senkuroSlugFromUrl(row.url);
    if (!slug) continue;
    const list = bySlug.get(slug) ?? [];
    list.push(row);
    bySlug.set(slug, list);
  }

  let updated = 0;
  const apply = (slug: string, r34: boolean): void => {
    for (const row of bySlug.get(slug) ?? []) {
      const want = r34 ? 'r34' : 'main';
      if (row.category === want) continue;
      // Do not resurrect an explicit row that a reviewer moved? Categories are
      // internal Main/R34 tabs, so following the labels is the correct state.
      try {
        opts.repo.setCategory(row.key, want);
        updated++;
      } catch (e) {
        logger.warn('[senkuro-r34] setCategory failed', row.key, (e as Error)?.message ?? e);
      }
    }
  };

  const toAsk: string[] = [];
  for (const slug of bySlug.keys()) {
    const disk = diskFlags.get(slug);
    if (disk && Date.now() - disk.at < FLAG_TTL_MS) {
      apply(slug, disk.r34);
    } else {
      toAsk.push(slug);
    }
  }

  if (toAsk.length > 0) {
    const flags = await fetchSenkuroR34Flags(toAsk, {
      cookieHeader: opts.cookieHeader,
      proxy: opts.proxy,
    });
    for (const [slug, r34] of flags) {
      diskFlags.set(slug, { r34, at: Date.now() });
      apply(slug, r34);
    }
    saveDiskFlags(opts.cacheFile);
  }

  if (updated > 0) {
    logger.info(`[senkuro-r34] reclassified ${updated} Senkuro row(s) from labels`);
    try {
      opts.onChange?.();
    } catch {
      /* best-effort */
    }
  }
  return { checked: bySlug.size, updated };
}

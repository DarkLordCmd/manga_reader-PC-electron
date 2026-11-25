import { mangaSeriesUrlFromChapterUrl } from './sources';

export function sourceLabelForUrl(url: string): string {
  const lower = url.toLowerCase();
  if (lower.startsWith('file://')) return 'Локальная папка';
  if (lower.includes('mangadex') || (!lower.startsWith('http') && url.length === 36)) return 'MangaDex';
  if (lower.includes('exhentai')) return 'ExHentai';
  if (lower.includes('e-hentai.org')) return 'E-Hentai';
  if (lower.includes('nhentai')) return 'NHentai';
  if (lower.includes('com-x.life')) return 'Com-X';
  if (lower.includes('senkuro.')) return 'Senkuro';
  if (lower.includes('manga-shi.')) return 'Manga-shi';
  if (lower.includes('remanga.')) return 'Remanga';
  if (lower.includes('hentailib.')) return 'HentaiLIB';
  if (lower.includes('mangalib.')) return 'Mangalib';
  return '';
}

/** R34 sources (E-Hentai family + nhentai) — same rule the reading history
 * uses, so library/favorites rows land in the same tab as the history entry.
 * `adult` covers 18+ works from non-R34 sources (Manga-shi, Senkuro, Remanga,
 * MangaDex erotica): they belong to the R34 tab as well. */
export function categoryForUrl(url: string, adult = false): string {
  if (adult) return 'r34';
  return /nhentai|exhentai|e-hentai\.org/i.test(url) ? 'r34' : 'main';
}

export function galleryKeyForUrl(url: string): string | null {
  const lower = url.toLowerCase();
  const gid = lower.match(/\/g\/(\d+)(\/[0-9a-f]+)?\/?/)?.[1];
  if (!gid) return null;
  if (/exhentai|e-hentai\.org/.test(lower)) return `eh:${gid}`;
  if (/nhentai/.test(lower)) return `nh:${gid}`;
  return null;
}

export function seriesKeyForUrl(url: string): string | null {
  const raw = String(url ?? '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.startsWith('file:')) return `local:${lower.replace(/\/+$/, '')}`;
  const gallery = galleryKeyForUrl(raw);
  if (gallery) return gallery;
  const uuid = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  if (uuid) return `md:${uuid.toLowerCase()}`;

  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const segs = u.pathname
      .split('/')
      .filter(Boolean)
      .map((s) => decodeURIComponent(s).toLowerCase());

    const afterMarker = (marker: string): string | null => {
      const i = segs.findIndex((s) => s.toLowerCase() === marker);
      return i >= 0 && segs[i + 1] ? segs[i + 1] : null;
    };

    if (/mangadex/.test(host)) {
      const u2 = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      return `md:${u2?.[0] ?? afterMarker('title') ?? segs[segs.length - 1] ?? ''}`;
    }
    if (/mangamello/.test(host)) return `me:${afterMarker('manga') ?? afterMarker('mangas') ?? ''}`;
    if (/senkuro\./.test(host)) return `sk:${afterMarker('manga') ?? ''}`;
    if (/manga-shi\./.test(host)) return `ms:${afterMarker('manga') ?? ''}`;
    if (/remanga\./.test(host)) return `rm:${afterMarker('manga') ?? ''}`;
    // Mangalib URLs are /<locale?>/<numeric-id>--<slug>[/read/v…/c…]: the
    // chapter path has NO "manga" marker, so the old fallback (last segment =
    // "c5") produced a different key per chapter — every chapter became its own
    // history/library row. The numeric slug segment is the series identity.
    if (/hentailib/.test(host)) {
      const slug = segs.find((s) => /^\d+--/.test(s)) ?? afterMarker('manga') ?? segs[segs.length - 1] ?? '';
      return `hl:${slug}`;
    }
    if (/mangalib|^libmir|^chzz/.test(host)) {
      const slug = segs.find((s) => /^\d+--/.test(s)) ?? afterMarker('manga') ?? segs[segs.length - 1] ?? '';
      return `ml:${slug}`;
    }
    if (/com-x/.test(host)) {
      const readerNews = raw.match(/\/reader\/(\d+)/)?.[1];
      const catalogNews = raw.match(/\/(?:online\/)?(\d+)-[\w-]+\.html/i)?.[1];
      return `cx:${readerNews ?? catalogNews ?? ''}`;
    }
    if (/readmanga|^mintmanga|mangapoisk/.test(host)) return `gr:${segs[0] ?? ''}`;
  } catch {
    /* not URL-shaped */
  }
  return null;
}

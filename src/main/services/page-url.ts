export interface PageUrl {
  gid: string;
  index: number;
  /** `?thumb=1`: requested by the thumbnail panel, so it must not jump the
   * load queue ahead of the page the user is actually reading. */
  thumb?: boolean;
}

/**
 * Parses the renderer's page URLs. The renderer requests pages as
 * `manga://page/<galleryId>/<index>` (so the id is the first path segment),
 * but for backward compatibility `manga://<galleryId>/<index>` is also
 * accepted (id in the hostname).
 */
export function parseMangaPageUrl(raw: string): PageUrl | null {
  try {
    const url = new URL(raw);
    const parts = url.pathname.split('/').filter(Boolean);
    let gid: string;
    let index: number;
    if (url.hostname === 'page') {
      gid = parts[0];
      index = Number(parts[1]);
    } else {
      gid = url.hostname;
      index = Number(parts[0]);
    }
    if (!gid || !Number.isInteger(index) || index < 0) return null;
    return url.searchParams.has('thumb') ? { gid, index, thumb: true } : { gid, index };
  } catch {
    return null;
  }
}

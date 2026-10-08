export interface PageUrl {
  gid: string;
  index: number;
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
    return { gid, index };
  } catch {
    return null;
  }
}

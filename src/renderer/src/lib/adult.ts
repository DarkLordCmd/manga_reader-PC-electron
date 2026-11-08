/**
 * Adult flag for rows that predate the 18+ badge: Manga-shi's listing has no
 * reliable age signal, so the flag is resolved from the title's tags on demand.
 */
export function mangashiTitleUrl(url: string): string {
  const m = url.match(/^(https?:\/\/manga-shi\.[^/]+\/manga\/[^/]+\/)/i);
  return m ? m[1] : url;
}

/** True when the work is 18+. `known` short-circuits for rows already in R34. */
export async function resolveAdultFlag(url: string, known: boolean): Promise<boolean> {
  if (known) return true;
  if (!/manga-shi\./i.test(url)) return false;
  const titleUrl = mangashiTitleUrl(url);
  try {
    const resolved = await window.api.catalogAdultBatch([titleUrl]);
    return resolved[titleUrl] === true;
  } catch {
    return false;
  }
}

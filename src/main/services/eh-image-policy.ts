/** Whether a page image may skip Tor. The EH CDN (ehgt.org / H@H hath.network)
 * is public clearnet; the gallery and /s/ viewer pages still go through Tor.
 * Only used when the user opts in — the CDN otherwise sees the real IP. */
export function isEhCdnHost(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
    if (h.endsWith('.onion')) return false;
    return h === 'ehgt.org' || h.endsWith('.ehgt.org') || h === 'hath.network' || h.endsWith('.hath.network');
  } catch {
    return false;
  }
}

export function shouldUseDirectEhImage(
  directImages: boolean,
  proxy: string | undefined,
  url: string,
): boolean {
  return !!directImages && !!proxy && isEhCdnHost(url);
}

/** Cookies are domain-scoped to the gallery host; leaking them to a CDN on a
 * direct request is both useless and a session-token exposure. */
export function withoutCookieHeader(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([k]) => k.toLowerCase() !== 'cookie'));
}

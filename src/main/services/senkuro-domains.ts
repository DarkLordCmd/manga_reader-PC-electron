/**
 * Senkuro is served from two interchangeable web domains. The app targets
 * `senkuro.me` (its API lives on `api.senkuro.me`), but DDoS-Guard sometimes
 * hard-blocks the whole `.me` zone for a user's network — the browser shows
 * "senkuro.me недоступен / Владелец сайта запретил доступ из вашей сети".
 * The `senkuro.com` mirror keeps opening for that network, so the login flow
 * can be completed there; the collected session cookies are still sent to the
 * API exactly as before.
 */

const APEX_SWAP: Record<string, string> = {
  'senkuro.me': 'senkuro.com',
  'senkuro.com': 'senkuro.me',
};

/** True for the site itself and any of its subdomains. */
export function isSenkuroHost(rawUrl: string): boolean {
  try {
    return /(^|\.)senkuro\.(me|com)$/i.test(new URL(rawUrl).hostname);
  } catch {
    return false;
  }
}

/**
 * The same path/query/hash on the sibling apex domain, or null when the URL is
 * not one of the two apex hosts. Subdomains are deliberately NOT rewritten:
 * `sso.`/`api.` mirrors may not exist, and inventing them would turn a blocked
 * page into a dead one.
 */
export function senkuroAlternateUrl(rawUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  const alt = APEX_SWAP[u.hostname.toLowerCase()];
  if (!alt) return null;
  const out = new URL(u.toString());
  out.hostname = alt;
  return out.toString();
}

/** Phrases DDoS-Guard uses on the hard "your network is banned" page (the one
 * in the screenshot). A JS challenge ("Проверяем браузер…") must NOT match:
 * that page resolves itself and reloading would wipe the user's input. */
const BLOCK_MARKERS = [
  'запретил доступ из вашей сети',
  'владелец сайта запретил',
  'access from your network',
  'owner of this website has banned',
  'you have been blocked',
  'access to this site is blocked',
];

export function looksLikeAccessBlock(pageText: string): boolean {
  const text = String(pageText ?? '');
  if (!text) return false;
  const lower = text.toLowerCase();
  if (BLOCK_MARKERS.some((m) => lower.includes(m))) return true;
  // Guard-branded "site is unavailable" variant without the exact sentence.
  return /ddos-?guard/i.test(text) && /недоступ/i.test(text);
}

/** URL to load instead when the rendered page is an access block. Null means
 * "keep the current page" (no block, or no known mirror). */
export function senkuroFallbackUrl(currentUrl: string, pageText: string): string | null {
  return looksLikeAccessBlock(pageText) ? senkuroAlternateUrl(currentUrl) : null;
}

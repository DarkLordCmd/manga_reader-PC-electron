import { app } from 'electron';

/**
 * Outbound User-Agent policy.
 *
 * The browser-shaped UA stays the default: Cloudflare-protected sources
 * (nhentai, EH mirrors, RU aggregators) expect one and reject anything else.
 *
 * MangaDex is the exception. Its edge now runs a bot check that answers a
 * browser-looking UA without the challenge cookie with `302 Found` to
 * `https://mangadex.org/edge/challenge?src=…`, and the challenge response that
 * follows is `403 "Bot challenge not passed"` — which is exactly what surfaced
 * as `catalog:search` failing. A UA whose product name is the app itself is
 * served normally (and is what the API terms ask for), so every
 * mangadex.org / mangadex.network host gets that instead.
 */
export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const APP_NAME = 'manga_reader-electron';
const APP_HOMEPAGE = 'https://github.com/DarkLordCmd/manga_reader-PC-electron';

let cachedAppUa: string | null = null;

/** `<app>/<version> (Electron; +repo)` — identifies the client, never claims a browser. */
export function mangaDexUserAgent(): string {
  if (cachedAppUa) return cachedAppUa;
  let version = '1.0';
  try {
    const v = app?.getVersion?.();
    if (typeof v === 'string' && v.trim() !== '') version = v.trim();
  } catch {
    /* not inside Electron main (unit tests) — keep the fallback version */
  }
  cachedAppUa = `${APP_NAME}/${version} (Electron; +${APP_HOMEPAGE})`;
  return cachedAppUa;
}

const MANGADEX_HOST_RE = /(^|\.)mangadex\.(org|network)$/i;

export function isMangaDexHostUrl(url: string): boolean {
  try {
    return MANGADEX_HOST_RE.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Per-host UA for a single request: MangaDex gets the app UA, everyone else the browser UA. */
export function userAgentForUrl(url: string): string {
  return isMangaDexHostUrl(url) ? mangaDexUserAgent() : BROWSER_UA;
}

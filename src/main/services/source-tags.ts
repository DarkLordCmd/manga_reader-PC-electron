import * as cheerio from 'cheerio';
import { httpFetch } from './http';
import type { Settings } from '@shared/settings';

/**
 * Tags for sources whose *listing* does not carry them.
 *
 * MangaDex and E-Hentai expose tags in search results already; nhentai, Senkuro
 * and Manga-shi only show them on the title page, so they are fetched lazily
 * when the chapter menu opens (one request per open).
 */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

async function fetchHtml(
  url: string,
  settings: Settings,
  opts: { torSocks: string },
  siteKey: string | null,
  cookie?: string,
  hx = false,
): Promise<string | null> {
  const useTor = url.includes('.onion') || (siteKey ? settings.tor_proxied_sites.includes(siteKey) : false);
  const proxy = useTor ? opts.torSocks : undefined;
  try {
    const r = await httpFetch(
      {
        url,
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          // Manga-shi answers htmx requests with the page fragment only
          // (~93 KB instead of ~226 KB) and it already contains the JSON-LD.
          ...(hx ? { 'HX-Request': 'true', 'HX-Target': 'page-content' } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        timeoutMs: proxy ? 60_000 : 20_000,
      },
      proxy,
    );
    return r.status < 400 && r.text ? r.text : null;
  } catch {
    return null;
  }
}

function uniq(list: string[], max = 40): string[] {
  return [...new Set(list.map((t) => t.trim()).filter(Boolean))].slice(0, max);
}

function textsOf($: cheerio.CheerioAPI, selector: string): string[] {
  const out: string[] = [];
  for (const el of $(selector).toArray()) out.push($(el).text());
  return out;
}

async function nhentaiTags(url: string, settings: Settings, opts: { torSocks: string }): Promise<string[]> {
  const isOnion = url.includes('.onion');
  const html = await fetchHtml(
    url,
    settings,
    opts,
    'nhentai',
    isOnion ? settings.nhentai_onion_cookies_raw : settings.nhentai_cookies_raw,
  );
  if (!html) return [];
  const $ = cheerio.load(html);
  let out = textsOf($, '.tag .name, .tags .name, a.tag .name');
  if (out.length === 0) {
    for (const el of $('[data-tags]').toArray()) {
      out.push(...String($(el).attr('data-tags') ?? '').split(','));
    }
  }
  return uniq(out);
}

async function mangashiTags(url: string, settings: Settings, opts: { torSocks: string }): Promise<string[]> {
  const html = await fetchHtml(url, settings, opts, 'mangashi', undefined, true);
  if (!html) return [];
  const $ = cheerio.load(html);
  const out: string[] = [];
  // The page embeds schema.org JSON-LD with a `genre` array.
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    try {
      const json = JSON.parse($(el).text()) as any;
      const nodes = Array.isArray(json) ? json : json?.['@graph'] ? json['@graph'] : [json];
      for (const node of nodes) {
        const g = node?.genre;
        if (Array.isArray(g)) out.push(...g.map(String));
        else if (typeof g === 'string') out.push(...g.split(','));
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  }
  if (out.length === 0) out.push(...textsOf($, 'a[href*="/genre/"], a[href*="/tag/"]'));
  return uniq(out);
}

export async function fetchSourceTags(
  url: string,
  settings: Settings,
  opts: { torSocks: string },
): Promise<string[]> {
  const host = hostOf(url);
  if (!host) return [];
  if (/nhentai\.(net|org)$/i.test(host)) return await nhentaiTags(url, settings, opts);
  // Senkuro is handled from its GraphQL catalog (labels) — the title page is
  // behind a 403 for non-browser clients.
  if (/manga-shi\./i.test(host)) return await mangashiTags(url, settings, opts);
  return [];
}

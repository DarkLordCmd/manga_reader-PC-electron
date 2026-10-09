import * as cheerio from 'cheerio';
import { httpFetch, httpPostJson } from './http';

export interface EhTag {
  ns: string;
  tn: string;
  display: string;
}

export async function fetchEhTagSuggest(
  text: string,
  opts: { proxy?: string; cookieHeader?: string; timeoutMs?: number } = {},
): Promise<EhTag[]> {
  if (text.trim().length < 2) return [];
  const timeout = opts.timeoutMs ?? (opts.proxy ? 30_000 : 10_000);
  const body = JSON.stringify({ method: 'tagsuggest', text });
  try {
    const json = await httpPostJson(
      'https://api.e-hentai.org/api.php',
      body,
      {
        ...(opts.cookieHeader ? { Cookie: opts.cookieHeader } : {}),
      },
      opts.proxy,
      timeout,
    );
    const entries: any[] = Array.isArray((json as any)?.tags) ? (json as any).tags : Object.values((json as any)?.tags ?? {});
    const tags: EhTag[] = [];
    for (const t of entries) {
      if (typeof t?.ns === 'string' && typeof t?.tn === 'string') {
        tags.push({ ns: t.ns, tn: t.tn, display: `${t.ns}:${t.tn}` });
      }
    }
    // dedup
    const seen = new Set<string>();
    return tags.filter((t) => (seen.has(t.display) ? false : (seen.add(t.display), true)));
  } catch {
    return [];
  }
}

export interface NhentaiTag {
  name: string;
  count: number;
}

export async function fetchNhentaiTagSuggestions(query: string, opts: { proxy?: string } = {}): Promise<NhentaiTag[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const r = await httpFetch(
    {
      url: 'https://nhentai.to/tags/',
      headers: { Referer: 'https://nhentai.to/' },
      timeoutMs: 20_000,
    },
    opts.proxy,
  );
  if (r.status >= 400) return [];
  const $ = cheerio.load(r.text);

  // letter pages nav: href="?page=N#letter"
  const letterPages = new Map<string, number>();
  $('a[href*="?page="]').each((_i, el) => {
    const href = $(el).attr('href') ?? '';
    const m = href.match(/\?page=(\d+)#([a-z0-9]+)/i);
    if (m) letterPages.set(m[2].toLowerCase(), Number(m[1]));
  });

  const firstChar = q[0];
  const key = /[0-9]/.test(firstChar) ? 'num' : firstChar.toLowerCase();
  const pageNum = letterPages.get(key);
  if (pageNum == null) return [];

  const pageUrl = pageNum > 1 ? `https://nhentai.to/tags/?page=${pageNum}` : 'https://nhentai.to/tags/';
  const page2 = await httpFetch(
    {
      url: pageUrl,
      headers: { Referer: 'https://nhentai.to/' },
      timeoutMs: 20_000,
    },
    opts.proxy,
  );
  if (page2.status >= 400) return [];
  const $2 = cheerio.load(page2.text);

  const results: NhentaiTag[] = [];
  $2('a[href*="/tag/"]').each((_i, el) => {
    const $el = $2(el);
    const name = $el.attr('title')?.trim() || $el.find('.name').text().trim() || $el.text().trim();
    if (!name || !name.toLowerCase().includes(q)) return;
    const countM = $el.text().match(/(\d[\d,]*)/);
    results.push({ name, count: countM ? Number(countM[1].replace(/,/g, '')) : 0 });
  });
  return results.slice(0, 15);
}

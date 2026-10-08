import * as cheerio from 'cheerio';
import { httpFetch } from './http';

export interface ArchiveCost {
  costGp: number | null;
  options: { key: string; label: string }[];
  archiverUrl: string;
}

export function parseArchiverPage(html: string): ArchiveCost | null {
  if (html.includes('You have exceeded your usage limit') || html.trim() === '') return null;
  const $ = cheerio.load(html);
  const form = $('form[action*="archiver"]').first();
  if (form.length === 0) return null;
  const archiverUrl = form.attr('action') ?? '';
  const text = form.text();
  const m = text.match(/(\d+)\s*GP/i);
  const options = form
    .find('input[type=radio][name=dltype]')
    .toArray()
    .map((el) => ({
      key: $(el).attr('value') ?? '',
      label: $(el).parent().text().replace(/\s+/g, ' ').trim() || ($(el).attr('value') ?? ''),
    }));
  return { costGp: m ? Number(m[1]) : null, options, archiverUrl };
}

export async function fetchArchiveCost(url: string, opts: { cookieHeader?: string; proxy?: string }): Promise<ArchiveCost | null> {
  const r = await httpFetch({ url, headers: { Referer: url, ...(opts.cookieHeader ? { Cookie: opts.cookieHeader } : {}) } }, opts.proxy);
  return parseArchiverPage(r.text);
}

export async function buyArchive(
  url: string,
  opts: { cookieHeader?: string; proxy?: string; dltype?: string },
): Promise<{ downloadUrl: string } | null> {
  const r = await httpFetch(
    {
      url,
      method: 'POST',
      body: `dltype=${encodeURIComponent(opts.dltype ?? 'org')}&dlcheck=Download`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: url,
        ...(opts.cookieHeader ? { Cookie: opts.cookieHeader } : {}),
      },
    },
    opts.proxy,
  );
  // Response contains a link like /dl/<hash>/<gid>-<token>.zip or full URL
  const m = r.text.match(/https?:\/\/[^"'\s]+\.zip[^"'\s]*/);
  if (m) return { downloadUrl: m[0] };
  const m2 = r.text.match(/href=["']([^"']+\.zip[^"']*)["']/);
  if (m2) return { downloadUrl: m2[1].startsWith('http') ? m2[1] : new URL(m2[1], url).toString() };
  const m3 = r.text.match(/["'](\/dl\/[^"'\s]+\.zip)["']/);
  if (m3) return { downloadUrl: new URL(m3[1], url).toString() };
  return null;
}

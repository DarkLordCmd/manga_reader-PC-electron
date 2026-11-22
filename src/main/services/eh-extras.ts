import * as cheerio from 'cheerio';
import { httpFetch } from './http';
import { UA, TOR_UA } from './sources/catalog-types';
import { logger } from './logger';

export interface EHTorrent {
  title: string;
  size: string;
  seeds: number;
  peers: number;
  downloads: number;
  uploader: string;
  posted: string;
  torrentUrl: string;
  magnet: string;
  outdated: boolean;
}

export interface EHComment {
  author: string;
  text: string;
  uploader: boolean;
}

export interface EHGalleryInfo {
  title: string;
  uploader: string;
  posted: string;
  parent: string;
  visible: string;
  language: string;
  fileSize: string;
  length: string;
  rating: number | null;
  ratingCount: number | null;
  tags: { namespace: string; key: string }[];
  comments: EHComment[];
}

export interface EHFavoriteItem {
  url: string;
  title: string;
  coverUrl: string | null;
}

interface FetchOpts {
  cookieHeader?: string;
  proxy?: string;
}

function gidToken(url: string): { gid: string; token: string; origin: string } | null {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/g\/(\d+)\/([0-9a-z]+)/i);
    if (!m) return null;
    return { gid: m[1], token: m[2], origin: u.origin };
  } catch {
    return null;
  }
}

/** E-Hentai serves torrents/archiver/home only on the clearnet galleries; the
 * onion mirror 404s those pages. Keep the user's route (proxy) but swap the
 * host so the feature also works for onion-only sources. */
function clearnetOrigin(original: string): string {
  try {
    const host = new URL(original).hostname;
    return host.endsWith('.onion') ? 'https://e-hentai.org' : new URL(original).origin;
  } catch {
    return 'https://e-hentai.org';
  }
}

function ua(proxy?: string): string {
  return proxy ? TOR_UA : UA;
}

/** Torrents of a gallery (the site's own "Torrents" popup). */
export async function fetchEhTorrents(url: string, opts: FetchOpts): Promise<EHTorrent[]> {
  const gt = gidToken(url);
  if (!gt) return [];
  const target = `${clearnetOrigin(url)}/gallerytorrents.php?gid=${gt.gid}&t=${gt.token}`;
  // The torrents popup is public; sending the (possibly stale) account cookie
  // made e-hentai answer a redirect instead of the page, so it is omitted here.
  const r = await httpFetch(
    {
      url: target,
      headers: { 'User-Agent': UA, Referer: url },
      timeoutMs: opts.proxy ? 60_000 : 30_000,
    },
    opts.proxy,
  );
  logger.info('[eh-torrents]', target, 'status=', r.status, 'len=', r.text.length);
  if (r.status >= 400) return [];
  const $ = cheerio.load(r.text);
  const list: EHTorrent[] = [];  $('#torrentinfo form').each((_i, form) => {
    const $f = $(form);
    const trs = $f.find('table tr');
    const rowText = (i: number): string =>
      trs
        .eq(i)
        .text()
        .replace(/\s+/g, ' ')
        .trim();
    const row0 = rowText(0);
    const a = $f.find('a[href*=".torrent"]').first();
    const torrentUrl = a.attr('href') ?? '';
    const title = a.text().trim();
    if (!title) return;
    const hash = torrentUrl.match(/([0-9a-f]{40})\.torrent/i)?.[1] ?? '';
    list.push({
      title,
      posted: row0.match(/Posted:\s*([\d-]+\s+[\d:]+)/)?.[1] ?? '',
      size: row0.match(/Size:\s*([\d.,]+\s*\w+)/)?.[1] ?? '',
      seeds: Number(row0.match(/Seeds:\s*(\d+)/)?.[1] ?? 0),
      peers: Number(row0.match(/Peers:\s*(\d+)/)?.[1] ?? 0),
      downloads: Number(row0.match(/Downloads:\s*(\d+)/)?.[1] ?? 0),
      uploader: rowText(1).match(/Uploader:\s*(.+)$/)?.[1]?.trim() ?? '',
      torrentUrl,
      magnet: hash ? `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}` : '',
      outdated: /color:\s*red/i.test($f.find('span').first().attr('style') ?? ''),
    });
  });
  return list;
}

/** Gallery page metadata + comments (`#gdd`, `#taglist`, `#cdiv`). Read-only:
 * posting comments/ratings is intentionally not exposed. */
export async function fetchEhGalleryInfo(url: string, opts: FetchOpts): Promise<EHGalleryInfo> {
  const r = await httpFetch(
    {
      url,
      headers: {
        'User-Agent': ua(opts.proxy),
        Referer: url,
        ...(opts.cookieHeader ? { Cookie: opts.cookieHeader } : {}),
      },
      timeoutMs: opts.proxy ? 90_000 : 45_000,
    },
    opts.proxy,
  );
  if (r.status >= 400 || !r.text) throw new Error(`ExHentai: страница галереи не открылась (HTTP ${r.status})`);
  const $ = cheerio.load(r.text);
  const info = (label: string): string => {
    let out = '';
    $('#gdd tr').each((_i, tr) => {
      const k = $(tr).find('.gdt1').text().replace(':', '').trim();
      if (k.toLowerCase() === label.toLowerCase()) out = $(tr).find('.gdt2').text().trim();
    });
    return out;
  };
  const ratingText = $('#rating_label').text();
  const rating = Number(ratingText.match(/([\d.]+)/)?.[1] ?? NaN);
  const tags: { namespace: string; key: string }[] = [];
  $('#taglist tr').each((_i, tr) => {
    const ns = $(tr).find('td.tc').text().replace(':', '').trim();
    $(tr)
      .find('a')
      .each((_j, a) => {
        const href = $(a).attr('href') ?? '';
        const m = href.match(/\/tag\/([^:"/?]+):(.+)$/);
        if (m) tags.push({ namespace: m[1], key: decodeURIComponent(m[2]) });
      });
  });
  const comments: EHComment[] = [];
  $('#cdiv .c1').each((_i, c) => {
    if (comments.length >= 30) return;
    const author = $(c).find('.c3').text().replace(/\s+/g, ' ').replace(/^Posted on [^b]*by:\s*/i, '').trim();
    const text = $(c).find('.c6').text().replace(/\s+/g, ' ').trim();
    if (!text) return;
    comments.push({ author, text: text.slice(0, 1200), uploader: $(c).find('.c4').length > 0 });
  });
  return {
    title: ($('#gn').first().text().trim() || $('title').first().text().trim()).slice(0, 200),
    uploader: $('#gdn a').first().text().trim(),
    posted: info('Posted'),
    parent: info('Parent'),
    visible: info('Visible'),
    language: info('Language'),
    fileSize: info('File Size'),
    length: info('Length'),
    rating: isNaN(rating) ? null : rating,
    ratingCount: Number($('#rating_count').text()) || null,
    tags,
    comments,
  };
}

/** One page of the account's E-Hentai/ExHentai favorites (read-only import). */
export async function fetchEhFavorites(base: string, page: number, opts: FetchOpts): Promise<{ items: EHFavoriteItem[]; hasMore: boolean }> {
  const target = `${base}/favorites.php?favcat=all&page=${page}`;
  const r = await httpFetch(
    {
      url: target,
      headers: {
        'User-Agent': ua(opts.proxy),
        Referer: `${base}/favorites.php`,
        ...(opts.cookieHeader ? { Cookie: opts.cookieHeader } : {}),
      },
      timeoutMs: opts.proxy ? 90_000 : 45_000,
    },
    opts.proxy,
  );
  if (r.status >= 400 || !r.text) throw new Error(`ExHentai: избранное не открылось (HTTP ${r.status})`);
  if (/No hits found/i.test(r.text)) return { items: [], hasMore: false };
  const $ = cheerio.load(r.text);
  const items: EHFavoriteItem[] = [];
  const seen = new Set<string>();
  // The thumbnail anchor and the title anchor are separate nodes on the
  // favorites page, so collect covers per gallery href first.
  const covers = new Map<string, string>();
  $('a[href*="/g/"]').each((_i, a) => {
    const href = $(a).attr('href') ?? '';
    if (!/\/g\/\d+\/[0-9a-z]+\/?$/i.test(href)) return;
    const img = $(a).find('img[data-src], img[src]').first();
    const src = img.attr('data-src') ?? img.attr('src') ?? null;
    if (src && !/blank\.gif/i.test(src)) covers.set(href, src);
  });
  $('a[href*="/g/"]').each((_i, a) => {
    const href = $(a).attr('href') ?? '';
    if (!/\/g\/\d+\/[0-9a-z]+\/?$/i.test(href)) return;
    const title = $(a).text().replace(/\s+/g, ' ').trim();
    if (!title || seen.has(href)) return;
    const cover = covers.get(href) ?? null;
    let absolute = href;
    try {
      absolute = new URL(href, base).toString();
    } catch {
      /* keep as is */
    }
    const absoluteCover = cover
      ? (() => {
          try {
            return new URL(cover as string, base).toString();
          } catch {
            return cover;
          }
        })()
      : null;
    seen.add(href);
    items.push({ url: absolute, title, coverUrl: absoluteCover });
  });
  return { items, hasMore: items.length > 0 && page < 30 };
}

/** Checks that a captured EH login really authenticated: the login form must be
 * gone and the page must not be the empty "sad panda" body. A guest jar from a
 * closed window (only `onikakushi`) used to be saved as a valid session and every
 * catalog request then returned an empty page. */
export async function verifyEhLogin(
  url: string,
  cookieHeader: string,
  proxy?: string,
): Promise<{ ok: boolean; reason: string }> {
  try {
    const r = await httpFetch(
      {
        url,
        headers: {
          'User-Agent': ua(proxy),
          Cookie: cookieHeader,
        },
        timeoutMs: proxy ? 60_000 : 30_000,
      },
      proxy,
    );
    if (!r.text || r.text.trim().length === 0) {
      return { ok: false, reason: 'сайт отдал пустую страницу — сессия не авторизована' };
    }
    if (/oni_user|name="UserName"|name="PassWord"|input\[type="password"\]/i.test(r.text)) {
      return { ok: false, reason: 'страница входа всё ещё показывается (капча или неверный пароль)' };
    }
    if (/sad panda|poni=no/i.test(r.text)) {
      return { ok: false, reason: 'сайт показывает sad panda — аккаунт не имеет доступа к ExHentai' };
    }
    return { ok: true, reason: 'ok' };
  } catch (e) {
    return { ok: false, reason: `проверка сессии не удалась: ${(e as Error)?.message ?? e}` };
  }
}

/** H@H download request: POST to the gallery's archiver page with the chosen
 * resolution; the site answers a status paragraph (`#db > p`). */
export async function ehHathDownload(url: string, resolution: string, opts: FetchOpts): Promise<string> {
  const gt = gidToken(url);
  if (!gt) throw new Error('Не удалось определить gid/токен галереи');
  const archiver = `${clearnetOrigin(url)}/archiver.php?gid=${gt.gid}&token=${gt.token}`;
  const r = await httpFetch(
    {
      url: archiver,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': ua(opts.proxy),
        Referer: url,
        ...(opts.cookieHeader ? { Cookie: opts.cookieHeader } : {}),
      },
      body: new URLSearchParams({ hathdl_xres: resolution }).toString(),
      timeoutMs: opts.proxy ? 120_000 : 60_000,
    },
    opts.proxy,
  );
  if (r.status >= 400) throw new Error(`Сайт ответил HTTP ${r.status} на запрос H@H`);
  const $ = cheerio.load(r.text);
  return ($('#db > p').first().text() || $('#db').first().text() || r.text.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
}
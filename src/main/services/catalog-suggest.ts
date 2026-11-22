import type { SearchSuggestion } from '@shared/ipc';
import { SENKURO_STATUS, SENKURO_TRANSLATION } from '@shared/filters';
import { httpPostJson } from './http';
import { searchMangaDex } from './mangadex';
import { searchRemanga } from './sources/remanga';
import { searchNhentai } from './sources/nhentai';
import { senkuroHeaders, senkuroAge18 } from './sources/senkuro';
import { fetchEhTagSuggest } from './tags';
import { logger } from './logger';

export interface SuggestDeps {
  senkuroCookie: string;
  senkuroProxy?: string;
  remangaProxy?: string;
  ehCookie: string;
  ehProxy?: string;
  nhentaiBase: string;
  nhentaiCookie: string;
  nhentaiProxy?: string;
}

const SK_STATUS = new Map(SENKURO_STATUS);
const SK_TRANSLATION = new Map(SENKURO_TRANSLATION);

function number(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Senkuro's new site uses a persisted (`search`) operation on the NEW API host,
 * which matches RUSSIAN titles too — the old `mangas(search:)` on api.senkuro.me
 * only matched English slugs. One small request, exactly what the site's search
 * overlay shows. */
const SENKURO_SEARCH_HASH = '43cdedb6f6d2c0bba04815c4e6822558c37f655976cb6bc722361f71905bf5fd';
const SENKURO_KIND = new Map<string, string>([
  ['MANGA', 'Манга'],
  ['MANHWA', 'Манхва'],
  ['MANHUA', 'Маньхуа'],
  ['COMICS', 'Комикс'],
  ['OEL_MANGA', 'OEL Манга'],
  ['RU_MANGA', 'РуМанга'],
]);

async function senkuroSuggest(q: string, deps: SuggestDeps): Promise<SearchSuggestion[]> {
  let json: any;
  try {
    json = await httpPostJson(
      'https://api.senkuro.com/graphql',
      JSON.stringify({
        extensions: { persistedQuery: { sha256Hash: SENKURO_SEARCH_HASH, version: 1 } },
        operationName: 'search',
        variables: { query: q, type: 'MANGA' },
      }),
      {
        'App-Id': '4026531840100',
        'App-Version': '201126',
        Origin: 'https://ne.senkuro.com',
        Referer: 'https://ne.senkuro.com/',
        Accept: 'application/graphql-response+json, application/json',
      },
      deps.senkuroProxy,
    );
  } catch (e) {
    logger.info('[catalog-suggest] senkuro new API failed, falling back', (e as Error)?.message ?? e);
    json = null;
  }
  const edges: any[] = json?.data?.search?.edges ?? [];
  if (edges.length === 0) {
    // Fallback: old API (English-only matching, better than nothing).
    const gql = JSON.stringify({
      query: `query { mangas(first: 8, search: ${JSON.stringify(q)}) { edges { node { slug titles { lang content } type status translitionStatus score cover { original { url } } } } } }`,
    });
    const old = (await httpPostJson(
      'https://api.senkuro.me/graphql',
      gql,
      { ...senkuroHeaders(deps.senkuroCookie), Referer: 'https://senkuro.me/browse/manga' },
      deps.senkuroProxy,
    )) as any;
    const oldEdges: any[] = old?.data?.mangas?.edges ?? [];
    return oldEdges.map((e) => senkuroRow(e?.node ?? {}));
  }
  return edges.map((e) => senkuroRow(e?.node ?? {}));
}

function senkuroRow(n: any): SearchSuggestion {
  const titles: any[] = n?.titles ?? [];
  const title = titles.find((t) => t?.lang === 'RU')?.content ?? titles.find((t) => t?.lang === 'EN')?.content ?? n?.originalName ?? 'Без названия';
  const kind = SENKURO_KIND.get(String(n?.mangaType ?? n?.type ?? '')) ?? '';
  const status = SK_STATUS.get(String(n?.mangaStatus ?? n?.status ?? '')) ?? null;
  const translation = SK_TRANSLATION.get(String(n?.translitionStatus ?? '')) ?? null;
  const score = number(n?.score);
  const meta = [kind, score != null ? `★ ${score.toFixed(2)}` : null, status, translation].filter(Boolean).join(' · ');
  return {
    kind: 'work',
    title,
    url: `https://senkuro.me/manga/${n?.slug ?? ''}/`,
    coverUrl: n?.cover?.preview?.url ?? n?.cover?.original?.url ?? null,
    meta: meta || null,
    status,
    age18: senkuroAge18(n?.mangaRating ?? n?.rating),
  };
}

/** One autocomplete call per source, each hitting that source's own site/API.
 * Sources without a lightweight search endpoint return [] and the UI simply
 * does not show a dropdown. */
export async function catalogSuggest(source: string, query: string, deps: SuggestDeps): Promise<SearchSuggestion[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    switch (source) {
      case 'senkuro':
        return await senkuroSuggest(q, deps);
      case 'mangadex': {
        const cards = await searchMangaDex(q, 'relevance', 0);
        return cards.slice(0, 6).map((c) => ({
          kind: 'work' as const,
          title: c.title,
          url: c.manga_id,
          coverUrl: c.cover_url,
          meta: [c.kind, number(c.score) != null ? `★ ${number(c.score)!.toFixed(1)}` : null].filter(Boolean).join(' · ') || null,
          age18: c.adult === true,
        }));
      }
      case 'remanga': {
        const items = await searchRemanga(q, 0, {}, deps.remangaProxy);
        return items.slice(0, 6).map((c) => ({
          kind: 'work' as const,
          title: c.title,
          url: c.url,
          coverUrl: c.coverUrl,
          meta: [c.kind, number(c.score) != null ? `★ ${number(c.score)!.toFixed(1)}` : null].filter(Boolean).join(' · ') || null,
          age18: c.adult === true,
        }));
      }
      case 'nhentai':
      case 'nhentai_onion': {
        const items = await searchNhentai(deps.nhentaiBase, q, 0, { cookieHeader: deps.nhentaiCookie, proxy: deps.nhentaiProxy });
        return items.slice(0, 6).map((c) => ({
          kind: 'work' as const,
          title: c.title,
          url: c.url,
          coverUrl: c.coverUrl,
          meta: [c.kind, c.pages ? `${c.pages} стр.` : null].filter(Boolean).join(' · ') || null,
          age18: true,
        }));
      }
      case 'exhentai':
      case 'exhentai_onion':
      case 'ehentai': {
        // E-Hentai has no gallery autocomplete; its own search box suggests
        // TAGS, so the dropdown offers tags and appends the chosen one.
        const tags = await fetchEhTagSuggest(q, { proxy: deps.ehProxy, cookieHeader: deps.ehCookie });
        return tags.slice(0, 8).map((t) => ({
          kind: 'tag' as const,
          title: t.tn,
          subtitle: t.ns,
          tag: `${t.ns}:${t.tn}`,
          meta: t.ns,
        }));
      }
      default:
        return [];
    }
  } catch (e) {
    logger.info('[catalog-suggest] failed', source, (e as Error)?.message ?? e);
    return [];
  }
}

import { httpPostJson } from './http';

/** R34 (NSFW) on Senkuro is not the same as the age rating: EXPLICIT is also
 * used for violent/gory action and horror. The sexual signal is the label set
 * (`hentai`/`smut`/…); `erotica`/`ecchi` alone is soft and stays in Main. */
const HARD_LABELS = new Set(['hentai', 'smut', 'pornographic', 'adult_content', 'sexual_content', 'porn']);

export function senkuroLabelsAreR34(labels: unknown): boolean {
  if (!Array.isArray(labels)) return false;
  return labels.some((l) => {
    const slug = typeof l === 'string' ? l : (l as { slug?: unknown })?.slug;
    return HARD_LABELS.has(String(slug ?? '').toLowerCase());
  });
}

interface FlagEntry {
  r34: boolean;
  at: number;
}
const flagCache = new Map<string, FlagEntry>();
const CACHE_TTL_MS = 30 * 24 * 60 * 60_000;
const CACHE_MAX = 2500;

function tokenFromCookies(raw: string): string {
  return (
    (raw ?? '')
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('access_token='))
      ?.slice('access_token='.length) ?? ''
  );
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Batched label lookup (`manga(slug:)` aliases) with a session cache. Returns
 * the slugs it could resolve; failed batches are omitted so callers can fall
 * back to the age rating instead of silently claiming "not R34". */
export async function fetchSenkuroR34Flags(
  slugs: string[],
  opts: { cookieHeader?: string; proxy?: string; batchSize?: number } = {},
): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  const need: string[] = [];
  for (const slug of slugs) {
    const hit = flagCache.get(slug);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) out.set(slug, hit.r34);
    else if (!need.includes(slug)) need.push(slug);
  }
  if (need.length === 0) return out;
  const size = Math.max(5, Math.min(25, opts.batchSize ?? 20));
  const token = tokenFromCookies(opts.cookieHeader ?? '');
  for (let i = 0; i < need.length; i += size) {
    const batch = need.slice(i, i + size);
    const query = `query { ${batch
      .map((slug, j) => `m${j}: manga(slug: ${JSON.stringify(slug)}) { slug labels { slug } }`)
      .join(' ')} }`;
    try {
      const json = (await httpPostJson(
        'https://api.senkuro.me/graphql',
        JSON.stringify({ query }),
        {
          'Content-Type': 'application/json',
          'App-Id': '4026531840100',
          'App-Version': '201126',
          Origin: 'https://senkuro.me',
          Referer: 'https://senkuro.me/browse/manga',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        opts.proxy,
      )) as any;
      if (json?.errors?.length) throw new Error(String(json.errors[0]?.message ?? 'GraphQL error'));
      for (const node of Object.values(json?.data ?? {}) as any[]) {
        if (typeof node?.slug !== 'string') continue;
        const r34 = senkuroLabelsAreR34(node.labels);
        out.set(node.slug, r34);
        if (flagCache.size >= CACHE_MAX) {
          const oldest = flagCache.keys().next().value;
          if (oldest !== undefined) flagCache.delete(oldest);
        }
        flagCache.set(node.slug, { r34, at: Date.now() });
      }
    } catch {
      /* retry next time; caller uses the age-rating fallback */
    }
    if (i + size < need.length) await sleep(200);
  }
  return out;
}

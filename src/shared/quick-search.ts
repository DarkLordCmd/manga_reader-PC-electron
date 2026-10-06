export interface QuickSearch {
  id: string
  name: string
  source: string
  query: string
}

export function normalizeQuickSearches(raw: unknown): QuickSearch[] {
  if (!Array.isArray(raw)) return []
  const out: QuickSearch[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    if (typeof o.id !== 'string' || !o.id || typeof o.name !== 'string') continue
    out.push({
      id: o.id,
      name: o.name,
      source: typeof o.source === 'string' && o.source ? o.source : 'exhentai',
      query: typeof o.query === 'string' ? o.query : ''
    })
  }
  return out
}

export function addQuickSearch(list: QuickSearch[], entry: QuickSearch): QuickSearch[] {
  return [...list, entry]
}

export function removeQuickSearch(list: QuickSearch[], id: string): QuickSearch[] {
  return list.filter((q) => q.id !== id)
}

export function moveQuickSearch(list: QuickSearch[], id: string, dir: 'up' | 'down'): QuickSearch[] {
  const i = list.findIndex((q) => q.id === id)
  if (i < 0) return list
  const j = dir === 'up' ? i - 1 : i + 1
  if (j < 0 || j >= list.length) return list
  const next = [...list]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

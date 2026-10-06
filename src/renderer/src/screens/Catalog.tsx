import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import type { CatalogCard, CatalogCursor, CatalogFilters, ChapterListItem, ExAccount } from '@shared/ipc'
import { EH_CATEGORIES, MANGASHI_TAGS, REMANGA_GENRES, MD_LANGS, MD_POPULAR_TAGS, NH_POPULAR_TAGS, SENKURO_STATUS, SENKURO_TYPE, SENKURO_FORMAT, SENKURO_RATING, SENKURO_ORDERING, COMX_CATEGORY, COMX_GENRE } from '@shared/filters'
import MangaCardGrid from '../components/MangaCardGrid'
import ContextMenu, { type MenuItem } from '../components/ContextMenu'
import Toggle from '../components/Toggle'
import type { ReadingStatus } from '@shared/library'
import { buildLibraryMenuItems } from '../lib/library-menu'
import { addQuickSearch, removeQuickSearch, moveQuickSearch, parseEhQueryToTags } from '@shared/quick-search'

const SOURCES: { key: string; label: string }[] = [
  { key: 'mangadex', label: 'MangaDex' },
  { key: 'exhentai', label: 'ExHentai' },
  { key: 'exhentai_onion', label: 'ExHentai (onion)' },
  { key: 'ehentai', label: 'E-Hentai' },
  { key: 'nhentai', label: 'NHentai' },
  { key: 'nhentai_onion', label: 'NHentai (onion)' },
  { key: 'comx', label: 'Com-X' },
  { key: 'senkuro', label: 'Senkuro' },
  { key: 'mangashi', label: 'Manga-shi' },
  { key: 'remanga', label: 'Remanga' },
  { key: 'mangalib', label: 'Mangalib' },
  { key: 'readmanga', label: 'Readmanga' },
  { key: 'mintmanga', label: 'Mintmanga' },
  { key: 'mangapoisk', label: 'Mangapoisk' },
  { key: 'mangamello', label: 'MangaMello' }
]

/** Sources hidden when the "show R34" privacy setting is off. */
const R34_SOURCES = ['exhentai', 'exhentai_onion', 'ehentai', 'nhentai', 'nhentai_onion']

const SORTS: { key: string; label: string }[] = [
  { key: 'relevance', label: 'По релевантности' },
  { key: 'rating', label: 'По рейтингу' },
  { key: 'latestUploadedChapter', label: 'Последние' },
  { key: 'followedCount', label: 'По подпискам' }
]

const MS_SORTS: [string, string][] = [
  ['', 'По умолчанию'], ['added', 'По дате добавления'], ['updated', 'По обновлению глав'],
  ['rating', 'По рейтингу'], ['popular', 'По популярности'], ['chapters', 'По количеству глав'], ['year', 'По году выпуска']
]
const MS_STATUS: [string, string][] = [['', 'Все'], ['ONGOING', 'Онгоинг'], ['COMPLETED', 'Завершён'], ['HIATUS', 'Хиатус']]
const MS_TYPES: [string, string][] = [['', 'Все'], ['MANGA', 'Манга'], ['MANHWA', 'Манхва'], ['MANHUA', 'Маньхуа'], ['WESTERN', 'Западный комикс']]
const MS_AGES: [string, string][] = [['', 'Все'], ['sfw', 'Без 18+'], ['adult', 'Только 18+']]

const RM_ORDERING: [string, string][] = [
  ['views', 'По умолчанию (просмотры)'], ['-rating', 'По рейтингу ▼'], ['rating', 'По рейтингу ▲'],
  ['-views', 'По просмотрам ▼'], ['-id', 'По добавлению ▼'], ['id', 'По добавлению ▲']
]
const RM_STATUS: [string, string][] = [['', 'Все'], ['1', 'Завершён'], ['2', 'Продолжается'], ['3', 'Заморожен']]
const RM_TYPES: [string, string][] = [['', 'Все'], ['1', 'Манга'], ['2', 'Манхва'], ['3', 'Маньхуа'], ['4', 'Западный комикс'], ['7', 'Другое']]

function FilterRow({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="filter-row">
      <div className="filter-label">{label}</div>
      {children}
    </div>
  )
}

function SelectFilter({ options, value, onChange }: { options: [string, string][]; value: string; onChange: (v: string) => void }): JSX.Element {
  return (
    <select className="filter-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )
}

/** Namespace colors ported from the "Tags Autocomplete" userscript's exhentai
 * palette (E-Hentai family chips live on a dark background, so the site
 * palette (not the light base palette) is the right one). */
const NS_COLORS: Record<string, string> = {
  female: '#9E2722', male: '#325CA2', language: '#6A936D',
  cosplayer: '#6A32A2', parody: '#6A32A2', character: '#A23282',
  group: '#DB6C24', artist: '#D38F1D', mixed: '#AB9F60',
  other: '#8e8e8e', reclass: '#8e8e8e', temp: '#8e8e8e', default: '#8e8e8e'
}
function nsColor(tag: string): string {
  const ns = tag.split(':')[0]?.toLowerCase() ?? ''
  return NS_COLORS[ns] ?? NS_COLORS.default
}
const nsStyle = (tag: string): React.CSSProperties => ({
  color: nsColor(tag),
  borderColor: `${nsColor(tag)}80`
})

/** Exhentai.org category chip colors (x.css ct1..cta) keyed by the category
 * bitmask used in ehExcludedCats. */
const EH_CAT_COLORS: Record<number, string> = {
  1: '#777777', // Misc
  2: '#9E2720', // Doujinshi
  4: '#DB6C24', // Manga
  8: '#D38F1D', // Artist CG
  16: '#6A936D', // Game CG
  32: '#325CA2', // Image Set
  64: '#6A32A2', // Cosplay
  128: '#A23282', // Asian Porn
  256: '#5FA9CF', // Non-H
  512: '#AB9F60' // Western
}

function TagChecklist({ items, selected, onToggle }: { items: [string, string][]; selected: string[]; onToggle: (v: string) => void }): JSX.Element {
  return (
    <div className="tag-checklist">
      {items.map(([val, label]) => {
        const active = selected.includes(val)
        return (
          <button
            key={val}
            className={`tag-check${active ? ' active' : ''}`}
            onClick={() => onToggle(val)}
          >{label}</button>
        )
      })}
    </div>
  )
}

export default function Catalog(): JSX.Element {
  const { setScreen, setOpened, settings, setSettings } = useStore()
  const [source, setSource] = useState(() => {
    const s = settings.last_catalog_source || 'mangadex'
    return !settings.show_r34_history && R34_SOURCES.includes(s) ? 'mangadex' : s
  })
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('relevance')
  const [page, setPage] = useState(0)
  const [cards, setCards] = useState<CatalogCard[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<CatalogCard | null>(null)
  const [chapters, setChapters] = useState<ChapterListItem[] | null>(null)
  const [chapterError, setChapterError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const [tagQuery, setTagQuery] = useState('')
  const [ehTags, setEhTags] = useState<{ display: string }[]>([])
  const [nhTags, setNhTags] = useState<{ name: string; count: number }[]>([])
  const [exAccounts, setExAccounts] = useState<ExAccount[]>([])
  const [exCurrentId, setExCurrentId] = useState(0)
  const [exNotice, setExNotice] = useState<string | null>(null)
  const [qsOpen, setQsOpen] = useState(false)
  const [quickSearchSeq, setQuickSearchSeq] = useState(0)
  const [statuses, setStatuses] = useState<Record<string, ReadingStatus>>({})

  // ── Filters ──
  const [ehExcludedCats, setEhExcludedCats] = useState(0)
  const [ehMinRating, setEhMinRating] = useState(0)
  const [msSort, setMsSort] = useState('')
  const [msStatus, setMsStatus] = useState('')
  const [msType, setMsType] = useState('')
  const [msYear, setMsYear] = useState('')
  const [msAge, setMsAge] = useState('')
  const [msChaptersMin, setMsChaptersMin] = useState('')
  const [msChaptersMax, setMsChaptersMax] = useState('')
  const [msTags, setMsTags] = useState<string[]>([])
  const [rmOrdering, setRmOrdering] = useState('')
  const [rmStatus, setRmStatus] = useState('')
  const [rmTypes, setRmTypes] = useState('')
  const [rmGenres, setRmGenres] = useState<string[]>([])
  const [skOrdering, setSkOrdering] = useState('')
  const [skStatus, setSkStatus] = useState<string[]>([])
  const [skType, setSkType] = useState<string[]>([])
  const [skFormat, setSkFormat] = useState<string[]>([])
  const [skRating, setSkRating] = useState('')
  const [cxCategory, setCxCategory] = useState('')
  const [cxGenre, setCxGenre] = useState('')
  // E-Hentai/ExHentai (onion + clearnet) and NHentai keep picked tags as
  // chips instead of stuffing them into the search string. The chip cycles
  // on repeated clicks, like the Tags Autocomplete userscript:
  // include → exclude ("!" prefix in state, "-tag" in the query) → remove.
  const [pickedTags, setPickedTags] = useState<string[]>([])
  const togglePickedTag = (tag: string): void => {
    if (pickedTags.includes(tag)) setPickedTags((prev) => prev.map((t) => t === tag ? `!${tag}` : t))
    else if (pickedTags.includes(`!${tag}`)) setPickedTags((prev) => prev.filter((t) => t !== `!${tag}`))
    else setPickedTags((prev) => prev.includes(tag) ? prev : [...prev, tag])
  }
  const [mdTagQuery, setMdTagQuery] = useState('')
  const [mdActiveTags, setMdActiveTags] = useState<string[]>([])
  const [mdLangs, setMdLangs] = useState<string[]>([])
  const [nhFilterTags, setNhFilterTags] = useState<string[]>([])
  const [menu, setMenu] = useState<{ x: number; y: number; card: CatalogCard; lookup: { key: string; favorited: boolean; status: ReadingStatus | null } | null } | null>(null)

  const sentinelRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const scrollToTop = (): void => { contentRef.current?.scrollTo({ top: 0 }) }
  const searchIdRef = useRef(0)
  const searchRef = useRef<(p: number, append?: boolean) => Promise<void>>(async () => {})
  const loadingRef = useRef(false)
  const pageRef = useRef(0)
  const sigRef = useRef('')
  const pageCacheRef = useRef<Map<number, CatalogCard[]>>(new Map())
  const infiniteScroll = settings.infinite_scroll
  const [hasMore, setHasMore] = useState(true)

  const filters: CatalogFilters = {
    ehExcludedCats,
    ehMinRating,
    mangadexTags: mdActiveTags,
    mangadexLangs: mdLangs,
    mangashiSort: msSort, mangashiStatus: msStatus, mangashiType: msType,
    mangashiYear: msYear, mangashiAgeRating: msAge,
    mangashiChaptersMin: msChaptersMin, mangashiChaptersMax: msChaptersMax,
    mangashiTags: msTags,
    remangaOrdering: rmOrdering, remangaStatus: rmStatus, remangaTypes: rmTypes,
    remangaGenres: rmGenres,
    senkuroOrdering: skOrdering, senkuroStatuses: skStatus, senkuroTypes: skType,
    senkuroFormats: skFormat, senkuroRating: skRating,
    comxCategory: cxCategory, comxGenre: cxGenre,
    nhentaiTags: nhFilterTags
  }

  const tagSource = source === 'exhentai' || source === 'exhentai_onion' || source === 'ehentai'
  const nhTagSource = source === 'nhentai' || source === 'nhentai_onion'
  const showFilters = source === 'exhentai' || source === 'exhentai_onion' || source === 'ehentai'
    || source === 'mangashi' || source === 'remanga' || source === 'mangadex' || source === 'senkuro' || source === 'comx' || nhTagSource
  const visibleSources = settings.show_r34_history ? SOURCES : SOURCES.filter((s) => !R34_SOURCES.includes(s.key))
  const visibleQuickSearches = settings.show_r34_history
    ? settings.quick_searches
    : settings.quick_searches.filter((q) => !R34_SOURCES.includes(q.source))

  useEffect(() => {
    if (tagQuery.trim().length < 2) { setEhTags([]); setNhTags([]); return }
    const t = setTimeout(async () => {
      if (tagSource) setEhTags(await window.api.ehTagSuggest(tagQuery))
      else if (nhTagSource) setNhTags(await window.api.nhentaiTagSuggest(tagQuery))
    }, 300)
    return () => clearTimeout(t)
  }, [tagQuery, tagSource, nhTagSource])

  useEffect(() => {
    window.api.getExAccounts().then((r) => { setExAccounts(r.accounts); setExCurrentId(r.currentId) })
  }, [])

  // Background page-count enrichment for nhentai cards.
  useEffect(() => {
    return window.api.onNhentaiCounts((entries) => {
      setCards((prev) => prev.map((c) => {
        const e = entries.find((x) => x.url === c.url)
        return e && c.pages == null ? { ...c, pages: e.pages } : c
      }))
    })
  }, [])

  // Reading-status chips for cards already in the library. Refetched whenever
  // the result set changes and on any library mutation (status set from here,
  // or a change made in the Library screen).
  useEffect(() => {
    let cancelled = false
    const run = (): void => {
      if (cards.length === 0) { setStatuses({}); return }
      void window.api.libraryStatuses(cards.map((c) => c.url))
        .then((m) => { if (!cancelled) setStatuses(m) })
        .catch(() => { /* best-effort */ })
    }
    run()
    const off = window.api.onLibraryChanged(run)
    return () => { cancelled = true; off() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards])

  // ensure_searched: auto-load the feed on open and whenever the source changes.
  // The previous in-flight search is invalidated: search() bumps searchIdRef and
  // discards any response that arrives after a newer search has started.
  useEffect(() => {
    void search(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source])

  const exIsAccountSource = source === 'exhentai' || source === 'ehentai'

  const appendTag = (tag: string): void => {
    setPickedTags((prev) => prev.includes(tag) ? prev : [...prev, tag])
    setTagQuery('')
    setEhTags([])
    setNhTags([])
  }

  const exSource = source === 'exhentai' || source === 'exhentai_onion' || source === 'ehentai'

  const search = useCallback(async (p: number, append = false): Promise<void> => {
    const id = ++searchIdRef.current
    loadingRef.current = true
    setLoading(true)
    setError(null)
    const effectiveQuery = [
      query.trim(),
      ...pickedTags.map((t) => t.startsWith('!') ? `-${t.slice(1)}` : t)
    ].join(' ').trim()
    // Cache key for the current query/filter/sort combination: a new signature
    // invalidates every prefetched page.
    const sig = `${source}|${effectiveQuery}|${JSON.stringify(filters)}|${sort}`
    if (sig !== sigRef.current) { sigRef.current = sig; pageCacheRef.current.clear() }
    const cursorFor = (list: CatalogCard[], dir: 'next' | 'prev'): CatalogCursor | undefined => {
      if (exSource) {
        const ref = dir === 'next' ? list[list.length - 1] : list[0]
        const m = ref?.url.match(/\/g\/(\d+)\//)
        if (m) return { dir, cursor: m[1] }
      } else if (source === 'senkuro' && dir === 'next') {
        const last = list[list.length - 1]
        if (last?.cursor) return { dir, cursor: last.cursor }
      }
      return undefined
    }
    try {
      let res: CatalogCard[]
      const cached = append ? pageCacheRef.current.get(p) : undefined
      if (cached) {
        pageCacheRef.current.delete(p)
        res = cached
      } else {
        const dir: 'next' | 'prev' = p < page ? 'prev' : 'next'
        const cursor = p !== 0 ? cursorFor(cards, dir) : undefined
        res = await window.api.searchCatalog(source, effectiveQuery, p, sort, filters, cursor)
      }
      if (id !== searchIdRef.current) return
      const prev = cards
      const seen = new Set(prev.map((x) => x.url))
      const next = append ? [...prev, ...res.filter((c) => !seen.has(c.url))] : res
      setCards(next)
      setPage(append ? p : 0)
      // Stop infinite scroll once a page returns nothing new (end of list, or a
      // source that ignores the offset). Otherwise `page` keeps growing and the
      // sentinel refetches forever.
      const more = res.length > 0 && (!append || next.length > prev.length)
      setHasMore(more)
      // Prefetch the NEXT page in the background so it appends instantly when the
      // sentinel is reached — seamless, with no visible "Загрузка…" pause.
      if (more && !pageCacheRef.current.has(p + 1)) {
        const nextCursor = cursorFor(next, 'next')
        void window.api.searchCatalog(source, effectiveQuery, p + 1, sort, filters, nextCursor)
          .then((cards2) => { if (sigRef.current === sig) pageCacheRef.current.set(p + 1, cards2) })
          .catch(() => { /* prefetch is best-effort */ })
      }
    } catch (e: any) {
      if (id !== searchIdRef.current) return
      if (!append) { setCards([]); setHasMore(false) }
      setError(String(e?.message ?? e))
    } finally {
      if (id === searchIdRef.current) { setLoading(false); loadingRef.current = false }
    }
  }, [source, query, pickedTags, sort, filters, exSource, page, cards])

  // Keep the latest search/fn state in refs so the sentinel observer is stable
  // (it must not be recreated on every render — see the effect below).
  searchRef.current = search
  loadingRef.current = loading
  pageRef.current = page

  // Reset scroll page when filters change
  const changeSource = (s: string): void => {
    searchIdRef.current++
    setSource(s)
    setCards([])
    setError(null)
    setPage(0)
    setHasMore(true)
    setPickedTags([])
    scrollToTop()
    // Remember the source for later visits to this screen
    setSettings({ ...settings, last_catalog_source: s })
  }

  // Turning the R34 privacy toggle off while an R34 source is active falls back
  // to a safe source (also hides its now-excluded cards/search presets).
  useEffect(() => {
    if (!settings.show_r34_history && R34_SOURCES.includes(source)) changeSource('mangadex')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.show_r34_history])

  const resetFilters = (): void => {
    setEhExcludedCats(0)
    setEhMinRating(0)
    setMdActiveTags([])
    setMdLangs([])
    setNhFilterTags([])
    setMsSort(''); setMsStatus(''); setMsType(''); setMsYear(''); setMsAge('')
    setMsChaptersMin(''); setMsChaptersMax(''); setMsTags([])
    setRmOrdering(''); setRmStatus(''); setRmTypes(''); setRmGenres([])
    setSkOrdering(''); setSkStatus([]); setSkType([]); setSkFormat([]); setSkRating('')
    setCxCategory(''); setCxGenre('')
  }

  // Auto-apply: whenever filters/sort (or their text fields) change, re-run
  // the search from page 0 after a short debounce — no explicit «Найти» or
  // blur needed. A stable signature keeps this from firing on plain renders.
  const filterSig = JSON.stringify(filters) + `|${sort}|${pickedTags.join(' ')}`
  const firstFilterRun = useRef(true)
  useEffect(() => {
    if (firstFilterRun.current) { firstFilterRun.current = false; return }
    scrollToTop()
    const t = setTimeout(() => { void search(0) }, 450)
    return () => clearTimeout(t)
    // search is recreated with the fresh filters on each render — the timer
    // always resolves against the newest state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSig, sort])

  // Quick-search preset launch for the SAME source: [source] won't change, so
  // the auto-search effect above never fires. A sequence bump re-renders with a
  // fresh `search` closure carrying the new query.
  const firstQuickRun = useRef(true)
  useEffect(() => {
    if (firstQuickRun.current) { firstQuickRun.current = false; return }
    scrollToTop()
    void search(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickSearchSeq])

  // Infinite scroll sentinel. Deps are intentionally minimal: the observer is
  // recreated only when the card count grows (to keep filling the viewport),
  // when infinite scroll is toggled, or when the list ends — NOT on every render
  // or on each loading toggle (that caused duplicate and runaway page requests).
  useEffect(() => {
    if (!infiniteScroll || !hasMore) return
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !loadingRef.current) {
        void searchRef.current(pageRef.current + 1, true)
      }
    }, { rootMargin: '400px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [infiniteScroll, cards.length, hasMore])

  const openChapters = useCallback(async (card: CatalogCard): Promise<void> => {
    setPicked(card)
    setChapters(null)
    setChapterError(null)
    try {
      setChapters(await window.api.fetchChapterList(card.url))
    } catch (e: any) {
      setChapterError(String(e?.message ?? e))
    }
  }, [])

  const onSelectCard = useCallback((c: CatalogCard): void => { void openChapters(c) }, [openChapters])

  const openChapter = async (chapterId: string, chapterIndex: number): Promise<void> => {
    const mangaId = picked?.url ?? null
    const coverUrl = picked?.coverUrl ?? null
    setOpening(true)
    const r = await window.api.openUrl(chapterId, 0, mangaId, coverUrl, picked?.kind ?? null)
    setOpening(false)
    if (r) {
      if (source === 'mangadex' && mangaId && chapters) {
        const total = chapters.length
        const progress = { ...settings.read_progress, [mangaId]: [chapterIndex + 1, total] as [number, number] }
        setSettings({ ...settings, read_progress: progress })
      }
      setOpened({ kind: 'online', ...r, startPage: 0, coverUrl, chapterList: chapters, chapterIndex })
      setPicked(null)
      setScreen('Reader')
    }
  }

  const toggleCat = (bit: number): void => {
    setEhExcludedCats((c) => c ^ bit)
  }

  const openCardMenu = useCallback(async (e: React.MouseEvent, card: CatalogCard) => {
    e.preventDefault()
    const lookup = await window.api.libraryLookup(card.url, card.url)
    setMenu({ x: e.clientX, y: e.clientY, card, lookup })
  }, [])

  const entryOf = (card: CatalogCard): { url: string; title: string; coverUrl: string | null; source: string; seriesId: string; kind: string | null } => ({
    url: card.url, title: card.title, coverUrl: card.coverUrl,
    source: SOURCES.find((s) => s.key === source)?.label ?? '', seriesId: card.url, kind: card.kind ?? null
  })

  const menuItems = (m: NonNullable<typeof menu>): MenuItem[] =>
    buildLibraryMenuItems(entryOf(m.card), {
      key: m.lookup?.key ?? null,
      favorited: !!m.lookup?.favorited,
      status: m.lookup?.status ?? null
    })

  return (
    <div className="catalog screen">
      <div className="catalog-toolbar">
        <select value={source} onChange={(e) => changeSource(e.target.value)}>
          {visibleSources.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        {exIsAccountSource && (
          <select
            title="Аккаунт ExHentai"
            value={exCurrentId}
            onChange={(e) => {
              const id = Number(e.target.value)
              void window.api.setExAccount(id).then((r) => { setExAccounts(r.accounts); setExCurrentId(r.currentId) })
            }}
          >
            {exAccounts.length === 0 && <option value={0}>🔑 Без аккаунта</option>}
            {exAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        {exNotice && <span className="muted">{exNotice}</span>}
        <input
          className="catalog-search"
          value={query}
          placeholder="Название манги…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void search(0) }}
        />
        {source === 'mangadex' && (
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        )}
        <button onClick={() => void search(0)}>Найти</button>
        <div className="quick-search">
          <button className="tab" onClick={() => setQsOpen((v) => !v)}>★ Быстрые поиски ▾</button>
          {qsOpen && (
            <div className="quick-search-menu">
              {visibleQuickSearches.length === 0 && <div className="muted qs-empty">Нет сохранённых поисков</div>}
              {visibleQuickSearches.map((q, i) => (
                <div key={q.id} className="qs-row">
                  <button className="qs-launch" title={`${q.source}: ${q.query}`} onClick={() => {
                    setQsOpen(false)
                    const { keyword, tags } = parseEhQueryToTags(q.query)
                    if (q.source !== source) changeSource(q.source)
                    setQuery(keyword)
                    setPickedTags(tags)
                    setEhExcludedCats(q.ehExcludedCats ?? 0)
                    setEhMinRating(q.ehMinRating ?? 0)
                    if (q.source === source) setQuickSearchSeq((n) => n + 1)
                  }}>{q.name}</button>
                  <button className="qs-icon" disabled={i === 0} onClick={() => setSettings({ ...settings, quick_searches: moveQuickSearch(settings.quick_searches, q.id, 'up') })}>↑</button>
                  <button className="qs-icon" disabled={i === settings.quick_searches.length - 1} onClick={() => setSettings({ ...settings, quick_searches: moveQuickSearch(settings.quick_searches, q.id, 'down') })}>↓</button>
                  <button className="qs-icon" onClick={() => setSettings({ ...settings, quick_searches: removeQuickSearch(settings.quick_searches, q.id) })}>✕</button>
                </div>
              ))}
              <button className="qs-save" onClick={() => {
                const name = window.prompt('Название быстрого поиска', query.trim() || source)
                if (!name) return
                setSettings({
                  ...settings,
                  quick_searches: addQuickSearch(settings.quick_searches, {
                    id: crypto.randomUUID(), name, source, query, ehExcludedCats, ehMinRating
                  })
                })
                setQsOpen(false)
              }}>＋ Сохранить текущий поиск</button>
            </div>
          )}
        </div>
      </div>

      {(tagSource || nhTagSource) && (
        <div className="tag-bar">
          <div className="tag-input-wrap">
            <input
              className="tag-input"
              value={tagQuery}
              placeholder="Тег (начни вводить)…"
              onChange={(e) => setTagQuery(e.target.value)}
            />
            {(ehTags.length > 0 || nhTags.length > 0) && (
              <div className="tag-suggestions">
                {ehTags.map((t) => (
                  <button key={t.display} className="tag-suggestion" onClick={() => appendTag(t.display)}>
                    <span style={{ color: nsColor(t.display) }}>●</span> {t.display}
                  </button>
                ))}
                {nhTags.map((t) => (
                  <button key={t.name} className="tag-suggestion" onClick={() => appendTag(t.name)}>
                    <span style={{ color: nsColor(t.name) }}>●</span> {t.name} <span className="muted">{t.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="fav-tags">
            {pickedTags.map((tag) => {
              const excluded = tag.startsWith('!')
              const core = excluded ? tag.slice(1) : tag
              return (
                <button
                  key={tag}
                  className={`fav-tag picked-tag${excluded ? ' picked-tag--excluded' : ''}`}
                  style={nsStyle(core)}
                  title={excluded ? 'Клик — убрать тег из поиска' : 'Клик — исключить тег из поиска'}
                  onClick={() => togglePickedTag(core)}
                >{excluded ? `${core} !` : `${core} ×`}</button>
              )
            })}
            {settings.eh_tag_bookmarks.map((tag) => (
              <button key={tag} className="fav-tag" style={nsStyle(tag)} onClick={() => appendTag(tag)}>{tag}</button>
            ))}
            {query.trim() && tagSource && (
              <button
                className="fav-tag add"
                title="Сохранить теги из строки поиска"
                onClick={() => {
                  const tags = query.trim().split(/\s+/).filter((w) => w.includes(':'))
                  if (tags.length) {
                    const set = new Set(settings.eh_tag_bookmarks)
                    tags.forEach((t) => set.add(t))
                    setSettings({ ...settings, eh_tag_bookmarks: [...set] })
                  }
                }}
              >★ Сохранить теги</button>
            )}
          </div>
        </div>
      )}

      <div className="catalog-body">
        <div className="catalog-content" ref={contentRef}>
          {error && <div className="error-text">{error}</div>}
          {loading && cards.length === 0 && <div className="muted">Поиск…</div>}
          {cards.length > 0 && (
            <MangaCardGrid
              cards={cards}
              onSelect={onSelectCard}
              progress={source === 'mangadex' ? settings.read_progress : undefined}
              statuses={statuses}
              onContextMenu={openCardMenu}
            />
          )}

          {cards.length > 0 && infiniteScroll && (
            <div ref={sentinelRef} className="catalog-sentinel">
              {loading ? <span className="muted">Загрузка…</span> : null}
            </div>
          )}

          {cards.length > 0 && !infiniteScroll && (
            <div className="catalog-pager">
              <button disabled={page === 0 || loading} onClick={() => void search(page - 1)}>Пред.</button>
              <span className="muted">Стр. {page + 1}</span>
              <button disabled={loading || !hasMore} onClick={() => void search(page + 1)}>След.</button>
            </div>
          )}
        </div>

        {showFilters && (
          <div className="filter-panel">
            <div className="filter-panel-head">
              <div className="filter-title-lg">Фильтры</div>
              <button className="filter-reset" onClick={() => { resetFilters();  }}>Сбросить ↺</button>
            </div>
            {tagSource && (
              <>
                <div className="filter-title">Категории</div>
                <div className="filter-cats eh-cats">
                  {EH_CATEGORIES.map(([label, bit]) => {
                    const enabled = (ehExcludedCats & bit) === 0
                    // Colors are the exhentai.org category chips (ct1..cta).
                    const bg = EH_CAT_COLORS[bit] ?? '#777777'
                    return (
                      <button
                        key={label}
                        className={`eh-cat eh-cat-${bit}`}
                        data-disabled={enabled ? undefined : '1'}
                        style={{ background: bg }}
                        title={enabled ? 'Скрывать категорию' : 'Показывать категорию'}
                        onClick={() => toggleCat(bit)}
                      >{label}</button>
                    )
                  })}
                </div>
                <div className="filter-title">Мин. рейтинг</div>
                <select className="filter-select" value={String(ehMinRating)} onChange={(e) => setEhMinRating(Number(e.target.value))}>
                  <option value="0">Любой</option>
                  <option value="2">2+</option>
                  <option value="3">3+</option>
                  <option value="4">4+</option>
                  <option value="5">5</option>
                </select>
              </>
            )}

            {source === 'mangadex' && (
              <>
                <div className="filter-title">Поиск лейблов</div>
                <input
                  className="filter-input full"
                  value={mdTagQuery}
                  placeholder="Например романтика"
                  onChange={(e) => setMdTagQuery(e.target.value)}
                />
                <div className="filter-title">Популярные</div>
                <div className="tag-checklist">
                  {MD_POPULAR_TAGS
                    .filter((t) => !mdTagQuery || t.toLowerCase().includes(mdTagQuery.toLowerCase()))
                    .map((tag) => {
                      const active = mdActiveTags.includes(tag)
                      return (
                        <button
                          key={tag}
                          className={`tag-check${active ? ' active' : ''}`}
                          onClick={() => {
                            setMdActiveTags((prev) => prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag])
                                                      }}
                        >{tag}</button>
                      )
                    })}
                </div>
                <div className="filter-title">Язык перевода</div>
                <div className="filter-cats">
                  {MD_LANGS.map(([code, label]) => {
                    const active = mdLangs.includes(code)
                    return (
                      <Toggle
                        key={code}
                        className={`filter-check${active ? ' active' : ''}`}
                        checked={active}
                        onChange={() => {
                          setMdLangs((prev) => prev.includes(code) ? prev.filter((l) => l !== code) : [...prev, code])
                        }}
                      >
                        {label}
                      </Toggle>
                    )
                  })}
                </div>
              </>
            )}

            {nhTagSource && (
              <>
                <div className="filter-title">Популярные теги</div>
                <div className="tag-checklist">
                  {NH_POPULAR_TAGS.map((tag) => {
                    const active = nhFilterTags.includes(tag)
                    return (
                      <button
                        key={tag}
                        className={`tag-check${active ? ' active' : ''}`}
                        onClick={() => {
                          setNhFilterTags((prev) => prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag])
                                                  }}
                      >{tag}</button>
                    )
                  })}
                </div>
              </>
            )}

            {source === 'mangashi' && (
              <>
                <FilterRow label="Сортировка"><SelectFilter options={MS_SORTS} value={msSort} onChange={(v) => { setMsSort(v);  }} /></FilterRow>
                <FilterRow label="Статус"><SelectFilter options={MS_STATUS} value={msStatus} onChange={(v) => { setMsStatus(v);  }} /></FilterRow>
                <FilterRow label="Тип"><SelectFilter options={MS_TYPES} value={msType} onChange={(v) => { setMsType(v);  }} /></FilterRow>
                <FilterRow label="Год выпуска">
                  <input className="filter-input" value={msYear} placeholder="Напр. 2024" onChange={(e) => setMsYear(e.target.value)} />
                </FilterRow>
                <FilterRow label="Возрастной рейтинг"><SelectFilter options={MS_AGES} value={msAge} onChange={(v) => { setMsAge(v);  }} /></FilterRow>
                <FilterRow label="Кол-во глав">
                  <div className="filter-range">
                    <input className="filter-input narrow" value={msChaptersMin} placeholder="От" onChange={(e) => setMsChaptersMin(e.target.value)} />
                    <span>—</span>
                    <input className="filter-input narrow" value={msChaptersMax} placeholder="До" onChange={(e) => setMsChaptersMax(e.target.value)} />
                  </div>
                </FilterRow>
                <div className="filter-title">Жанры</div>
                <TagChecklist items={MANGASHI_TAGS} selected={msTags} onToggle={(v) => { setMsTags((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]);  }} />
              </>
            )}

            {source === 'remanga' && (
              <>
                <FilterRow label="Сортировка"><SelectFilter options={RM_ORDERING} value={rmOrdering} onChange={(v) => { setRmOrdering(v); }} /></FilterRow>
                <FilterRow label="Статус"><SelectFilter options={RM_STATUS} value={rmStatus} onChange={(v) => { setRmStatus(v); }} /></FilterRow>
                <FilterRow label="Тип"><SelectFilter options={RM_TYPES} value={rmTypes} onChange={(v) => { setRmTypes(v); }} /></FilterRow>
                <div className="filter-title">Жанры</div>
                <TagChecklist items={REMANGA_GENRES} selected={rmGenres} onToggle={(v) => { setRmGenres((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]); }} />
              </>
            )}

            {source === 'senkuro' && (
              <>
                <FilterRow label="Сортировка"><SelectFilter options={SENKURO_ORDERING} value={skOrdering} onChange={setSkOrdering} /></FilterRow>
                <div className="filter-title">Статус</div>
                <TagChecklist items={SENKURO_STATUS} selected={skStatus} onToggle={(v) => setSkStatus((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])} />
                <div className="filter-title">Тип</div>
                <TagChecklist items={SENKURO_TYPE} selected={skType} onToggle={(v) => setSkType((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])} />
                <div className="filter-title">Формат выпуска</div>
                <TagChecklist items={SENKURO_FORMAT} selected={skFormat} onToggle={(v) => setSkFormat((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])} />
                <FilterRow label="Возрастной рейтинг"><SelectFilter options={SENKURO_RATING} value={skRating} onChange={setSkRating} /></FilterRow>
              </>
            )}

            {source === 'comx' && (
              <>
                <FilterRow label="Раздел"><SelectFilter options={COMX_CATEGORY} value={cxCategory} onChange={setCxCategory} /></FilterRow>
                {cxCategory === 'manga-2025-read' && (
                  <>
                    <FilterRow label="Жанр (Манга)"><SelectFilter options={[['', 'Все'], ...COMX_GENRE]} value={cxGenre} onChange={setCxGenre} /></FilterRow>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {picked && (
        <div className="overlay" onClick={() => setPicked(null)}>
          <div className="overlay-card chapters" onClick={(e) => e.stopPropagation()}>
            <h3>{picked.title}</h3>
            <button onClick={() => void (async () => {
              await window.api.libraryAdd({
                url: picked.url,
                title: picked.title,
                coverUrl: picked.coverUrl,
                source: SOURCES.find((s) => s.key === source)?.label ?? '',
                seriesId: picked.url
              })
              setExNotice('Добавлено в библиотеку')
            })()}>＋ В библиотеку</button>
            <div className="chapter-list">
              {opening && <div className="muted">Открываю главу…</div>}
              {chapterError && <div className="error-text">{chapterError}</div>}
              {!chapters && !chapterError && <div>Загрузка…</div>}
              {chapters && (
                <div className="chapter-count muted">Всего глав: {chapters.length}</div>
              )}
              {chapters && chapters.map((c, i) => {
                const isRead = settings.read_chapters.includes(c.chapter_id)
                return (
                  <button
                    key={c.chapter_id}
                    className={`chapter-item${isRead ? ' read' : ''}`}
                    onClick={() => void openChapter(c.chapter_id, i)}
                  >
                    {isRead ? '✓ ' : ''}{c.title ? `${c.chapter_num} — ${c.title}` : c.chapter_num}
                  </button>
                )
              })}
            </div>
            <button onClick={() => setPicked(null)}>Закрыть</button>
          </div>
        </div>
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu)} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}

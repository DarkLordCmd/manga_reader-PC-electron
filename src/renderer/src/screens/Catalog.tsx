import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import type { CatalogCard, CatalogCursor, CatalogFilters, ChapterListItem, ExAccount } from '@shared/ipc'
import { EH_CATEGORIES, MANGASHI_TAGS, REMANGA_GENRES, MD_LANGS, MD_POPULAR_TAGS, NH_POPULAR_TAGS } from '@shared/filters'
import MangaCardGrid from '../components/MangaCardGrid'

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
  const [source, setSource] = useState('mangadex')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('relevance')
  const [page, setPage] = useState(0)
  const [cards, setCards] = useState<CatalogCard[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<CatalogCard | null>(null)
  const [chapters, setChapters] = useState<ChapterListItem[] | null>(null)
  const [chapterError, setChapterError] = useState<string | null>(null)
  const [tagQuery, setTagQuery] = useState('')
  const [ehTags, setEhTags] = useState<{ display: string }[]>([])
  const [nhTags, setNhTags] = useState<{ name: string; count: number }[]>([])
  const [exAccounts, setExAccounts] = useState<ExAccount[]>([])
  const [exCurrentId, setExCurrentId] = useState(0)
  const [exNotice, setExNotice] = useState<string | null>(null)

  // ── Filters ──
  const [ehExcludedCats, setEhExcludedCats] = useState(0)
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
  const [mdTagQuery, setMdTagQuery] = useState('')
  const [mdActiveTags, setMdActiveTags] = useState<string[]>([])
  const [mdLangs, setMdLangs] = useState<string[]>([])
  const [nhFilterTags, setNhFilterTags] = useState<string[]>([])

  const sentinelRef = useRef<HTMLDivElement>(null)
  const infiniteScroll = settings.infinite_scroll

  const filters: CatalogFilters = {
    ehExcludedCats,
    mangadexTags: mdActiveTags,
    mangadexLangs: mdLangs,
    mangashiSort: msSort, mangashiStatus: msStatus, mangashiType: msType,
    mangashiYear: msYear, mangashiAgeRating: msAge,
    mangashiChaptersMin: msChaptersMin, mangashiChaptersMax: msChaptersMax,
    mangashiTags: msTags,
    remangaOrdering: rmOrdering, remangaStatus: rmStatus, remangaTypes: rmTypes,
    remangaGenres: rmGenres,
    nhentaiTags: nhFilterTags
  }

  const tagSource = source === 'exhentai' || source === 'exhentai_onion' || source === 'ehentai'
  const nhTagSource = source === 'nhentai' || source === 'nhentai_onion'
  const showFilters = source === 'exhentai' || source === 'exhentai_onion' || source === 'ehentai'
    || source === 'mangashi' || source === 'remanga' || source === 'mangadex' || nhTagSource

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

  // ensure_searched: auto-load the popular/trending MangaDex feed on open.
  useEffect(() => {
    if (source === 'mangadex') void search(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const exIsAccountSource = source === 'exhentai' || source === 'ehentai'

  const appendTag = (tag: string): void => {
    setQuery((q) => (q.trim() ? `${q.trim()} ${tag}` : tag))
    setTagQuery('')
    setEhTags([])
    setNhTags([])
  }

  const exSource = source === 'exhentai' || source === 'exhentai_onion' || source === 'ehentai'

  const search = useCallback(async (p: number, append = false): Promise<void> => {
    setLoading(true)
    setError(null)
    let cursor: CatalogCursor | undefined
    if (p !== 0) {
      const dir: 'next' | 'prev' = p < page ? 'prev' : 'next'
      if (exSource) {
        const ref = dir === 'next' ? cards[cards.length - 1] : cards[0]
        const m = ref?.url.match(/\/g\/(\d+)\//)
        if (m) cursor = { dir, cursor: m[1] }
      } else if (source === 'senkuro' && dir === 'next') {
        const last = cards[cards.length - 1]
        if (last?.cursor) cursor = { dir, cursor: last.cursor }
      }
    }
    try {
      const res = await window.api.searchCatalog(source, query.trim(), p, sort, filters, cursor)
      setCards((prev) => {
        if (!append) return res
        const seen = new Set(prev.map((c) => c.url))
        return [...prev, ...res.filter((c) => !seen.has(c.url))]
      })
      setPage(p)
    } catch (e: any) {
      if (!append) setCards([])
      setError(String(e?.message ?? e))
    } finally {
      setLoading(false)
    }
  }, [source, query, sort, filters, exSource, page, cards])

  // Reset scroll page when filters change
  const changeSource = (s: string): void => {
    setSource(s)
    setCards([])
    setError(null)
    setPage(0)
  }

  const resetFilters = (): void => {
    setEhExcludedCats(0)
    setMdActiveTags([])
    setMdLangs([])
    setNhFilterTags([])
    setMsSort(''); setMsStatus(''); setMsType(''); setMsYear(''); setMsAge('')
    setMsChaptersMin(''); setMsChaptersMax(''); setMsTags([])
    setRmOrdering(''); setRmStatus(''); setRmTypes(''); setRmGenres([])
  }

  // Infinite scroll sentinel
  useEffect(() => {
    if (!infiniteScroll || cards.length === 0) return
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !loading) void search(page + 1, true)
    }, { rootMargin: '400px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [infiniteScroll, cards.length, page, loading, search])

  const openChapters = async (card: CatalogCard): Promise<void> => {
    setPicked(card)
    setChapters(null)
    setChapterError(null)
    try {
      setChapters(await window.api.fetchChapterList(card.url))
    } catch (e: any) {
      setChapterError(String(e?.message ?? e))
    }
  }

  const openChapter = async (chapterId: string, chapterIndex: number): Promise<void> => {
    const mangaId = picked?.url ?? null
    const coverUrl = picked?.coverUrl ?? null
    const r = await window.api.openUrl(chapterId, 0, mangaId, coverUrl)
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
    setPage(0)
    void search(0)
  }

  return (
    <div className="catalog screen">
      <div className="catalog-toolbar">
        <select value={source} onChange={(e) => changeSource(e.target.value)}>
          {SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
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
        <button disabled={loading} onClick={() => void search(0)}>Найти</button>
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
                  <button key={t.display} className="tag-suggestion" onClick={() => appendTag(t.display)}>{t.display}</button>
                ))}
                {nhTags.map((t) => (
                  <button key={t.name} className="tag-suggestion" onClick={() => appendTag(t.name)}>
                    {t.name} <span className="muted">{t.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="fav-tags">
            {settings.eh_tag_bookmarks.map((tag) => (
              <button key={tag} className="fav-tag" onClick={() => appendTag(tag)}>{tag}</button>
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
        <div className="catalog-content">
          {error && <div className="error-text">{error}</div>}
          {loading && cards.length === 0 && <div className="muted">Поиск…</div>}
          {!loading && cards.length > 0 && (
            <MangaCardGrid
              cards={cards}
              onSelect={(c) => void openChapters(c)}
              progress={source === 'mangadex' ? settings.read_progress : undefined}
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
              <button disabled={loading} onClick={() => void search(page + 1)}>След.</button>
            </div>
          )}
        </div>

        {showFilters && (
          <div className="filter-panel">
            <div className="filter-panel-head">
              <div className="filter-title-lg">Фильтры</div>
              <button className="filter-reset" onClick={() => { resetFilters(); setPage(0); void search(0) }}>Сбросить ↺</button>
            </div>
            {tagSource && (
              <>
                <div className="filter-title">Категории</div>
                <div className="filter-cats">
                  {EH_CATEGORIES.map(([label, bit]) => {
                    const enabled = (ehExcludedCats & bit) === 0
                    return (
                      <label key={label} className="filter-check">
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={() => toggleCat(bit)}
                        /> {label}
                      </label>
                    )
                  })}
                </div>
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
                            setPage(0); void search(0)
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
                      <label key={code} className={`filter-check${active ? ' active' : ''}`}>
                        <input
                          type="checkbox"
                          checked={active}
                          onChange={() => {
                            setMdLangs((prev) => prev.includes(code) ? prev.filter((l) => l !== code) : [...prev, code])
                            setPage(0); void search(0)
                          }}
                        /> {label}
                      </label>
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
                          setPage(0); void search(0)
                        }}
                      >{tag}</button>
                    )
                  })}
                </div>
              </>
            )}

            {source === 'mangashi' && (
              <>
                <FilterRow label="Сортировка"><SelectFilter options={MS_SORTS} value={msSort} onChange={(v) => { setMsSort(v); setPage(0); void search(0) }} /></FilterRow>
                <FilterRow label="Статус"><SelectFilter options={MS_STATUS} value={msStatus} onChange={(v) => { setMsStatus(v); setPage(0); void search(0) }} /></FilterRow>
                <FilterRow label="Тип"><SelectFilter options={MS_TYPES} value={msType} onChange={(v) => { setMsType(v); setPage(0); void search(0) }} /></FilterRow>
                <FilterRow label="Год выпуска">
                  <input className="filter-input" value={msYear} placeholder="Напр. 2024" onChange={(e) => setMsYear(e.target.value)} onBlur={() => void search(0)} />
                </FilterRow>
                <FilterRow label="Возрастной рейтинг"><SelectFilter options={MS_AGES} value={msAge} onChange={(v) => { setMsAge(v); setPage(0); void search(0) }} /></FilterRow>
                <FilterRow label="Кол-во глав">
                  <div className="filter-range">
                    <input className="filter-input narrow" value={msChaptersMin} placeholder="От" onChange={(e) => setMsChaptersMin(e.target.value)} onBlur={() => void search(0)} />
                    <span>—</span>
                    <input className="filter-input narrow" value={msChaptersMax} placeholder="До" onChange={(e) => setMsChaptersMax(e.target.value)} onBlur={() => void search(0)} />
                  </div>
                </FilterRow>
                <div className="filter-title">Жанры</div>
                <TagChecklist items={MANGASHI_TAGS} selected={msTags} onToggle={(v) => { setMsTags((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]); setPage(0); void search(0) }} />
              </>
            )}

            {source === 'remanga' && (
              <>
                <FilterRow label="Сортировка"><SelectFilter options={RM_ORDERING} value={rmOrdering} onChange={(v) => { setRmOrdering(v); setPage(0); void search(0) }} /></FilterRow>
                <FilterRow label="Статус"><SelectFilter options={RM_STATUS} value={rmStatus} onChange={(v) => { setRmStatus(v); setPage(0); void search(0) }} /></FilterRow>
                <FilterRow label="Тип"><SelectFilter options={RM_TYPES} value={rmTypes} onChange={(v) => { setRmTypes(v); setPage(0); void search(0) }} /></FilterRow>
                <div className="filter-title">Жанры</div>
                <TagChecklist items={REMANGA_GENRES} selected={rmGenres} onToggle={(v) => { setRmGenres((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]); setPage(0); void search(0) }} />
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
    </div>
  )
}
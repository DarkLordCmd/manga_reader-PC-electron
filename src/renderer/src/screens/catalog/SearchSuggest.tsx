import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SearchSuggestion } from '@shared/ipc';
import type { CatalogSearch } from './useCatalogSearch';

/** Sources with a dedicated lightweight autocomplete endpoint (each one asks
 * its own site/API). The rest fall back to the normal catalog search. */
const FAST_SOURCES = new Set([
  'senkuro',
  'mangadex',
  'remanga',
  'nhentai',
  'nhentai_onion',
  'ehentai',
  'exhentai',
  'exhentai_onion',
]);

const DEBOUNCE_MS = 300;
const EMPTY_SUGGESTIONS: SearchSuggestion[] = [];

function visibleSuggestions(list: SearchSuggestion[], showR34: boolean): SearchSuggestion[] {
  return showR34 ? list : list.filter((it) => !it.age18);
}

/** Search field with per-source suggestions (covers + titles), like the sites'
 * own search overlays. Enter opens the highlighted row, Escape closes. */
export default function SearchSuggest({ s }: { s: CatalogSearch }): JSX.Element {
  const [result, setResult] = useState<{ key: string; items: SearchSuggestion[] }>({ key: '', items: [] });
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const seqRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const query = s.query;
  const requestKey = `${s.source}\u0000${query}\u0000${s.settings.show_r34_history ? '1' : '0'}`;
  // A result belonging to the previous query/source/privacy mode is not
  // renderable, even before the effect gets a chance to clear local state.
  const currentItems = result.key === requestKey ? result.items : EMPTY_SUGGESTIONS;
  const items = useMemo(
    () => visibleSuggestions(currentItems, s.settings.show_r34_history),
    [currentItems, s.settings.show_r34_history],
  );
  const active = activeIndex >= 0 && activeIndex < items.length ? activeIndex : -1;
  const listOpen = (open && items.length > 0) || (loading && query.trim().length >= 2);

  const invalidate = useCallback(
    (clearItems = false): void => {
      seqRef.current++;
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setLoading(false);
      setActiveIndex(-1);
      setOpen(false);
      if (clearItems) setResult({ key: requestKey, items: [] });
    },
    [requestKey],
  );

  useEffect(() => {
    const id = ++seqRef.current;
    setResult({ key: requestKey, items: [] });
    setActiveIndex(-1);
    setOpen(false);
    const q = query.trim();
    if (q.length < 2) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      if (timerRef.current === timer) timerRef.current = null;
      void (async () => {
        let list: SearchSuggestion[] = [];
        try {
          list = await window.api.catalogSuggest(s.source, q);
        } catch {
          list = [];
        }
        if (id !== seqRef.current) return;
        if (list.length === 0 && !FAST_SOURCES.has(s.source)) {
          // No dedicated endpoint: reuse the source's own catalog search, which
          // still asks that site, and show its first rows.
          try {
            const cards = await window.api.searchCatalog(s.source, q, 0, 'default', {}, undefined);
            let fallback = cards.slice(0, 6);
            let resolvedAdults: Record<string, boolean> = {};
            if (s.source === 'mangashi' && !s.settings.show_r34_history) {
              try {
                resolvedAdults = await window.api.catalogAdultBatch(fallback.map((c) => c.url));
                fallback = fallback.filter((c) => resolvedAdults[c.url] === false);
              } catch {
                fallback = [];
              }
            }
            list = fallback.map((c) => ({
              kind: 'work' as const,
              title: c.title,
              url: c.url,
              coverUrl: c.coverUrl,
              meta: [c.kind, c.score != null ? `★ ${c.score.toFixed(1)}` : null].filter(Boolean).join(' · ') || null,
              age18: c.adult === true || c.age18 === true || resolvedAdults[c.url] === true,
            }));
          } catch {
            list = [];
          }
        }
        if (id !== seqRef.current) return;
        const nextItems = list.slice(0, 8);
        setResult({ key: requestKey, items: nextItems });
        setActiveIndex(-1);
        setOpen(visibleSuggestions(nextItems, s.settings.show_r34_history).length > 0);
        setLoading(false);
      })();
    }, DEBOUNCE_MS);
    timerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (timerRef.current === timer) timerRef.current = null;
      if (id === seqRef.current) seqRef.current++;
    };
  }, [query, s.source, s.settings.show_r34_history, requestKey]);

  const choose = (it: SearchSuggestion): void => {
    invalidate(true);
    if (it.kind === 'tag' && it.tag) {
      // Tags belong to the tag bar (its own chips), not the title search box:
      // append a chip exactly like picking a suggestion in the tag input does.
      s.appendTag(it.tag);
      s.setQuery('');
      return;
    }
    if (it.kind === 'work' && it.url) {
      // Same flow as clicking a catalog card: the chapter overlay opens and the
      // list is resolved by the main process (URL or MangaDex id).
      s.onSelectCard({
        url: it.url,
        title: it.title,
        coverUrl: it.coverUrl ?? null,
        pages: null,
        status: it.status ?? null,
        tags: [],
      });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      invalidate(true);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (loading || items.length === 0) return;
      if (!open) {
        setOpen(true);
        setActiveIndex(e.key === 'ArrowDown' ? 0 : items.length - 1);
        return;
      }
      setActiveIndex((prev) => {
        if (e.key === 'ArrowDown') return (prev + 1) % items.length;
        return prev <= 0 ? items.length - 1 : prev - 1;
      });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (open && active >= 0 && items[active]) {
        choose(items[active]);
        return;
      }
      invalidate(true);
      void s.search(0, false, true);
    }
  };

  return (
    <div className="search-suggest">
      <input
        className="catalog-search"
        value={query}
        placeholder="Название манги…"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => s.setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (items.length > 0) setOpen(true);
        }}
        onBlur={() => invalidate()}
        aria-autocomplete="list"
        aria-expanded={listOpen}
      />
      {listOpen && (
        <div className="ss-list" role="listbox">
          {loading && items.length === 0 && <div className="ss-note">Ищу…</div>}
          {items.map((it, i) => (
            <button
              key={`${it.kind}:${it.url ?? it.tag ?? i}`}
              type="button"
              role="option"
              aria-selected={i === active}
              className={`ss-item${i === active ? ' active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => choose(it)}
            >
              {it.coverUrl ? (
                <span className="ss-cover-wrap">
                  <img
                    className={`ss-cover${s.settings.blur_adult_covers && it.age18 ? ' blur-adult' : ''}`}
                    src={`manga://cover/${encodeURIComponent(it.coverUrl)}`}
                    alt=""
                    loading="lazy"
                  />
                  {it.age18 && (
                    <span className="ss-adult" title="18+">
                      18+
                    </span>
                  )}
                </span>
              ) : (
                <span className="ss-tag">{it.kind === 'tag' ? '#' : '?'}</span>
              )}
              <span className="ss-main">
                <span className="ss-title">{it.title}</span>
                {(it.meta || it.subtitle) && <span className="ss-meta">{it.meta || it.subtitle}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

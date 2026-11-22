import { useEffect, useRef, useState } from 'react';
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

/** Search field with per-source suggestions (covers + titles), like the sites'
 * own search overlays. Enter opens the highlighted row, Escape closes. */
export default function SearchSuggest({ s }: { s: CatalogSearch }): JSX.Element {
  const [items, setItems] = useState<SearchSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const seqRef = useRef(0);
  const blurTimerRef = useRef<number | null>(null);
  const query = s.query;

  // A pending blur-close timer must not fire after the field unmounts.
  useEffect(
    () => () => {
      if (blurTimerRef.current != null) {
        window.clearTimeout(blurTimerRef.current);
        blurTimerRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setItems([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = ++seqRef.current;
    const timer = window.setTimeout(() => {
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
            list = cards.slice(0, 6).map((c) => ({
              kind: 'work' as const,
              title: c.title,
              url: c.url,
              coverUrl: c.coverUrl,
              meta: [c.kind, c.score != null ? `★ ${c.score.toFixed(1)}` : null].filter(Boolean).join(' · ') || null,
            }));
          } catch {
            list = [];
          }
        }
        if (id !== seqRef.current) return;
        setItems(list.slice(0, 8));
        setActive(-1);
        setOpen(list.length > 0);
        setLoading(false);
      })();
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, s.source]);

  const choose = (it: SearchSuggestion): void => {
    setOpen(false);
    setItems([]);
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
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (items.length === 0) return;
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActive((prev) => {
        const next = e.key === 'ArrowDown' ? prev + 1 : prev - 1;
        return (next + items.length) % items.length;
      });
      return;
    }
    if (e.key === 'Enter') {
      if (open && active >= 0 && items[active]) {
        e.preventDefault();
        choose(items[active]);
        return;
      }
      setOpen(false);
      void s.search(0, false, true);
    }
  };

  const cancelBlurClose = (): void => {
    if (blurTimerRef.current != null) {
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
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
          cancelBlurClose();
          if (items.length > 0) setOpen(true);
        }}
        onBlur={() => {
          cancelBlurClose();
          blurTimerRef.current = window.setTimeout(() => setOpen(false), 160);
        }}
        aria-autocomplete="list"
        aria-expanded={open}
      />
      {open && (
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
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(it)}
            >
              {it.coverUrl ? (
                <img className="ss-cover" src={`manga://cover/${encodeURIComponent(it.coverUrl)}`} alt="" loading="lazy" />
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

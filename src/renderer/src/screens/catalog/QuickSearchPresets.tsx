import { addQuickSearch, moveQuickSearchInView, parseEhQueryToTags, removeQuickSearch } from '@shared/quick-search';
import type { CatalogSearch } from './useCatalogSearch';

export default function QuickSearchPresets({ s }: { s: CatalogSearch }): JSX.Element {
  const visibleIds = new Set(s.visibleQuickSearches.map((q) => q.id));
  const move = (id: string, dir: 'up' | 'down'): void =>
    s.setSettings({
      ...s.settings,
      quick_searches: moveQuickSearchInView(s.settings.quick_searches, id, dir, (q) => !visibleIds.has(q.id)),
    });
  return (
    <div className="quick-search">
      <button className="tab" onClick={() => s.setQsOpen((v) => !v)}>
        ★ Быстрые поиски ▾
      </button>
      {s.qsOpen && (
        <div className="quick-search-menu">
          {s.visibleQuickSearches.length === 0 && <div className="muted qs-empty">Нет сохранённых поисков</div>}
          {s.visibleQuickSearches.map((q, i) => (
            <div key={q.id} className="qs-row">
              <button
                className="qs-launch"
                title={`${q.source}: ${q.query}`}
                onClick={() => {
                  s.setQsOpen(false);
                  const { keyword, tags } = parseEhQueryToTags(q.query);
                  if (q.source !== s.source) s.changeSource(q.source);
                  s.setQuery(keyword);
                  s.setPickedTags(tags);
                  s.setEhExcludedCats(q.ehExcludedCats ?? 0);
                  s.setEhMinRating(q.ehMinRating ?? 0);
                  if (q.source === s.source) s.setQuickSearchSeq((n) => n + 1);
                }}
              >
                {q.name}
              </button>
              <button className="qs-icon" disabled={i === 0} onClick={() => move(q.id, 'up')}>
                ↑
              </button>
              <button className="qs-icon" disabled={i === s.visibleQuickSearches.length - 1} onClick={() => move(q.id, 'down')}>
                ↓
              </button>
              <button
                className="qs-icon"
                onClick={() => s.setSettings({ ...s.settings, quick_searches: removeQuickSearch(s.settings.quick_searches, q.id) })}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            className="qs-save"
            onClick={() => {
              const name = window.prompt('Название быстрого поиска', s.query.trim() || s.source);
              if (!name) return;
              s.setSettings({
                ...s.settings,
                quick_searches: addQuickSearch(s.settings.quick_searches, {
                  id: crypto.randomUUID(),
                  name,
                  source: s.source,
                  query: s.query,
                  ehExcludedCats: s.ehExcludedCats,
                  ehMinRating: s.ehMinRating,
                }),
              });
              s.setQsOpen(false);
            }}
          >
            ＋ Сохранить текущий поиск
          </button>
        </div>
      )}
    </div>
  );
}

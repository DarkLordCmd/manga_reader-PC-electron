import ContextMenu from '../components/ContextMenu';
import MangaCardGrid from '../components/MangaCardGrid';
import CatalogToolbar from './catalog/CatalogToolbar';
import TagBar from './catalog/TagBar';
import FilterPanel from './catalog/FilterPanel';
import ChaptersOverlay from './catalog/ChaptersOverlay';
import { useCatalogSearch } from './catalog/useCatalogSearch';

export default function Catalog(): JSX.Element {
  const s = useCatalogSearch();

  return (
    <div className="catalog screen">
      <CatalogToolbar s={s} />

      <TagBar s={s} />

      <div className="catalog-body">
        <div className="catalog-content" ref={s.contentRef}>
          {s.error && <div className="error-text">{s.error}</div>}
          {s.loading && s.cards.length === 0 && <div className="muted">Поиск…</div>}
          {s.cards.length > 0 && (
            <MangaCardGrid
              cards={s.cards}
              onSelect={s.onSelectCard}
              progress={s.source === 'mangadex' ? s.settings.read_progress : undefined}
              statuses={s.statuses}
              onContextMenu={s.openCardMenu}
            />
          )}

          {s.cards.length > 0 && s.infiniteScroll && (
            <div ref={s.sentinelRef} className="catalog-sentinel">
              {s.loading ? <span className="muted">Загрузка…</span> : null}
            </div>
          )}

          {s.cards.length > 0 && !s.infiniteScroll && (
            <div className="catalog-pager">
              <button disabled={s.page === 0 || s.loading} onClick={() => void s.search(s.page - 1)}>
                Пред.
              </button>
              <span className="muted">Стр. {s.page + 1}</span>
              <button disabled={s.loading || !s.hasMore} onClick={() => void s.search(s.page + 1)}>
                След.
              </button>
            </div>
          )}
        </div>

        {s.showFilters && <FilterPanel s={s} />}
      </div>

      <ChaptersOverlay s={s} />

      {s.menu && <ContextMenu x={s.menu.x} y={s.menu.y} items={s.menuItems(s.menu)} onClose={() => s.setMenu(null)} />}
    </div>
  );
}

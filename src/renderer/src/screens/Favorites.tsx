import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import type { LibraryItem } from '@shared/library';
import ContextMenu, { type MenuItem } from '../components/ContextMenu';
import CoverImg from '../components/CoverImg';
import KindBadge from '../components/KindBadge';
import StatusBadge from '../components/StatusBadge';
import { buildLibraryMenuItems, STATUS_LABELS } from '../lib/library-menu';
import { resolveAdultFlag } from '../lib/adult';
import { errorText } from '../lib/errors';

export default function Favorites(): JSX.Element {
  const { setScreen, setOpened, settings } = useStore();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<'main' | 'r34'>('main');
  const [menu, setMenu] = useState<{ x: number; y: number; item: LibraryItem } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const cat = settings.show_r34_history ? category : 'main';

  // Same stale-response guard as the Library screen: a slower answer for an
  // older search must not replace the list for the current one.
  const refreshSeq = useRef(0);
  const refresh = useCallback(() => {
    const effCat = settings.show_r34_history ? category : 'main';
    const seq = ++refreshSeq.current;
    setLoading(true);
    setError(null);
    void window.api
      .libraryList({ scope: 'favorites', search, sort: 'added', category: effCat })
      .then((r) => {
        if (seq === refreshSeq.current) setItems(r);
      })
      .catch((e) => {
        if (seq === refreshSeq.current) setError(errorText(e));
      })
      .finally(() => {
        if (seq === refreshSeq.current) setLoading(false);
      });
  }, [search, category, settings.show_r34_history]);
  useEffect(refresh, [refresh]);
  useEffect(() => window.api.onLibraryChanged(refresh), [refresh]);

  const open = async (item: LibraryItem): Promise<void> => {
    setError(null);
    const start = Math.max(0, item.currentPage - 1);
    try {
      const r = await window.api.openUrl(item.url, start, item.seriesId, item.coverUrl, item.kind ?? null, null, await resolveAdultFlag(item.url, item.category === 'r34'));
      if (r) {
        setOpened({ kind: 'online', ...r, startPage: start, coverUrl: item.coverUrl });
        setScreen('Reader');
      } else {
        setError(`Не удалось открыть «${item.title}»: источник недоступен или не поддерживается`);
      }
    } catch (e) {
      setError(errorText(e));
    }
  };

  const itemsFor = (it: LibraryItem): MenuItem[] =>
    buildLibraryMenuItems(
      { url: it.url, title: it.title, coverUrl: it.coverUrl, source: it.source, seriesId: it.seriesId, kind: it.kind, adult: it.category === 'r34' },
      { key: it.key, favorited: it.favoritedAt !== null, status: it.status },
    );

  return (
    <div className="screen library">
      <div className="library-toolbar">
        <button className={cat === 'main' ? 'tab active' : 'tab'} onClick={() => setCategory('main')}>
          📖 Main
        </button>
        {settings.show_r34_history && (
          <button className={cat === 'r34' ? 'tab active' : 'tab'} onClick={() => setCategory('r34')}>
            🔞 R34
          </button>
        )}
        <div className="spacer" />
        <input className="catalog-search" placeholder="Поиск по названию…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {error && <div className="error-text">{error}</div>}
      {loading && <div className="muted">Загрузка избранного…</div>}
      {!loading && !error && items.length === 0 && (
        <div className="muted">
          {search.trim() ? 'Ничего не найдено' : 'В избранном пока пусто (правый клик по карточке в каталоге)'}
        </div>
      )}
      <div className="history-grid">
        {items.map((it) => (
          <div
            key={it.key}
            className="history-card"
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, item: it });
            }}
          >
            <button type="button" className="card-open" aria-label={`Открыть ${it.title || 'Без названия'}`} onClick={() => void open(it)} />
            <div className="history-cover">
              {it.coverUrl ? (
                <CoverImg
                  url={it.coverUrl}
                  className={settings.blur_adult_covers && it.category === 'r34' ? 'blur-adult' : undefined}
                />
              ) : (
                <div className="cover-placeholder" />
              )}
              <KindBadge kind={it.kind} />
              <StatusBadge status={it.status} />
            </div>
            <div className="history-title" title={it.title}>
              {it.title || 'Без названия'}
            </div>
            <div className="history-meta">
              <span>{it.status ? STATUS_LABELS[it.status] : 'Избранное'}</span>
              <button
                className="continue-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  void open(it);
                }}
              >
                Открыть
              </button>
            </div>
            <div className="bar-label muted">
              стр. {it.currentPage}/{it.totalPages}
            </div>
          </div>
        ))}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={itemsFor(menu.item)} onClose={() => setMenu(null)} />}
    </div>
  );
}

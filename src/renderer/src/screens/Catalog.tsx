import { useEffect, useState } from 'react';
import ContextMenu from '../components/ContextMenu';
import MangaCardGrid from '../components/MangaCardGrid';
import CatalogToolbar from './catalog/CatalogToolbar';
import TagBar from './catalog/TagBar';
import FilterPanel from './catalog/FilterPanel';
import ChaptersOverlay from './catalog/ChaptersOverlay';
import { useCatalogSearch } from './catalog/useCatalogSearch';
import { errorText } from '../lib/errors';

const EH_SOURCES = new Set(['ehentai', 'exhentai', 'exhentai_onion']);
const CARD_SIZE_KEY = 'catalog_card_size';
const CARD_SIZE_DEFAULT = 150;
const CARD_SIZE_MIN = 110;
const CARD_SIZE_MAX = 300;

/** The login window ends on the site's own front page; the onion mirror serves
 * its own captcha form there, the clearnet hosts use the forum login. */
function ehLoginUrl(source: string): string {
  if (source === 'exhentai_onion') return 'http://exhentai55ld2wyap5juskbm67czulomrouspdacjamjeloj7ugjbsad.onion/';
  if (source === 'exhentai') return 'https://exhentai.org/';
  return 'https://e-hentai.org/';
}

export default function Catalog(): JSX.Element {
  const s = useCatalogSearch();
  const [cardSize, setCardSize] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(CARD_SIZE_KEY));
      return Number.isFinite(saved) && saved >= CARD_SIZE_MIN && saved <= CARD_SIZE_MAX ? saved : CARD_SIZE_DEFAULT;
    } catch {
      return CARD_SIZE_DEFAULT;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(CARD_SIZE_KEY, String(cardSize));
    } catch {
      /* storage is optional */
    }
  }, [cardSize]);
  const [ehLoginBusy, setEhLoginBusy] = useState(false);
  const sessionProblem = !!s.error && /пустую страницу|сесси|sad panda|cookie/i.test(s.error);

  return (
    <div className="catalog screen">
      <CatalogToolbar s={s} cardSize={cardSize} onCardSize={setCardSize} />

      <TagBar s={s} />

      <div className="catalog-body">
        <div className="catalog-content" ref={s.contentRef}>
          {s.error && (
            <div className="catalog-error-row">
              <span className="error-text">{s.error}</span>
              {EH_SOURCES.has(s.source) && sessionProblem && (
                <button
                  className="set-primary"
                  disabled={ehLoginBusy}
                  onClick={async () => {
                    setEhLoginBusy(true);
                    try {
                      if (s.source === 'exhentai_onion') {
                        // The onion mirror has its own captcha login form.
                        await window.api.loginSite(ehLoginUrl(s.source));
                      } else {
                        // Clearnet ExHentai: the member cookies are usually fine
                        // and only `igneous` is stale — refresh it instead of
                        // opening a browser window (that window is blank behind
                        // Cloudflare/Tor on clearnet hosts).
                        const r = await window.api.refreshIgneous();
                        if (!r.ok) throw new Error(r.message);
                      }
                      await s.retrySearch();
                    } catch (e) {
                      alert(`Вход: ${errorText(e)}`);
                    } finally {
                      setEhLoginBusy(false);
                    }
                  }}
                >
                  {ehLoginBusy ? 'Вход…' : 'Войти'}
                </button>
              )}
              <button disabled={s.loading} onClick={() => void s.retrySearch()}>
                Повторить
              </button>
            </div>
          )}
          {s.loading && s.displayCards.length === 0 && <div className="muted">Поиск…</div>}
          {!s.loading && s.adultResolving && s.displayCards.length === 0 && <div className="muted">Проверяю возрастной рейтинг…</div>}
          {!s.loading && !s.adultResolving && !s.error && s.displayCards.length === 0 && (
            <div className="muted">
              {s.allAdultHidden
                ? '18+ скрыто: включи «Контент R34» в настройках.'
                : 'Ничего не найдено — ослабь фильтры.'}
            </div>
          )}
          {s.displayCards.length > 0 && (
            <MangaCardGrid
              cards={s.displayCards}
              onSelect={s.onSelectCard}
              progress={s.source === 'mangadex' ? s.settings.read_progress : undefined}
              statuses={s.statuses}
              onContextMenu={s.openCardMenu}
              blurAdult={s.settings.blur_adult_covers}
              cardSize={cardSize}
            />
          )}

          {s.displayCards.length > 0 && s.infiniteScroll && (
            <div ref={s.sentinelRef} className="catalog-sentinel">
              {s.loading ? <span className="muted">Загрузка…</span> : !s.hasMore ? <span className="muted">Это все результаты</span> : null}
            </div>
          )}

          {s.displayCards.length > 0 && !s.infiniteScroll && (
            <div className="catalog-pager">
              <button disabled={s.page === 0 || s.loading} onClick={() => void s.search(s.page - 1, false, true)}>
                Пред.
              </button>
              <span className="muted">
                {s.loading ? 'Загрузка…' : `Стр. ${s.page + 1}${!s.hasMore ? ' · Это все результаты' : ''}`}
              </span>
              <button disabled={s.loading || !s.hasMore} onClick={() => void s.search(s.page + 1, false, true)}>
                След.
              </button>
            </div>
          )}
        </div>

        {s.showFilters && <FilterPanel key={s.source} s={s} />}
      </div>

      <ChaptersOverlay s={s} />

      {s.menu && <ContextMenu x={s.menu.x} y={s.menu.y} items={s.menuItems(s.menu)} onClose={() => s.setMenu(null)} />}
    </div>
  );
}

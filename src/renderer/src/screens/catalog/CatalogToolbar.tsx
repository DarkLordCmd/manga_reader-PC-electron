import QuickSearchPresets from './QuickSearchPresets';
import SearchSuggest from './SearchSuggest';
import type { CatalogSearch } from './useCatalogSearch';

function CardSizeControl({ value, onChange }: { value: number; onChange: (value: number) => void }): JSX.Element {
  return (
    <label className="card-size" title="Размер карточек">
      <svg className="card-size-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <rect x="4" y="4" width="6" height="6" rx="1" />
        <rect x="14" y="4" width="6" height="6" rx="1" />
        <rect x="4" y="14" width="6" height="6" rx="1" />
        <rect x="14" y="14" width="6" height="6" rx="1" />
      </svg>
      <input
        type="range"
        min={110}
        max={300}
        step={10}
        value={value}
        aria-label="Размер карточек"
        aria-valuetext={`${value} пикселей`}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <svg className="card-size-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <rect x="2" y="4" width="8" height="8" rx="1" />
        <rect x="14" y="4" width="8" height="8" rx="1" />
        <rect x="2" y="14" width="8" height="8" rx="1" />
        <rect x="14" y="14" width="8" height="8" rx="1" />
      </svg>
    </label>
  );
}

export default function CatalogToolbar({
  s,
  cardSize,
  onCardSize,
}: {
  s: CatalogSearch;
  cardSize: number;
  onCardSize: (value: number) => void;
}): JSX.Element {
  return (
    <div className="catalog-toolbar">
      <select aria-label="Источник каталога" value={s.source} onChange={(e) => s.changeSource(e.target.value)}>
        {s.visibleSources.map((src) => (
          <option key={src.key} value={src.key}>
            {src.label}
          </option>
        ))}
      </select>
      {s.exIsAccountSource && (
        <select aria-label="Аккаунт ExHentai" title="Аккаунт ExHentai" value={s.exCurrentId} onChange={(e) => s.setExAccount(Number(e.target.value))}>
          {s.exAccounts.length === 0 && <option value={0}>🔑 Без аккаунта</option>}
          {s.exAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      )}
      {s.exNotice && <span className="muted">{s.exNotice}</span>}
      <SearchSuggest s={s} />

      <button onClick={() => void s.search(0, false, true)}>Найти</button>
      <QuickSearchPresets s={s} />
      <CardSizeControl value={cardSize} onChange={onCardSize} />
    </div>
  );
}

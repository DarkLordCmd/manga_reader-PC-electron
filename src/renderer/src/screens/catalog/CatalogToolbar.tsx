import QuickSearchPresets from './QuickSearchPresets';
import SearchSuggest from './SearchSuggest';
import type { CatalogSearch } from './useCatalogSearch';

export default function CatalogToolbar({ s }: { s: CatalogSearch }): JSX.Element {
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
    </div>
  );
}

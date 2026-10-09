import {
  EH_CATEGORIES,
  MANGASHI_TAGS,
  REMANGA_GENRES,
  MD_LANGS,
  MD_POPULAR_TAGS,
  NH_POPULAR_TAGS,
  SENKURO_STATUS,
  SENKURO_TYPE,
  SENKURO_FORMAT,
  SENKURO_RATING,
  SENKURO_ORDERING,
  COMX_CATEGORY,
  COMX_GENRE,
} from '@shared/filters';
import Toggle from '../../components/Toggle';
import { MS_AGES, MS_SORTS, MS_STATUS, MS_TYPES, RM_ORDERING, RM_STATUS, RM_TYPES } from './constants';
import type { CatalogSearch } from './useCatalogSearch';

function FilterRow({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="filter-row">
      <div className="filter-label">{label}</div>
      {children}
    </div>
  );
}

function SelectFilter({
  options,
  value,
  onChange,
}: {
  options: [string, string][];
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <select className="filter-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

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
  512: '#AB9F60', // Western
};

function TagChecklist({
  items,
  selected,
  onToggle,
}: {
  items: [string, string][];
  selected: string[];
  onToggle: (v: string) => void;
}): JSX.Element {
  return (
    <div className="tag-checklist">
      {items.map(([val, label]) => {
        const active = selected.includes(val);
        return (
          <button key={val} className={`tag-check${active ? ' active' : ''}`} onClick={() => onToggle(val)}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

export default function FilterPanel({ s }: { s: CatalogSearch }): JSX.Element {
  return (
    <div className="filter-panel">
      <div className="filter-panel-head">
        <div className="filter-title-lg">Фильтры</div>
        <button
          className="filter-reset"
          onClick={() => {
            s.resetFilters();
          }}
        >
          Сбросить ↺
        </button>
      </div>
      {s.tagSource && (
        <>
          <div className="filter-title">Категории</div>
          <div className="filter-cats eh-cats">
            {EH_CATEGORIES.map(([label, bit]) => {
              const enabled = (s.ehExcludedCats & bit) === 0;
              // Colors are the exhentai.org category chips (ct1..cta).
              const bg = EH_CAT_COLORS[bit] ?? '#777777';
              return (
                <button
                  key={label}
                  className={`eh-cat eh-cat-${bit}`}
                  data-disabled={enabled ? undefined : '1'}
                  style={{ background: bg }}
                  title={enabled ? 'Скрывать категорию' : 'Показывать категорию'}
                  onClick={() => s.toggleCat(bit)}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="filter-title">Мин. рейтинг</div>
          <select className="filter-select" value={String(s.ehMinRating)} onChange={(e) => s.setEhMinRating(Number(e.target.value))}>
            <option value="0">Любой</option>
            <option value="2">2+</option>
            <option value="3">3+</option>
            <option value="4">4+</option>
            <option value="5">5</option>
          </select>
        </>
      )}

      {s.source === 'mangadex' && (
        <>
          <div className="filter-title">Поиск лейблов</div>
          <input
            className="filter-input full"
            value={s.mdTagQuery}
            placeholder="Например романтика"
            onChange={(e) => s.setMdTagQuery(e.target.value)}
          />
          <div className="filter-title">Популярные</div>
          <div className="tag-checklist">
            {MD_POPULAR_TAGS.filter((t) => !s.mdTagQuery || t.toLowerCase().includes(s.mdTagQuery.toLowerCase())).map((tag) => {
              const active = s.mdActiveTags.includes(tag);
              return (
                <button
                  key={tag}
                  className={`tag-check${active ? ' active' : ''}`}
                  onClick={() => {
                    s.setMdActiveTags((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]));
                  }}
                >
                  {tag}
                </button>
              );
            })}
          </div>
          <div className="filter-title">Язык перевода</div>
          <div className="filter-cats">
            {MD_LANGS.map(([code, label]) => {
              const active = s.mdLangs.includes(code);
              return (
                <Toggle
                  key={code}
                  className={`filter-check${active ? ' active' : ''}`}
                  checked={active}
                  onChange={() => {
                    s.setMdLangs((prev) => (prev.includes(code) ? prev.filter((l) => l !== code) : [...prev, code]));
                  }}
                >
                  {label}
                </Toggle>
              );
            })}
          </div>
        </>
      )}

      {s.nhTagSource && (
        <>
          <div className="filter-title">Популярные теги</div>
          <div className="tag-checklist">
            {NH_POPULAR_TAGS.map((tag) => {
              const active = s.nhFilterTags.includes(tag);
              return (
                <button
                  key={tag}
                  className={`tag-check${active ? ' active' : ''}`}
                  onClick={() => {
                    s.setNhFilterTags((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]));
                  }}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </>
      )}

      {s.source === 'mangashi' && (
        <>
          <FilterRow label="Сортировка">
            <SelectFilter
              options={MS_SORTS}
              value={s.msSort}
              onChange={(v) => {
                s.setMsSort(v);
              }}
            />
          </FilterRow>
          <FilterRow label="Статус">
            <SelectFilter
              options={MS_STATUS}
              value={s.msStatus}
              onChange={(v) => {
                s.setMsStatus(v);
              }}
            />
          </FilterRow>
          <FilterRow label="Тип">
            <SelectFilter
              options={MS_TYPES}
              value={s.msType}
              onChange={(v) => {
                s.setMsType(v);
              }}
            />
          </FilterRow>
          <FilterRow label="Год выпуска">
            <input className="filter-input" value={s.msYear} placeholder="Напр. 2024" onChange={(e) => s.setMsYear(e.target.value)} />
          </FilterRow>
          <FilterRow label="Возрастной рейтинг">
            <SelectFilter
              options={MS_AGES}
              value={s.msAge}
              onChange={(v) => {
                s.setMsAge(v);
              }}
            />
          </FilterRow>
          <FilterRow label="Кол-во глав">
            <div className="filter-range">
              <input
                className="filter-input narrow"
                value={s.msChaptersMin}
                placeholder="От"
                onChange={(e) => s.setMsChaptersMin(e.target.value)}
              />
              <span>—</span>
              <input
                className="filter-input narrow"
                value={s.msChaptersMax}
                placeholder="До"
                onChange={(e) => s.setMsChaptersMax(e.target.value)}
              />
            </div>
          </FilterRow>
          <div className="filter-title">Жанры</div>
          <TagChecklist
            items={MANGASHI_TAGS}
            selected={s.msTags}
            onToggle={(v) => {
              s.setMsTags((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
            }}
          />
        </>
      )}

      {s.source === 'remanga' && (
        <>
          <FilterRow label="Сортировка">
            <SelectFilter
              options={RM_ORDERING}
              value={s.rmOrdering}
              onChange={(v) => {
                s.setRmOrdering(v);
              }}
            />
          </FilterRow>
          <FilterRow label="Статус">
            <SelectFilter
              options={RM_STATUS}
              value={s.rmStatus}
              onChange={(v) => {
                s.setRmStatus(v);
              }}
            />
          </FilterRow>
          <FilterRow label="Тип">
            <SelectFilter
              options={RM_TYPES}
              value={s.rmTypes}
              onChange={(v) => {
                s.setRmTypes(v);
              }}
            />
          </FilterRow>
          <div className="filter-title">Жанры</div>
          <TagChecklist
            items={REMANGA_GENRES}
            selected={s.rmGenres}
            onToggle={(v) => {
              s.setRmGenres((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
            }}
          />
        </>
      )}

      {s.source === 'senkuro' && (
        <>
          <FilterRow label="Сортировка">
            <SelectFilter options={SENKURO_ORDERING} value={s.skOrdering} onChange={s.setSkOrdering} />
          </FilterRow>
          <div className="filter-title">Статус</div>
          <TagChecklist
            items={SENKURO_STATUS}
            selected={s.skStatus}
            onToggle={(v) => s.setSkStatus((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]))}
          />
          <div className="filter-title">Тип</div>
          <TagChecklist
            items={SENKURO_TYPE}
            selected={s.skType}
            onToggle={(v) => s.setSkType((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]))}
          />
          <div className="filter-title">Формат выпуска</div>
          <TagChecklist
            items={SENKURO_FORMAT}
            selected={s.skFormat}
            onToggle={(v) => s.setSkFormat((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]))}
          />
          <FilterRow label="Возрастной рейтинг">
            <SelectFilter options={SENKURO_RATING} value={s.skRating} onChange={s.setSkRating} />
          </FilterRow>
        </>
      )}

      {s.source === 'comx' && (
        <>
          <FilterRow label="Раздел">
            <SelectFilter options={COMX_CATEGORY} value={s.cxCategory} onChange={s.setCxCategory} />
          </FilterRow>
          {s.cxCategory === 'manga-2025-read' && (
            <>
              <FilterRow label="Жанр (Манга)">
                <SelectFilter options={[['', 'Все'], ...COMX_GENRE]} value={s.cxGenre} onChange={s.setCxGenre} />
              </FilterRow>
            </>
          )}
        </>
      )}
    </div>
  );
}

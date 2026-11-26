import { useMemo, useRef, useState } from 'react';
import { sanitizeDecimalInput } from '@shared/filters';
import {
  EH_CATEGORIES,
  MANGASHI_TAGS,
  REMANGA_CATEGORIES,
  REMANGA_GENRES,
  NH_POPULAR_TAGS,
  SENKURO_STATUS,
  SENKURO_TYPE,
  SENKURO_FORMAT,
  SENKURO_RATING,
  SENKURO_TRANSLATION,
  SENKURO_SOURCE,
  SENKURO_COUNTRY,
  SENKURO_CHAPTER_PRESETS,
  SENKURO_ORDERING,
  COMX_AGES,
  COMX_CATEGORY,
  COMX_GENRES,
  COMX_STATUSES,
  COMX_TYPES,
  DEFAULT_READMANGA_SORT,
  READMANGA_SORTS,
  READMANGA_PRODUCTION_STATUSES,
  READMANGA_TRANSLATION_STATUSES,
  READMANGA_GENRES,
  READMANGA_CATEGORIES,
  READMANGA_LIMITATIONS,
  READMANGA_ANOTHER,
  READMANGA_SEARCH_FILTERS,
} from '@shared/filters';
import {
  ML_AGES,
  ML_BOOKMARKS,
  ML_COUNTRIES,
  ML_FORMATS,
  ML_GENRES,
  ML_ORDERS,
  ML_SORTS,
  ML_STATUSES,
  ML_TAGS,
  ML_TYPES,
  MS_AGES,
  MS_BOOKMARK_STATUSES,
  MS_PRESETS,
  MS_SORTS,
  MS_STATUS,
  MS_TYPES,
  MS_YEARS,
  RM_ORDERING,
  RM_STATUS,
  RM_TYPES,
} from './constants';
import type { CatalogSearch } from './useCatalogSearch';
import { useBodyScrollLock, useDialogFocus } from '../../lib/use-modal';
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
  disabled = [],
}: {
  items: [string, string][];
  selected: string[];
  onToggle: (v: string) => void;
  disabled?: string[];
}): JSX.Element {
  return (
    <div className="tag-checklist">
      {items.map(([val, label]) => {
        const active = selected.includes(val);
        return (
          <button
            key={val}
            className={`tag-check${active ? ' active' : ''}`}
            disabled={disabled.includes(val)}
            onClick={() => onToggle(val)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function FilterSection({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className={`fsec${open ? ' open' : ''}${count != null && count > 0 ? ' has-active' : ''}`}>
      <button type="button" className="fsec-head" onClick={onToggle} aria-expanded={open}>
        <span className="fsec-title">{title}</span>
        {count != null && count > 0 ? <span className="fsec-badge">{count}</span> : null}
        <span className="fsec-chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && <div className="fsec-body">{children}</div>}
    </section>
  );
}

function SubLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="fsec-label">{children}</div>;
}

function LabelPickerDialog({
  s,
  onClose,
  onToggleLabel,
}: {
  s: CatalogSearch;
  onClose: () => void;
  onToggleLabel: (slug: string) => void;
}): JSX.Element {
  const [labelQuery, setLabelQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useDialogFocus(onClose, inputRef);
  useBodyScrollLock();
  const q = labelQuery.trim().toLowerCase();
  const filteredLabels = q
    ? s.skLabelList.filter((l) => l.name.toLowerCase().includes(q) || l.slug.includes(q)).slice(0, 300)
    : s.skLabelList;
  return (
    <div className="overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="overlay-card label-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="label-picker-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="label-modal-head">
          <strong id="label-picker-title">Лейблы</strong>
          <span className="filter-note">
            {s.skLabels.length > 0 ? `выбрано: ${s.skLabels.length}` : `${s.skLabelList.length} доступно`}
          </span>
          <button className="overlay-close" aria-label="Закрыть" title="Закрыть" onClick={onClose}>
            ×
          </button>
        </div>
        <input
          ref={inputRef}
          className="filter-input full"
          aria-label="Поиск лейблов"
          placeholder="Поиск лейблов…"
          value={labelQuery}
          onChange={(e) => setLabelQuery(e.target.value)}
        />
        <div className="label-modal-list">
          {filteredLabels.length === 0 ? (
            <div className="filter-note">Ничего не найдено</div>
          ) : (
            filteredLabels.map((l) => (
              <label key={l.slug} className="label-pick">
                <input type="checkbox" checked={s.skLabels.includes(l.slug)} onChange={() => onToggleLabel(l.slug)} />
                <span>{l.name}</span>
              </label>
            ))
          )}
        </div>
        <div className="label-modal-foot">
          <button disabled={s.skLabels.length === 0} onClick={() => s.setSkLabels([])}>
            Очистить
          </button>
          <button className="set-primary" onClick={onClose}>
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FilterPanel({ s }: { s: CatalogSearch }): JSX.Element {
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    status: true,
    kind: true,
    rating: true,
    range: false,
    origin: false,
    labels: false,
    msMain: true,
    msLists: false,
    msGenres: false,
    msExclude: false,
    mlSort: true,
    mlMain: true,
    mlGenres: false,
    mlTags: false,
    mlCountry: false,
    mlLists: false,
    cxMain: true,
    cxClass: false,
    cxGenres: false,
    cxExclude: false,
    rmMain: true,
    rmSort: true,
    rmGenres: false,
    rmCategories: false,
    rmExcludeGenres: false,
    rmExcludeCategories: false,
    grSort: true,
    grMain: true,
    grGenres: false,
    grCategories: false,
    grMeta: false,
    grSearch: false,
    grExcludeGenres: false,
    grExcludeCategories: false,
  });
  const [msTagQuery, setMsTagQuery] = useState('');
  const [msExcludeTagQuery, setMsExcludeTagQuery] = useState('');
  const [mlGenreQuery, setMlGenreQuery] = useState('');
  const [mlTagQuery, setMlTagQuery] = useState('');
  const [cxGenreQuery, setCxGenreQuery] = useState('');
  const [cxExcludeGenreQuery, setCxExcludeGenreQuery] = useState('');
  const [rmGenreQuery, setRmGenreQuery] = useState('');
  const [rmCategoryQuery, setRmCategoryQuery] = useState('');
  const [rmExcludeGenreQuery, setRmExcludeGenreQuery] = useState('');
  const [rmExcludeCategoryQuery, setRmExcludeCategoryQuery] = useState('');
  const [grGenreQuery, setGrGenreQuery] = useState('');
  const [grCategoryQuery, setGrCategoryQuery] = useState('');
  const [grExcludeGenreQuery, setGrExcludeGenreQuery] = useState('');
  const [grExcludeCategoryQuery, setGrExcludeCategoryQuery] = useState('');
  const toggleSection = (key: string): void => setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  const toggleIn = (setter: (fn: (prev: string[]) => string[]) => void) => (v: string) =>
    setter((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  const skActiveCount =
    s.skStatus.length +
    s.skTranslation.length +
    s.skType.length +
    s.skFormat.length +
    s.skRatings.length +
    s.skSources.length +
    s.skCountries.length +
    s.skLabels.length +
    (s.skChaptersFrom ? 1 : 0) +
    (s.skChaptersTo ? 1 : 0) +
    (s.skYearFrom ? 1 : 0) +
    (s.skYearTo ? 1 : 0);
  const cxMainCount = (s.cxCategory ? 1 : 0) + [s.cxYearFrom, s.cxYearTo].filter(Boolean).length;
  const cxClassCount = s.cxTypes.length + s.cxStatuses.length + s.cxAges.length;
  const cxGenreList = useMemo(() => {
    const q = cxGenreQuery.trim().toLowerCase();
    const selected = new Set(s.cxGenres);
    return [
      ...COMX_GENRES.filter(([v]) => selected.has(v)),
      ...COMX_GENRES.filter(([v, label]) => !selected.has(v) && (!q || label.toLowerCase().includes(q))),
    ];
  }, [cxGenreQuery, s.cxGenres]);
  const cxExcludeGenreList = useMemo(() => {
    const q = cxExcludeGenreQuery.trim().toLowerCase();
    const selected = new Set(s.cxExcludeGenres);
    return [
      ...COMX_GENRES.filter(([v]) => selected.has(v)),
      ...COMX_GENRES.filter(([v, label]) => !selected.has(v) && (!q || label.toLowerCase().includes(q))),
    ];
  }, [cxExcludeGenreQuery, s.cxExcludeGenres]);  const rmMainCount =
    s.rmTypes.length +
    (s.rmStatus ? 1 : 0) +
    [s.rmChaptersMin, s.rmChaptersMax, s.rmYearMin, s.rmYearMax, s.rmRatingMin, s.rmRatingMax].filter(Boolean).length;
  const rmGenreList = useMemo(() => {
    const q = rmGenreQuery.trim().toLowerCase();
    const sel = new Set(s.rmGenres);
    return [
      ...REMANGA_GENRES.filter(([v]) => sel.has(v)),
      ...REMANGA_GENRES.filter(([v, l]) => !sel.has(v) && (!q || l.toLowerCase().includes(q))),
    ];
  }, [rmGenreQuery, s.rmGenres]);
  const rmCategoryList = useMemo(() => {
    const q = rmCategoryQuery.trim().toLowerCase();
    const sel = new Set(s.rmCategories);
    return [
      ...REMANGA_CATEGORIES.filter(([v]) => sel.has(v)),
      ...REMANGA_CATEGORIES.filter(([v, l]) => !sel.has(v) && (!q || l.toLowerCase().includes(q))),
    ];
  }, [rmCategoryQuery, s.rmCategories]);
  const rmExcludeGenreList = useMemo(() => {
    const q = rmExcludeGenreQuery.trim().toLowerCase();
    const sel = new Set(s.rmExcludeGenres);
    return [
      ...REMANGA_GENRES.filter(([v]) => sel.has(v)),
      ...REMANGA_GENRES.filter(([v, l]) => !sel.has(v) && (!q || l.toLowerCase().includes(q))),
    ];
  }, [rmExcludeGenreQuery, s.rmExcludeGenres]);
  const rmExcludeCategoryList = useMemo(() => {
    const q = rmExcludeCategoryQuery.trim().toLowerCase();
    const sel = new Set(s.rmExcludeCategories);
    return [
      ...REMANGA_CATEGORIES.filter(([v]) => sel.has(v)),
      ...REMANGA_CATEGORIES.filter(([v, l]) => !sel.has(v) && (!q || l.toLowerCase().includes(q))),
    ];
  }, [rmExcludeCategoryQuery, s.rmExcludeCategories]);

  const grMainCount =
    s.grProduction.length +
    s.grTranslation.length +
    [s.grYearMin, s.grYearMax].filter(Boolean).length;
  const grGenreList = useMemo(() => {
    const q = grGenreQuery.trim().toLowerCase();
    const selected = new Set(s.grGenres);
    return [
      ...READMANGA_GENRES.filter(([value]) => selected.has(value)),
      ...READMANGA_GENRES.filter(([value, label]) => !selected.has(value) && (!q || label.toLowerCase().includes(q))),
    ];
  }, [grGenreQuery, s.grGenres]);
  const grCategoryList = useMemo(() => {
    const q = grCategoryQuery.trim().toLowerCase();
    const selected = new Set(s.grCategories);
    return [
      ...READMANGA_CATEGORIES.filter(([value]) => selected.has(value)),
      ...READMANGA_CATEGORIES.filter(([value, label]) => !selected.has(value) && (!q || label.toLowerCase().includes(q))),
    ];
  }, [grCategoryQuery, s.grCategories]);
  const grExcludeGenreList = useMemo(() => {
    const q = grExcludeGenreQuery.trim().toLowerCase();
    const selected = new Set(s.grExcludeGenres);
    return [
      ...READMANGA_GENRES.filter(([value]) => selected.has(value)),
      ...READMANGA_GENRES.filter(([value, label]) => !selected.has(value) && (!q || label.toLowerCase().includes(q))),
    ];
  }, [grExcludeGenreQuery, s.grExcludeGenres]);
  const grExcludeCategoryList = useMemo(() => {
    const q = grExcludeCategoryQuery.trim().toLowerCase();
    const selected = new Set(s.grExcludeCategories);
    return [
      ...READMANGA_CATEGORIES.filter(([value]) => selected.has(value)),
      ...READMANGA_CATEGORIES.filter(([value, label]) => !selected.has(value) && (!q || label.toLowerCase().includes(q))),
    ];
  }, [grExcludeCategoryQuery, s.grExcludeCategories]);  const selectedLabels = s.skLabelList.filter((l) => s.skLabels.includes(l.slug));
  const msTagList = useMemo(() => {
    const q = msTagQuery.trim().toLowerCase();
    const selected = new Set(s.msTags);
    return [
      ...MANGASHI_TAGS.filter(([v]) => selected.has(v)),
      ...MANGASHI_TAGS.filter(([v, label]) => !selected.has(v) && (!q || label.toLowerCase().includes(q))),
    ];
  }, [msTagQuery, s.msTags]);
  const msExcludeTagList = useMemo(() => {
    const q = msExcludeTagQuery.trim().toLowerCase();
    const selected = new Set(s.msExcludeTags);
    return [
      ...MANGASHI_TAGS.filter(([v]) => selected.has(v)),
      ...MANGASHI_TAGS.filter(([v, label]) => !selected.has(v) && (!q || label.toLowerCase().includes(q))),
    ];
  }, [msExcludeTagQuery, s.msExcludeTags]);
  const msMainCount = [s.msSort, s.msStatus, s.msType, s.msYear, s.msAge, s.msChaptersMin, s.msChaptersMax].filter(Boolean).length;
  const msListCount = s.msBookmarkStatuses.length + (s.msHideBookmarked ? 1 : 0);
  const toggleMlArray = (
    key: 'types' | 'statuses' | 'formats' | 'ages' | 'genres' | 'tags' | 'countries' | 'bookmarks',
    value: string,
  ): void => {
    s.setLibFilters((prev) => {
      const list = prev[key];
      return { ...prev, [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] };
    });
  };
  const mlMainCount =
    s.libFilters.types.length +
    s.libFilters.statuses.length +
    s.libFilters.formats.length +
    s.libFilters.ages.length +
    [s.libFilters.chaptersMin, s.libFilters.chaptersMax, s.libFilters.ratingMin, s.libFilters.ratingMax, s.libFilters.votesMin, s.libFilters.votesMax, s.libFilters.yearMin, s.libFilters.yearMax].filter(Boolean).length;
  const mlListCount = s.libFilters.bookmarks.length;
  const mlGenreList = useMemo(() => {
    const q = mlGenreQuery.trim().toLowerCase();
    const selected = new Set(s.libFilters.genres);
    return [
      ...ML_GENRES.filter(([v]) => selected.has(v)),
      ...ML_GENRES.filter(([v, label]) => !selected.has(v) && (!q || label.toLowerCase().includes(q))),
    ];
  }, [mlGenreQuery, s.libFilters.genres]);
  const mlTagList = useMemo(() => {
    const q = mlTagQuery.trim().toLowerCase();
    const selected = new Set(s.libFilters.tags);
    return [
      ...ML_TAGS.filter(([v]) => selected.has(v)),
      ...ML_TAGS.filter(([v, label]) => !selected.has(v) && (!q || label.toLowerCase().includes(q))),
    ];
  }, [mlTagQuery, s.libFilters.tags]);
  return (
    <div className="filter-panel">
      <div className="filter-panel-head">
        <div className="filter-title-lg">
          Фильтры
          {s.source === 'senkuro' && skActiveCount > 0 && <span className="fsec-badge">{skActiveCount}</span>}
        </div>
        <button
          className="filter-reset"
          onClick={() => {
            s.resetFilters();
          }}
        >
          Сбросить
        </button>
      </div>
      <div className="filter-panel-body">
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
          <label className="filter-check">
            <input type="checkbox" checked={s.ehWatchedOnly} onChange={(e) => s.setEhWatchedOnly(e.target.checked)} />
            Только из «Watched»
          </label>
          {s.source !== 'exhentai_onion' && (
            <>
              <div className="filter-title">Топлист</div>
              <select className="filter-select" value={String(s.ehToplist)} onChange={(e) => s.setEhToplist(Number(e.target.value))}>
                <option value="0">Выкл.</option>
                <option value="11">Галереи за всё время</option>
                <option value="12">Галереи за год</option>
                <option value="13">Галереи за месяц</option>
                <option value="15">Галереи за вчера</option>
              </select>
            </>
          )}
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
          <div className="filter-presets">
            {MS_PRESETS.map(([value, label]) => {
              const needsAuth = value === 'for_you';
              const disabled = needsAuth && !s.settings.mangashi_cookies_raw;
              return (
                <button
                  key={value}
                  type="button"
                  className={`tag-check${s.msPreset === value ? ' active' : ''}`}
                  aria-pressed={s.msPreset === value}
                  disabled={disabled}
                  title={disabled ? 'Войдите в Manga-shi, чтобы использовать «Для вас»' : undefined}
                  onClick={() => s.setMsPreset((prev) => (prev === value ? '' : value))}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <FilterSection
            title="Параметры"
            count={msMainCount}
            open={!!openSections.msMain}
            onToggle={() => toggleSection('msMain')}
          >
            <div className="filter-grid">
              <FilterRow label="Сортировка">
                <SelectFilter options={MS_SORTS} value={s.msSort} onChange={(v) => s.setMsSort(v)} />
              </FilterRow>
              <FilterRow label="Статус">
                <SelectFilter options={MS_STATUS} value={s.msStatus} onChange={(v) => s.setMsStatus(v)} />
              </FilterRow>
              <FilterRow label="Тип">
                <SelectFilter options={MS_TYPES} value={s.msType} onChange={(v) => s.setMsType(v)} />
              </FilterRow>
              <FilterRow label="Год выпуска">
                <SelectFilter options={MS_YEARS} value={s.msYear} onChange={(v) => s.setMsYear(v)} />
              </FilterRow>
              <FilterRow label="Возрастной рейтинг">
                <div className="filter-segments">
                  {MS_AGES.map(([value, label]) => (
                    <button
                      key={value || 'all'}
                      type="button"
                      className={`tag-check${s.msAge === value ? ' active' : ''}`}
                      aria-pressed={s.msAge === value}
                      onClick={() => s.setMsAge(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </FilterRow>
              <FilterRow label="Кол-во глав">
                <div className="filter-range">
                  <input
                    className="filter-input narrow"
                    inputMode="numeric"
                    value={s.msChaptersMin}
                    placeholder="От"
                    aria-label="Минимум глав"
                    onChange={(e) => s.setMsChaptersMin(e.target.value.replace(/\D/g, ''))}
                  />
                  <span>—</span>
                  <input
                    className="filter-input narrow"
                    inputMode="numeric"
                    value={s.msChaptersMax}
                    placeholder="До"
                    aria-label="Максимум глав"
                    onChange={(e) => s.setMsChaptersMax(e.target.value.replace(/\D/g, ''))}
                  />
                </div>
              </FilterRow>
            </div>
          </FilterSection>

          <FilterSection
            title="Мои списки"
            count={msListCount}
            open={!!openSections.msLists}
            onToggle={() => toggleSection('msLists')}
          >
            {s.settings.mangashi_cookies_raw ? (
              <>
                <div className="tag-checklist">
                  {MS_BOOKMARK_STATUSES.map(([value, label]) => {
                    const active = s.msBookmarkStatuses.includes(value);
                    return (
                      <button
                        key={value}
                        type="button"
                        className={`tag-check${active ? ' active' : ''}`}
                        aria-pressed={active}
                        onClick={() =>
                          s.setMsBookmarkStatuses((prev) =>
                            prev.includes(value) ? prev.filter((x) => x !== value) : [...prev, value],
                          )
                        }
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <label className="filter-check">
                  <input
                    type="checkbox"
                    checked={s.msHideBookmarked}
                    onChange={(e) => s.setMsHideBookmarked(e.target.checked)}
                  />
                  Скрыть из библиотеки
                </label>
              </>
            ) : (
              <div className="filter-note">Войдите в Manga-shi в настройках, чтобы фильтровать по своим спискам.</div>
            )}
          </FilterSection>

          <FilterSection
            title="Жанры"
            count={s.msTags.length}
            open={!!openSections.msGenres}
            onToggle={() => toggleSection('msGenres')}
          >
            <input
              className="filter-input full"
              placeholder="Поиск жанра…"
              value={msTagQuery}
              onChange={(e) => setMsTagQuery(e.target.value)}
            />
            <TagChecklist
              items={msTagList}
              selected={s.msTags}
              onToggle={(v) => {
                s.setMsExcludeTags((prev) => prev.filter((x) => x !== v));
                s.setMsTags((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
              }}
            />
          </FilterSection>

          <FilterSection
            title="Исключить жанры"
            count={s.msExcludeTags.length}
            open={!!openSections.msExclude}
            onToggle={() => toggleSection('msExclude')}
          >
            <input
              className="filter-input full"
              placeholder="Найти исключаемый жанр…"
              value={msExcludeTagQuery}
              onChange={(e) => setMsExcludeTagQuery(e.target.value)}
            />
            <TagChecklist
              items={msExcludeTagList}
              selected={s.msExcludeTags}
              onToggle={(v) => {
                s.setMsTags((prev) => prev.filter((x) => x !== v));
                s.setMsExcludeTags((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
              }}
            />
          </FilterSection>
        </>
      )}

      {(s.source === 'mangalib' || s.source === 'hentailib') && (
        <>
          <FilterSection
            title="Сортировка"
            count={s.libFilters.sortBy ? 1 : 0}
            open={!!openSections.mlSort}
            onToggle={() => toggleSection('mlSort')}
          >
            <div className="filter-grid">
              <FilterRow label="Поле сортировки">
                <SelectFilter
                  options={ML_SORTS}
                  value={s.libFilters.sortBy}
                  onChange={(v) => s.setLibFilters((prev) => ({ ...prev, sortBy: v }))}
                />
              </FilterRow>
              <FilterRow label="Порядок">
                <SelectFilter
                  options={ML_ORDERS}
                  value={s.libFilters.order}
                  onChange={(v) => s.setLibFilters((prev) => ({ ...prev, order: v }))}
                />
              </FilterRow>
            </div>
          </FilterSection>

          <FilterSection
            title="Параметры"
            count={mlMainCount}
            open={!!openSections.mlMain}
            onToggle={() => toggleSection('mlMain')}
          >
            <SubLabel>Тип</SubLabel>
            <TagChecklist items={ML_TYPES} selected={s.libFilters.types} onToggle={(v) => toggleMlArray('types', v)} />
            <SubLabel>Статус тайтла</SubLabel>
            <TagChecklist
              items={ML_STATUSES}
              selected={s.libFilters.statuses}
              onToggle={(v) => toggleMlArray('statuses', v)}
            />
            <SubLabel>Формат выпуска</SubLabel>
            <TagChecklist
              items={ML_FORMATS}
              selected={s.libFilters.formats}
              onToggle={(v) => toggleMlArray('formats', v)}
            />
            <SubLabel>Возрастной рейтинг</SubLabel>
            <TagChecklist items={ML_AGES} selected={s.libFilters.ages} onToggle={(v) => toggleMlArray('ages', v)} />
            <div className="filter-grid">
              <FilterRow label="Количество глав">
                <div className="filter-range">
                  <input
                    className="filter-input narrow"
                    inputMode="numeric"
                    placeholder="От"
                    aria-label="Минимум глав"
                    value={s.libFilters.chaptersMin}
                    onChange={(e) =>
                      s.setLibFilters((prev) => ({ ...prev, chaptersMin: e.target.value.replace(/\D/g, '') }))
                    }
                  />
                  <span>—</span>
                  <input
                    className="filter-input narrow"
                    inputMode="numeric"
                    placeholder="До"
                    aria-label="Максимум глав"
                    value={s.libFilters.chaptersMax}
                    onChange={(e) =>
                      s.setLibFilters((prev) => ({ ...prev, chaptersMax: e.target.value.replace(/\D/g, '') }))
                    }
                  />
                </div>
              </FilterRow>
              <FilterRow label="Год релиза">
                <div className="filter-range">
                  <input
                    className="filter-input narrow"
                    inputMode="numeric"
                    placeholder="От"
                    aria-label="Год от"
                    value={s.libFilters.yearMin}
                    onChange={(e) => s.setLibFilters((prev) => ({ ...prev, yearMin: e.target.value.replace(/\D/g, '') }))}
                  />
                  <span>—</span>
                  <input
                    className="filter-input narrow"
                    inputMode="numeric"
                    placeholder="До"
                    aria-label="Год до"
                    value={s.libFilters.yearMax}
                    onChange={(e) => s.setLibFilters((prev) => ({ ...prev, yearMax: e.target.value.replace(/\D/g, '') }))}
                  />
                </div>
              </FilterRow>
              <FilterRow label="Оценка">
                <div className="filter-range">
                  <input
                    className="filter-input narrow"
                    inputMode="decimal"
                    placeholder="От"
                    aria-label="Оценка от"
                    value={s.libFilters.ratingMin}
                    onChange={(e) =>
                      s.setLibFilters((prev) => ({ ...prev, ratingMin: sanitizeDecimalInput(e.target.value) }))
                    }
                  />
                  <span>—</span>
                  <input
                    className="filter-input narrow"
                    inputMode="decimal"
                    placeholder="До"
                    aria-label="Оценка до"
                    value={s.libFilters.ratingMax}
                    onChange={(e) =>
                      s.setLibFilters((prev) => ({ ...prev, ratingMax: sanitizeDecimalInput(e.target.value) }))
                    }
                  />
                </div>
              </FilterRow>
              <FilterRow label="Количество оценок">
                <div className="filter-range">
                  <input
                    className="filter-input narrow"
                    inputMode="numeric"
                    placeholder="От"
                    aria-label="Оценок от"
                    value={s.libFilters.votesMin}
                    onChange={(e) =>
                      s.setLibFilters((prev) => ({ ...prev, votesMin: e.target.value.replace(/\D/g, '') }))
                    }
                  />
                  <span>—</span>
                  <input
                    className="filter-input narrow"
                    inputMode="numeric"
                    placeholder="До"
                    aria-label="Оценок до"
                    value={s.libFilters.votesMax}
                    onChange={(e) =>
                      s.setLibFilters((prev) => ({ ...prev, votesMax: e.target.value.replace(/\D/g, '') }))
                    }
                  />
                </div>
              </FilterRow>
            </div>
          </FilterSection>

          <FilterSection
            title="Жанры"
            count={s.libFilters.genres.length}
            open={!!openSections.mlGenres}
            onToggle={() => toggleSection('mlGenres')}
          >
            <input
              className="filter-input full"
              placeholder="Поиск жанра…"
              value={mlGenreQuery}
              onChange={(e) => setMlGenreQuery(e.target.value)}
            />
            <TagChecklist
              items={mlGenreList}
              selected={s.libFilters.genres}
              onToggle={(v) => toggleMlArray('genres', v)}
            />
          </FilterSection>

          <FilterSection
            title="Теги"
            count={s.libFilters.tags.length}
            open={!!openSections.mlTags}
            onToggle={() => toggleSection('mlTags')}
          >
            <input
              className="filter-input full"
              placeholder="Поиск тега…"
              value={mlTagQuery}
              onChange={(e) => setMlTagQuery(e.target.value)}
            />
            <TagChecklist items={mlTagList} selected={s.libFilters.tags} onToggle={(v) => toggleMlArray('tags', v)} />
          </FilterSection>

          <FilterSection
            title="Страна"
            count={s.libFilters.countries.length}
            open={!!openSections.mlCountry}
            onToggle={() => toggleSection('mlCountry')}
          >
            <TagChecklist
              items={ML_COUNTRIES}
              selected={s.libFilters.countries}
              onToggle={(v) => toggleMlArray('countries', v)}
            />
          </FilterSection>

          <FilterSection
            title="Мои списки"
            count={mlListCount}
            open={!!openSections.mlLists}
            onToggle={() => toggleSection('mlLists')}
          >
            {s.settings.mangalib_cookies_raw ? (
              <TagChecklist
                items={ML_BOOKMARKS}
                selected={s.libFilters.bookmarks}
                onToggle={(v) => toggleMlArray('bookmarks', v)}
              />
            ) : (
              <div className="filter-note">Войдите в Mangalib в настройках, чтобы фильтровать по своим спискам.</div>
            )}
          </FilterSection>
        </>
      )}

      {s.source === 'remanga' && (
        <>
          <FilterSection
            title="Сортировка"
            count={s.rmOrdering ? 1 : 0}
            open={!!openSections.rmSort}
            onToggle={() => toggleSection('rmSort')}
          >
            <SelectFilter
              options={RM_ORDERING}
              value={s.rmOrdering}
              onChange={(v) => {
                s.setRmOrdering(v);
              }}
            />
          </FilterSection>

          <FilterSection
            title="Параметры"
            count={rmMainCount}
            open={!!openSections.rmMain}
            onToggle={() => toggleSection('rmMain')}
          >
            <SubLabel>Тип</SubLabel>
            <TagChecklist
              items={RM_TYPES}
              selected={s.rmTypes}
              onToggle={(v) =>
                s.setRmTypes((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]))
              }
            />
            <FilterRow label="Статус">
              <SelectFilter options={RM_STATUS} value={s.rmStatus} onChange={s.setRmStatus} />
            </FilterRow>
            <FilterRow label="Количество глав">
              <div className="filter-range">
                <input
                  className="filter-input narrow"
                  inputMode="numeric"
                  placeholder="От"
                  aria-label="Глав от"
                  value={s.rmChaptersMin}
                  onChange={(e) => s.setRmChaptersMin(e.target.value.replace(/\D/g, ''))}
                />
                <span>—</span>
                <input
                  className="filter-input narrow"
                  inputMode="numeric"
                  placeholder="До"
                  aria-label="Глав до"
                  value={s.rmChaptersMax}
                  onChange={(e) => s.setRmChaptersMax(e.target.value.replace(/\D/g, ''))}
                />
              </div>
            </FilterRow>
            <FilterRow label="Год выпуска">
              <div className="filter-range">
                <input
                  className="filter-input narrow"
                  inputMode="numeric"
                  placeholder="От"
                  aria-label="Год от"
                  value={s.rmYearMin}
                  onChange={(e) => s.setRmYearMin(e.target.value.replace(/\D/g, ''))}
                />
                <span>—</span>
                <input
                  className="filter-input narrow"
                  inputMode="numeric"
                  placeholder="До"
                  aria-label="Год до"
                  value={s.rmYearMax}
                  onChange={(e) => s.setRmYearMax(e.target.value.replace(/\D/g, ''))}
                />
              </div>
            </FilterRow>
            <FilterRow label="Оценка">
              <div className="filter-range">
                <input
                  className="filter-input narrow"
                  inputMode="decimal"
                  placeholder="От"
                  aria-label="Оценка от"
                  value={s.rmRatingMin}
                  onChange={(e) => s.setRmRatingMin(sanitizeDecimalInput(e.target.value))}
                />
                <span>—</span>
                <input
                  className="filter-input narrow"
                  inputMode="decimal"
                  placeholder="До"
                  aria-label="Оценка до"
                  value={s.rmRatingMax}
                  onChange={(e) => s.setRmRatingMax(sanitizeDecimalInput(e.target.value))}
                />
              </div>
            </FilterRow>
          </FilterSection>

          <FilterSection
            title="Жанры"
            count={s.rmGenres.length}
            open={!!openSections.rmGenres}
            onToggle={() => toggleSection('rmGenres')}
          >
            <input
              className="filter-input full"
              placeholder="Поиск жанра…"
              value={rmGenreQuery}
              onChange={(e) => setRmGenreQuery(e.target.value)}
            />
            <TagChecklist
              items={rmGenreList}
              selected={s.rmGenres}
              onToggle={(v) => {
                s.setRmExcludeGenres((prev) => prev.filter((x) => x !== v));
                s.setRmGenres((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
              }}
            />
          </FilterSection>

          <FilterSection
            title="Категории"
            count={s.rmCategories.length}
            open={!!openSections.rmCategories}
            onToggle={() => toggleSection('rmCategories')}
          >
            <input
              className="filter-input full"
              placeholder="Поиск категории…"
              value={rmCategoryQuery}
              onChange={(e) => setRmCategoryQuery(e.target.value)}
            />
            <TagChecklist
              items={rmCategoryList}
              selected={s.rmCategories}
              onToggle={(v) => {
                s.setRmExcludeCategories((prev) => prev.filter((x) => x !== v));
                s.setRmCategories((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
              }}
            />
          </FilterSection>

          <FilterSection
            title="Исключить жанры"
            count={s.rmExcludeGenres.length}
            open={!!openSections.rmExcludeGenres}
            onToggle={() => toggleSection('rmExcludeGenres')}
          >
            <input
              className="filter-input full"
              placeholder="Найти исключаемый жанр…"
              value={rmExcludeGenreQuery}
              onChange={(e) => setRmExcludeGenreQuery(e.target.value)}
            />
            <TagChecklist
              items={rmExcludeGenreList}
              selected={s.rmExcludeGenres}
              onToggle={(v) => {
                s.setRmGenres((prev) => prev.filter((x) => x !== v));
                s.setRmExcludeGenres((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
              }}
            />
          </FilterSection>

          <FilterSection
            title="Исключить категории"
            count={s.rmExcludeCategories.length}
            open={!!openSections.rmExcludeCategories}
            onToggle={() => toggleSection('rmExcludeCategories')}
          >
            <input
              className="filter-input full"
              placeholder="Найти исключаемую категорию…"
              value={rmExcludeCategoryQuery}
              onChange={(e) => setRmExcludeCategoryQuery(e.target.value)}
            />
            <TagChecklist
              items={rmExcludeCategoryList}
              selected={s.rmExcludeCategories}
              onToggle={(v) => {
                s.setRmCategories((prev) => prev.filter((x) => x !== v));
                s.setRmExcludeCategories((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
              }}
            />
          </FilterSection>
        </>
      )}

      {s.source === 'readmanga' && (
        <>
          <FilterSection
            title="Сортировка"
            count={s.grSortType !== DEFAULT_READMANGA_SORT ? 1 : 0}
            open={!!openSections.grSort}
            onToggle={() => toggleSection('grSort')}
          >
            <SelectFilter options={READMANGA_SORTS} value={s.grSortType} onChange={s.setGrSortType} />
          </FilterSection>

          <FilterSection
            title="Параметры"
            count={grMainCount}
            open={!!openSections.grMain}
            onToggle={() => toggleSection('grMain')}
          >
            <SubLabel>Статус выхода</SubLabel>
            <TagChecklist
              items={READMANGA_PRODUCTION_STATUSES}
              selected={s.grProduction}
              onToggle={(v) =>
                s.setGrProduction((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]))
              }
            />
            <SubLabel>Статус перевода</SubLabel>
            <TagChecklist
              items={READMANGA_TRANSLATION_STATUSES}
              selected={s.grTranslation}
              onToggle={(v) =>
                s.setGrTranslation((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]))
              }
            />
            <FilterRow label="Год выпуска">
              <div className="filter-range">
                <input
                  className="filter-input narrow"
                  inputMode="numeric"
                  placeholder="От"
                  aria-label="Год от"
                  value={s.grYearMin}
                  onChange={(e) => s.setGrYearMin(e.target.value.replace(/\D/g, ''))}
                />
                <span>—</span>
                <input
                  className="filter-input narrow"
                  inputMode="numeric"
                  placeholder="До"
                  aria-label="Год до"
                  value={s.grYearMax}
                  onChange={(e) => s.setGrYearMax(e.target.value.replace(/\D/g, ''))}
                />
              </div>
            </FilterRow>
          </FilterSection>

          <FilterSection
            title="Жанры"
            count={s.grGenres.length}
            open={!!openSections.grGenres}
            onToggle={() => toggleSection('grGenres')}
          >
            <input
              className="filter-input full"
              placeholder="Поиск жанра…"
              value={grGenreQuery}
              onChange={(e) => setGrGenreQuery(e.target.value)}
            />
            <TagChecklist
              items={grGenreList}
              selected={s.grGenres}
              onToggle={(v) => {
                s.setGrExcludeGenres((prev) => prev.filter((x) => x !== v));
                s.setGrGenres((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
              }}
            />
          </FilterSection>

          <FilterSection
            title="Категории"
            count={s.grCategories.length}
            open={!!openSections.grCategories}
            onToggle={() => toggleSection('grCategories')}
          >
            <input
              className="filter-input full"
              placeholder="Поиск категории…"
              value={grCategoryQuery}
              onChange={(e) => setGrCategoryQuery(e.target.value)}
            />
            <TagChecklist
              items={grCategoryList}
              selected={s.grCategories}
              onToggle={(v) => {
                s.setGrExcludeCategories((prev) => prev.filter((x) => x !== v));
                s.setGrCategories((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
              }}
            />
          </FilterSection>

          <FilterSection
            title="Ограничения"
            count={s.grLimitations.length + s.grAnother.length}
            open={!!openSections.grMeta}
            onToggle={() => toggleSection('grMeta')}
          >
            <SubLabel>Возрастной рейтинг</SubLabel>
            <TagChecklist
              items={READMANGA_LIMITATIONS}
              selected={s.grLimitations}
              onToggle={(v) =>
                s.setGrLimitations((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]))
              }
            />
            <SubLabel>Дополнительно</SubLabel>
            <TagChecklist
              items={READMANGA_ANOTHER}
              selected={s.grAnother}
              onToggle={(v) =>
                s.setGrAnother((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]))
              }
            />
          </FilterSection>

          <FilterSection
            title="Подборки"
            count={s.grSearchFilters.length}
            open={!!openSections.grSearch}
            onToggle={() => toggleSection('grSearch')}
          >
            <TagChecklist
              items={READMANGA_SEARCH_FILTERS}
              selected={s.grSearchFilters}
              onToggle={(v) =>
                s.setGrSearchFilters((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]))
              }
            />
          </FilterSection>

          <FilterSection
            title="Исключить жанры"
            count={s.grExcludeGenres.length}
            open={!!openSections.grExcludeGenres}
            onToggle={() => toggleSection('grExcludeGenres')}
          >
            <input
              className="filter-input full"
              placeholder="Найти исключаемый жанр…"
              value={grExcludeGenreQuery}
              onChange={(e) => setGrExcludeGenreQuery(e.target.value)}
            />
            <TagChecklist
              items={grExcludeGenreList}
              selected={s.grExcludeGenres}
              onToggle={(v) => {
                s.setGrGenres((prev) => prev.filter((x) => x !== v));
                s.setGrExcludeGenres((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
              }}
            />
          </FilterSection>

          <FilterSection
            title="Исключить категории"
            count={s.grExcludeCategories.length}
            open={!!openSections.grExcludeCategories}
            onToggle={() => toggleSection('grExcludeCategories')}
          >
            <input
              className="filter-input full"
              placeholder="Найти исключаемую категорию…"
              value={grExcludeCategoryQuery}
              onChange={(e) => setGrExcludeCategoryQuery(e.target.value)}
            />
            <TagChecklist
              items={grExcludeCategoryList}
              selected={s.grExcludeCategories}
              onToggle={(v) => {
                s.setGrCategories((prev) => prev.filter((x) => x !== v));
                s.setGrExcludeCategories((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
              }}
            />
          </FilterSection>
        </>
      )}

      {s.source === 'senkuro' && (
        <>
          <FilterRow label="Сортировка">
            <SelectFilter options={SENKURO_ORDERING} value={s.skOrdering} onChange={s.setSkOrdering} />
          </FilterRow>

          <FilterSection
            title="Статус"
            count={s.skStatus.length + s.skTranslation.length}
            open={openSections.status}
            onToggle={() => toggleSection('status')}
          >
            <SubLabel>Тайтл</SubLabel>
            <TagChecklist items={SENKURO_STATUS} selected={s.skStatus} onToggle={toggleIn(s.setSkStatus)} />
            <SubLabel>Перевод</SubLabel>
            <TagChecklist items={SENKURO_TRANSLATION} selected={s.skTranslation} onToggle={toggleIn(s.setSkTranslation)} />
          </FilterSection>

          <FilterSection
            title="Тип и формат"
            count={s.skType.length + s.skFormat.length}
            open={openSections.kind}
            onToggle={() => toggleSection('kind')}
          >
            <SubLabel>Тип</SubLabel>
            <TagChecklist items={SENKURO_TYPE} selected={s.skType} onToggle={toggleIn(s.setSkType)} />
            <SubLabel>Формат</SubLabel>
            <TagChecklist items={SENKURO_FORMAT} selected={s.skFormat} onToggle={toggleIn(s.setSkFormat)} />
          </FilterSection>

          <FilterSection
            title="Возрастной рейтинг"
            count={s.skRatings.length}
            open={openSections.rating}
            onToggle={() => toggleSection('rating')}
          >
            <TagChecklist
              items={SENKURO_RATING}
              selected={s.skRatings}
              onToggle={toggleIn(s.setSkRatings)}
              disabled={s.settings.show_r34_history ? [] : ['EXPLICIT']}
            />
          </FilterSection>

          <FilterSection
            title="Главы и год"
            count={
              (s.skChaptersFrom ? 1 : 0) + (s.skChaptersTo ? 1 : 0) + (s.skYearFrom ? 1 : 0) + (s.skYearTo ? 1 : 0)
            }
            open={openSections.range}
            onToggle={() => toggleSection('range')}
          >
            <SubLabel>Количество глав</SubLabel>
            <div className="filter-range">
              <input
                className="filter-input"
                type="number"
                min={0}
                placeholder="от"
                value={s.skChaptersFrom || ''}
                onChange={(e) => s.setSkChaptersFrom(Number(e.target.value) || 0)}
              />
              <span className="filter-range-sep">—</span>
              <input
                className="filter-input"
                type="number"
                min={0}
                placeholder="до"
                value={s.skChaptersTo || ''}
                onChange={(e) => s.setSkChaptersTo(Number(e.target.value) || 0)}
              />
            </div>
            <div className="tag-checklist compact">
              {SENKURO_CHAPTER_PRESETS.map(([from, to, label]) => {
                const active = s.skChaptersFrom === from && s.skChaptersTo === to;
                return (
                  <button
                    key={label}
                    className={`tag-check${active ? ' active' : ''}`}
                    onClick={() => {
                      s.setSkChaptersFrom(active ? 0 : from);
                      s.setSkChaptersTo(active ? 0 : to);
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <SubLabel>Год релиза</SubLabel>
            <div className="filter-range">
              <input
                className="filter-input"
                type="number"
                min={0}
                max={2100}
                placeholder="от"
                value={s.skYearFrom || ''}
                onChange={(e) => s.setSkYearFrom(Number(e.target.value) || 0)}
              />
              <span className="filter-range-sep">—</span>
              <input
                className="filter-input"
                type="number"
                min={0}
                max={2100}
                placeholder="до"
                value={s.skYearTo || ''}
                onChange={(e) => s.setSkYearTo(Number(e.target.value) || 0)}
              />
            </div>
          </FilterSection>

          <FilterSection
            title="Первоисточник"
            count={s.skSources.length}
            open={openSections.origin}
            onToggle={() => toggleSection('origin')}
          >
            <TagChecklist items={SENKURO_SOURCE} selected={s.skSources} onToggle={toggleIn(s.setSkSources)} />
          </FilterSection>

          <FilterSection
            title="Страна"
            count={s.skCountries.length}
            open={openSections.country}
            onToggle={() => toggleSection('country')}
          >
            <TagChecklist items={SENKURO_COUNTRY} selected={s.skCountries} onToggle={toggleIn(s.setSkCountries)} />
          </FilterSection>

          <FilterSection
            title="Лейблы"
            count={s.skLabels.length}
            open={openSections.labels}
            onToggle={() => toggleSection('labels')}
          >
            <button type="button" className="label-picker-btn" onClick={() => setLabelsOpen(true)}>
              Выбрать лейблы…
            </button>
            {selectedLabels.length > 0 ? (
              <div className="label-chips">
                {selectedLabels.slice(0, 8).map((l) => (
                  <button
                    key={l.slug}
                    type="button"
                    className="tag-check active"
                    title="Убрать"
                    onClick={() => toggleIn(s.setSkLabels)(l.slug)}
                  >
                    {l.name} ×
                  </button>
                ))}
                {selectedLabels.length > 8 && <span className="filter-note">+{selectedLabels.length - 8}</span>}
              </div>
            ) : (
              <div className="filter-note">Ничего не выбрано</div>
            )}
          </FilterSection>
        </>
      )}

      {s.source === 'comx' && (
        <>
          <FilterSection
            title="Параметры"
            count={cxMainCount}
            open={!!openSections.cxMain}
            onToggle={() => toggleSection('cxMain')}
          >
            <FilterRow label="Раздел">
              <SelectFilter options={COMX_CATEGORY} value={s.cxCategory} onChange={s.setCxCategory} />
            </FilterRow>
            <FilterRow label="Год выпуска">
              <div className="filter-range">
                <input
                  className="filter-input narrow"
                  inputMode="numeric"
                  placeholder="От"
                  aria-label="Год от"
                  value={s.cxYearFrom}
                  onChange={(e) => s.setCxYearFrom(e.target.value.replace(/\D/g, ''))}
                />
                <span>—</span>
                <input
                  className="filter-input narrow"
                  inputMode="numeric"
                  placeholder="До"
                  aria-label="Год до"
                  value={s.cxYearTo}
                  onChange={(e) => s.setCxYearTo(e.target.value.replace(/\D/g, ''))}
                />
              </div>
            </FilterRow>
          </FilterSection>

          <FilterSection
            title="Классификация"
            count={cxClassCount}
            open={!!openSections.cxClass}
            onToggle={() => toggleSection('cxClass')}
          >
            <SubLabel>Тип выпуска</SubLabel>
            <TagChecklist
              items={COMX_TYPES}
              selected={s.cxTypes}
              onToggle={(v) =>
                s.setCxTypes((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]))
              }
            />
            <SubLabel>Статус</SubLabel>
            <TagChecklist
              items={COMX_STATUSES}
              selected={s.cxStatuses}
              onToggle={(v) =>
                s.setCxStatuses((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]))
              }
            />
            <SubLabel>Возрастное ограничение</SubLabel>
            <TagChecklist
              items={COMX_AGES}
              selected={s.cxAges}
              onToggle={(v) => s.setCxAges((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]))}
            />
          </FilterSection>

          <FilterSection
            title="Жанры"
            count={s.cxGenres.length}
            open={!!openSections.cxGenres}
            onToggle={() => toggleSection('cxGenres')}
          >
            <input
              className="filter-input full"
              placeholder="Поиск жанра…"
              value={cxGenreQuery}
              onChange={(e) => setCxGenreQuery(e.target.value)}
            />
            <TagChecklist
              items={cxGenreList}
              selected={s.cxGenres}
              onToggle={(v) => {
                s.setCxExcludeGenres((prev) => prev.filter((x) => x !== v));
                s.setCxGenres((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
              }}
            />
          </FilterSection>

          <FilterSection
            title="Исключить жанры"
            count={s.cxExcludeGenres.length}
            open={!!openSections.cxExclude}
            onToggle={() => toggleSection('cxExclude')}
          >
            <input
              className="filter-input full"
              placeholder="Найти исключаемый жанр…"
              value={cxExcludeGenreQuery}
              onChange={(e) => setCxExcludeGenreQuery(e.target.value)}
            />
            <TagChecklist
              items={cxExcludeGenreList}
              selected={s.cxExcludeGenres}
              onToggle={(v) => {
                s.setCxGenres((prev) => prev.filter((x) => x !== v));
                s.setCxExcludeGenres((prev) =>
                  prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v],
                );
              }}
            />
          </FilterSection>
        </>
      )}
      </div>
      {labelsOpen && (
        <LabelPickerDialog s={s} onClose={() => setLabelsOpen(false)} onToggleLabel={toggleIn(s.setSkLabels)} />
      )}
    </div>
  );
}

import { useState } from 'react';
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
  SENKURO_TRANSLATION,
  SENKURO_SOURCE,
  SENKURO_COUNTRY,
  SENKURO_CHAPTER_PRESETS,
  SENKURO_ORDERING,
  COMX_CATEGORY,
  COMX_GENRE,
} from '@shared/filters';
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

export default function FilterPanel({ s }: { s: CatalogSearch }): JSX.Element {
  const [labelQuery, setLabelQuery] = useState('');
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    status: true,
    kind: true,
    rating: true,
    range: false,
    origin: false,
    labels: false,
  });
  const toggleSection = (key: string): void => setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  const q = labelQuery.trim().toLowerCase();
  const filteredLabels = q
    ? s.skLabelList.filter((l) => l.name.toLowerCase().includes(q) || l.slug.includes(q)).slice(0, 300)
    : s.skLabelList;
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
  const selectedLabels = s.skLabelList.filter((l) => s.skLabels.includes(l.slug));
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
          <TagChecklist
            items={MD_LANGS}
            selected={s.mdLangs}
            onToggle={(code) => {
              s.setMdLangs((prev) => (prev.includes(code) ? prev.filter((l) => l !== code) : [...prev, code]));
            }}
          />
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
            <TagChecklist items={SENKURO_RATING} selected={s.skRatings} onToggle={toggleIn(s.setSkRatings)} />
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
      {labelsOpen && (
        <div className="overlay" onClick={() => setLabelsOpen(false)}>
          <div className="overlay-card label-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="label-modal-head">
              <strong>Лейблы</strong>
              <span className="filter-note">
                {s.skLabels.length > 0 ? `выбрано: ${s.skLabels.length}` : `${s.skLabelList.length} доступно`}
              </span>
              <button className="overlay-close" aria-label="Закрыть" onClick={() => setLabelsOpen(false)}>
                ×
              </button>
            </div>
            <input
              className="filter-input full"
              placeholder="Поиск лейблов…"
              value={labelQuery}
              onChange={(e) => setLabelQuery(e.target.value)}
              autoFocus
            />
            <div className="label-modal-list">
              {filteredLabels.length === 0 ? (
                <div className="filter-note">Ничего не найдено</div>
              ) : (
                filteredLabels.map((l) => (
                  <label key={l.slug} className="label-pick">
                    <input type="checkbox" checked={s.skLabels.includes(l.slug)} onChange={() => toggleIn(s.setSkLabels)(l.slug)} />
                    <span>{l.name}</span>
                  </label>
                ))
              )}
            </div>
            <div className="label-modal-foot">
              <button disabled={s.skLabels.length === 0} onClick={() => s.setSkLabels([])}>
                Очистить
              </button>
              <button className="set-primary" onClick={() => setLabelsOpen(false)}>
                Готово
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

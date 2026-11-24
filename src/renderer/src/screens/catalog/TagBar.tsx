import type { CatalogSearch } from './useCatalogSearch';
import { tagChipStyle, tagNsColor } from '../../lib/tag-colors';


export default function TagBar({ s }: { s: CatalogSearch }): JSX.Element | null {
  if (!s.tagSource && !s.nhTagSource) return null;
  return (
    <div className="tag-bar">
      <div className="tag-input-wrap">
        <input
          className="tag-input"
          aria-label="Тег каталога"
          value={s.tagQuery}
          placeholder="Тег (начни вводить)…"
          onChange={(e) => s.setTagQuery(e.target.value)}
        />
        {((s.tagSource && s.ehTags.length > 0) || (s.nhTagSource && s.nhTags.length > 0)) && (
          <div className="tag-suggestions">
            {s.tagSource &&
              s.ehTags.map((t) => (
                <button key={t.display} className="tag-suggestion" onClick={() => s.appendTag(t.display)}>
                  <span style={{ color: tagNsColor(t.display) }}>●</span> {t.display}
                </button>
              ))}
            {s.nhTagSource &&
              s.nhTags.map((t) => (
                <button key={t.name} className="tag-suggestion" onClick={() => s.appendTag(t.name)}>
                  <span style={{ color: tagNsColor(t.name) }}>●</span> {t.name} <span className="muted">{t.count}</span>
                </button>
              ))}
          </div>
        )}
      </div>
      <div className="fav-tags">
        {s.pickedTags.map((tag) => {
          const excluded = tag.startsWith('!');
          const core = excluded ? tag.slice(1) : tag;
          return (
            <button
              key={tag}
              className={`fav-tag picked-tag${excluded ? ' picked-tag--excluded' : ''}`}
              style={tagChipStyle(core)}
              title={excluded ? 'Клик — убрать тег из поиска' : 'Клик — исключить тег из поиска'}
              onClick={() => s.togglePickedTag(core)}
            >
              {excluded ? `${core} !` : `${core} ×`}
            </button>
          );
        })}
        {s.settings.eh_tag_bookmarks.map((tag) => (
          <button key={tag} className="fav-tag" style={tagChipStyle(tag)} onClick={() => s.appendTag(tag)}>
            {tag}
          </button>
        ))}
        {s.query.trim() && s.tagSource && (
          <button
            className="fav-tag add"
            title="Сохранить теги из строки поиска"
            onClick={() => {
              const tags = s.query
                .trim()
                .split(/\s+/)
                .filter((w) => w.includes(':'));
              if (tags.length) {
                const set = new Set(s.settings.eh_tag_bookmarks);
                tags.forEach((t) => set.add(t));
                s.setSettings({ ...s.settings, eh_tag_bookmarks: [...set] });
              }
            }}
          >
            ★ Сохранить теги
          </button>
        )}
      </div>
    </div>
  );
}

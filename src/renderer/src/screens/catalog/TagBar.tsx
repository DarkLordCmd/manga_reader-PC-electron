import type { CatalogSearch } from './useCatalogSearch';

/** Namespace colors ported from the "Tags Autocomplete" userscript's exhentai
 * palette (E-Hentai family chips live on a dark background, so the site
 * palette (not the light base palette) is the right one). */
const NS_COLORS: Record<string, string> = {
  female: '#9E2722',
  male: '#325CA2',
  language: '#6A936D',
  cosplayer: '#6A32A2',
  parody: '#6A32A2',
  character: '#A23282',
  group: '#DB6C24',
  artist: '#D38F1D',
  mixed: '#AB9F60',
  other: '#8e8e8e',
  reclass: '#8e8e8e',
  temp: '#8e8e8e',
  default: '#8e8e8e',
};
function nsColor(tag: string): string {
  const ns = tag.split(':')[0]?.toLowerCase() ?? '';
  return NS_COLORS[ns] ?? NS_COLORS.default;
}
const nsStyle = (tag: string): React.CSSProperties => ({
  color: nsColor(tag),
  borderColor: `${nsColor(tag)}80`,
});

export default function TagBar({ s }: { s: CatalogSearch }): JSX.Element | null {
  if (!s.tagSource && !s.nhTagSource) return null;
  return (
    <div className="tag-bar">
      <div className="tag-input-wrap">
        <input
          className="tag-input"
          value={s.tagQuery}
          placeholder="Тег (начни вводить)…"
          onChange={(e) => s.setTagQuery(e.target.value)}
        />
        {(s.ehTags.length > 0 || s.nhTags.length > 0) && (
          <div className="tag-suggestions">
            {s.ehTags.map((t) => (
              <button key={t.display} className="tag-suggestion" onClick={() => s.appendTag(t.display)}>
                <span style={{ color: nsColor(t.display) }}>●</span> {t.display}
              </button>
            ))}
            {s.nhTags.map((t) => (
              <button key={t.name} className="tag-suggestion" onClick={() => s.appendTag(t.name)}>
                <span style={{ color: nsColor(t.name) }}>●</span> {t.name} <span className="muted">{t.count}</span>
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
              style={nsStyle(core)}
              title={excluded ? 'Клик — убрать тег из поиска' : 'Клик — исключить тег из поиска'}
              onClick={() => s.togglePickedTag(core)}
            >
              {excluded ? `${core} !` : `${core} ×`}
            </button>
          );
        })}
        {s.settings.eh_tag_bookmarks.map((tag) => (
          <button key={tag} className="fav-tag" style={nsStyle(tag)} onClick={() => s.appendTag(tag)}>
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

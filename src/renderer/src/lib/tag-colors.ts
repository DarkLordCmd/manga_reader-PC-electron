/** Namespace colors ported from the "Tags Autocomplete" userscript's exhentai
 * palette — the same colours the tag bar uses for picked tags, so the chapter
 * overlay reads as the same UI. */
export const TAG_NS_COLORS: Record<string, string> = {
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

/** Deterministic palette for tags without an E-Hentai namespace (Senkuro,
 * Manga-shi, Remanga, nhentai): same tag always gets the same colour, and the
 * chips stop looking like one grey wall. */
const PLAIN_PALETTE = ['#9E2722', '#325CA2', '#6A936D', '#6A32A2', '#A23282', '#DB6C24', '#D38F1D', '#AB9F60', '#5FA9CF', '#7A7A7A'];

function hashTag(tag: string): number {
  let h = 0;
  for (const ch of tag) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** E-Hentai tags look like `namespace:tag`; plain tags get a stable colour. */
export function tagNsColor(tag: string): string {
  const hasNs = tag.includes(':');
  const ns = hasNs ? (tag.split(':')[0]?.toLowerCase() ?? '') : '';
  if (hasNs && TAG_NS_COLORS[ns]) return TAG_NS_COLORS[ns];
  if (hasNs) return TAG_NS_COLORS.default;
  return PLAIN_PALETTE[hashTag(tag) % PLAIN_PALETTE.length];
}

export function tagChipStyle(tag: string): React.CSSProperties {
  const color = tagNsColor(tag);
  return { color, borderColor: `${color}80`, background: `${color}14` };
}

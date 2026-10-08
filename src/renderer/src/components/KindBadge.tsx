/** Exhentai/NHentai work-type chip — the same colored badge the catalog grid
 * shows on each cover. Reused by library / history / favorites cards. */
export function kindColor(kind: string | null | undefined): string {
  switch ((kind ?? '').toLowerCase()) {
    case 'doujinshi':
      return '#f02e2e';
    case 'manga':
      return '#f38a24';
    case 'artist cg':
      return '#d5a311';
    case 'game cg':
      return '#308430';
    case 'western':
      return '#8f8f00';
    case 'non-h':
      return '#1a9dc0';
    case 'image set':
      return '#2e54c4';
    case 'cosplay':
      return '#6e2ec4';
    case 'asian porn':
      return '#c42e8e';
    case 'misc':
      return '#606060';
    case 'манга':
      return '#f38a24';
    case 'манхва':
      return '#d5a311';
    case 'маньхуа':
      return '#1a9dc0';
    default:
      return '#505050';
  }
}

export default function KindBadge({ kind }: { kind?: string | null }): JSX.Element | null {
  if (!kind) return null;
  return (
    <span className="manga-badge" style={{ background: kindColor(kind) }}>
      {kind}
    </span>
  );
}

import type { ChapterDownloadState } from '../lib/use-chapter-downloads';

interface Props {
  state: ChapterDownloadState;
  onDownload: () => void;
}

/** Per-chapter "download" control that sits next to the read toggle. */
export default function ChapterDownloadButton({ state, onDownload }: Props): JSX.Element {
  const label =
    state === 'busy'
      ? 'Добавляю в загрузки…'
      : state === 'done'
        ? 'Глава уже в загрузках'
        : state === 'error'
          ? 'Скачивание не удалось — нажмите, чтобы повторить'
          : 'Скачать главу';
  return (
    <button
      className={`chapter-download${state === 'idle' ? '' : ' ' + state}`}
      title={label}
      aria-label={label}
      disabled={state === 'busy'}
      onClick={(e) => {
        e.stopPropagation();
        onDownload();
      }}
    >
      {state === 'busy' ? (
        <span className="dl-spinner" aria-hidden="true" />
      ) : (
        <svg viewBox="0 0 24 24" className="dl-icon" aria-hidden="true">
          <path d="M12 4.5v9.5M8 10.5 12 14.5l4-4M5 19h14" />
        </svg>
      )}
    </button>
  );
}

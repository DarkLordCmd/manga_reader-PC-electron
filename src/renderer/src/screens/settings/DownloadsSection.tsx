import Section from './Section';
import type { SettingsCommon } from './useSettings';

export default function DownloadsSection({ settings, upd }: SettingsCommon): JSX.Element {
  return (
    <Section title="Downloads">
      <div className="row">
        <label>Папка загрузок:</label>
        <span className="muted" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {settings.downloads_dir ?? 'по умолчанию (userData/downloads)'}
        </span>
        <button
          onClick={async () => {
            const dir = await window.api.downloadsPickDir();
            if (dir) upd({ downloads_dir: dir });
          }}
        >
          Выбрать папку
        </button>
      </div>
    </Section>
  );
}

import Section, { Row } from './Section';
import type { SettingsCommon } from './useSettings';

export default function DownloadsSection({ settings, upd }: SettingsCommon): JSX.Element {
  return (
    <Section title="Загрузки">
      <Row
        label="Папка загрузок"
        stack
        note={settings.downloads_dir ? settings.downloads_dir : 'По умолчанию: userData/downloads'}
      >
        <button
          onClick={async () => {
            const dir = await window.api.downloadsPickDir();
            if (dir) upd({ downloads_dir: dir });
          }}
        >
          Выбрать папку
        </button>
        {settings.downloads_dir && <button onClick={() => upd({ downloads_dir: null })}>Сбросить</button>}
      </Row>
    </Section>
  );
}

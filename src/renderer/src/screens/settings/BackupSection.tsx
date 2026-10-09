import { useState } from 'react';
import Section from './Section';
import Toggle from '../../components/Toggle';

export default function BackupSection(): JSX.Element {
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);

  return (
    <Section title="Резервная копия">
      <div className="row">
        <Toggle checked={includeSecrets} onChange={setIncludeSecrets}>
          Включить секреты (куки, прокси, аккаунты)
        </Toggle>
      </div>
      <div className="row">
        <button
          onClick={async () => {
            const r = await window.api.backupExport(includeSecrets);
            setBackupMsg(r.canceled ? 'Экспорт отменён' : `Сохранено: ${r.path}`);
          }}
        >
          Экспорт
        </button>
        <button
          onClick={async () => {
            const s = await window.api.backupImport();
            setBackupMsg(
              s
                ? `Импорт: +${s.seriesAdded} серий, ${s.seriesUpdated} обновлено, аккаунтов +${s.accountsAdded}, загрузок +${s.downloadsMerged}`
                : 'Импорт отменён или не удался',
            );
          }}
        >
          Импорт
        </button>
      </div>
      {backupMsg && <div className="row muted">{backupMsg}</div>}
    </Section>
  );
}

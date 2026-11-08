import { useState } from 'react';
import Section, { Row } from './Section';
import Toggle from '../../components/Toggle';

export default function BackupSection(): JSX.Element {
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);

  return (
    <Section title="Резервная копия">
      <Row label="Секреты в копии" note="Куки, прокси и аккаунты источников — только для личного архива.">
        <Toggle checked={includeSecrets} onChange={setIncludeSecrets} />
      </Row>
      <Row label="Файл копии">
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
      </Row>
      {backupMsg && (
        <Row stack>
          <span className="set-note">{backupMsg}</span>
        </Row>
      )}
    </Section>
  );
}

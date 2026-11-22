import { useState } from 'react';
import Section, { Row } from './Section';
import Toggle from '../../components/Toggle';
import { errorText } from '../../lib/errors';

export default function BackupSection(): JSX.Element {
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<string>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setBackupMsg(null);
    try {
      setBackupMsg(await fn());
    } catch (e) {
      setBackupMsg(`Ошибка: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Резервная копия">
      <Row label="Секреты в копии" note="Куки, прокси и аккаунты источников — только для личного архива.">
        <Toggle checked={includeSecrets} onChange={setIncludeSecrets} />
      </Row>
      <Row label="Файл копии">
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const r = await window.api.backupExport(includeSecrets);
              return r ? `Сохранено: ${r.path}` : 'Экспорт отменён';
            })
          }
        >
          Экспорт
        </button>
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const s = await window.api.backupImport();
              return s
                ? `Импорт: +${s.seriesAdded} серий, ${s.seriesUpdated} обновлено, аккаунтов +${s.accountsAdded}, загрузок +${s.downloadsMerged}`
                : 'Импорт отменён или не удался';
            })
          }
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

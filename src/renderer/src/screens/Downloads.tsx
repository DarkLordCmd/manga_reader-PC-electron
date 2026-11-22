import { useCallback, useEffect, useState } from 'react';
import type { OpenFolderResult } from '@shared/ipc';
import type { DownloadTask } from '@shared/downloads';
import { useStore } from '../state/store';
import { startPageFor } from '@shared/settings';
import { errorText } from '../lib/errors';

/** Raw `state` values (queued/running/paused/completed/error) were rendered
 * verbatim in an otherwise Russian UI. */
const STATE_LABELS: Record<DownloadTask['state'], string> = {
  queued: 'В очереди',
  running: 'Скачивается',
  paused: 'Пауза',
  completed: 'Готово',
  error: 'Ошибка',
};

export default function Downloads(): JSX.Element {
  const { setOpened, setScreen, settings } = useStore();
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const load = (): void => {
      void window.api
        .downloadsList()
        .then(setTasks)
        .catch((e) => setError(errorText(e)));
    };
    load();
    return window.api.onDownloadsChanged(setTasks);
  }, []);

  useEffect(() => {
    void window.api.downloadsCheckChapters().catch(() => {});
  }, []);

  const open = async (id: string): Promise<void> => {
    setError(null);
    try {
      const r: OpenFolderResult | null = await window.api.downloadsOpen(id);
      if (!r) {
        setError('Папка загрузки не найдена — возможно, её переместили или удалили');
        return;
      }
      const saved = startPageFor(r.url, settings.read_progress);
      setOpened({ kind: 'local', ...r, startPage: saved });
      setScreen('Reader');
    } catch (e) {
      setError(errorText(e));
    }
  };

  const checkUpdates = async (): Promise<void> => {
    if (checking) return;
    setChecking(true);
    setError(null);
    try {
      await window.api.downloadsCheckUpdates();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setChecking(false);
    }
  };

  const taskAction = useCallback(async (id: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusyId(id);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusyId(null);
    }
  }, []);

  return (
    <div className="screen downloads">
      {error && <div className="error-text">{error}</div>}
      {tasks.some((t) => t.state === 'completed') && (
        <button disabled={checking} onClick={() => void checkUpdates()}>
          {checking ? 'Проверяю…' : 'Проверить обновления'}
        </button>
      )}
      {tasks.length === 0 && <div className="muted">Нет загрузок</div>}
      {tasks.map((t) => (
        <div key={t.id} className="dl-row">
          <span className="dl-title">{t.title}</span>
          <progress max={Math.max(1, t.totalPages)} value={t.completedPages.length} />
          <span className="muted">
            {t.completedPages.length}/{t.totalPages}
          </span>
          <span className={`muted${t.state === 'error' ? ' error-text' : ''}`}>
            {STATE_LABELS[t.state] ?? t.state}
            {t.error ? `: ${t.error}` : ''}
          </span>
          {t.state === 'running' && (
            <button disabled={busyId === t.id} onClick={() => void taskAction(t.id, () => window.api.downloadsPause(t.id))}>
              Пауза
            </button>
          )}
          {(t.state === 'paused' || t.state === 'error') && (
            <button disabled={busyId === t.id} onClick={() => void taskAction(t.id, () => window.api.downloadsResume(t.id))}>
              Продолжить
            </button>
          )}
          {(t.newChapters ?? 0) > 0 && <span className="dl-badge">{t.newChapters} новых глав</span>}
          {(t.newChapters ?? 0) > 0 && t.latestChapterId && (
            <button onClick={() => void window.api.downloadsAdd(t.latestChapterId!).catch((e) => setError(errorText(e)))}>
              Скачать новую главу
            </button>
          )}
          {t.state === 'completed' && (
            <button disabled={busyId === t.id} onClick={() => void open(t.id)}>
              Открыть
            </button>
          )}
          <button
            title={t.priority > 0 ? 'Снять повышенный приоритет' : 'Скачивать первым'}
            onClick={() =>
              void taskAction(t.id, () => window.api.downloadsSetPriority(t.id, t.priority === 10 ? 0 : 10))
            }
          >
            {t.priority > 0 ? '↓ приоритет' : '↑ приоритет'}
          </button>
          <button
            title="Убрать из списка"
            disabled={busyId === t.id}
            onClick={() => void taskAction(t.id, () => window.api.downloadsRemove(t.id))}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

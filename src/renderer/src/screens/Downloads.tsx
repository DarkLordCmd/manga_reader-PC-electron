import { useEffect, useState } from 'react';
import type { OpenFolderResult } from '@shared/ipc';
import type { DownloadTask } from '@shared/downloads';
import { useStore } from '../state/store';
import { startPageFor } from '@shared/settings';

export default function Downloads(): JSX.Element {
  const { setOpened, setScreen, settings } = useStore();
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  useEffect(() => {
    window.api.downloadsList().then(setTasks);
    return window.api.onDownloadsChanged(setTasks);
  }, []);

  useEffect(() => {
    void window.api.downloadsCheckChapters().catch(() => {});
  }, []);

  const open = async (id: string): Promise<void> => {
    const r: OpenFolderResult | null = await window.api.downloadsOpen(id);
    if (r) {
      const saved = startPageFor(r.url, settings.read_progress);
      setOpened({ kind: 'local', ...r, startPage: saved });
      setScreen('Reader');
    }
  };
  return (
    <div className="screen downloads">
      <h3>Downloads</h3>
      {tasks.some((t) => t.state === 'completed') && (
        <button
          onClick={async () => {
            await window.api.downloadsCheckUpdates();
          }}
        >
          Check updates
        </button>
      )}
      {tasks.length === 0 && <div className="muted">Нет загрузок</div>}
      {tasks.map((t) => (
        <div key={t.id} className="dl-row">
          <span className="dl-title">{t.title}</span>
          <progress max={t.totalPages} value={t.completedPages.length} />
          <span className="muted">
            {t.completedPages.length}/{t.totalPages}
          </span>
          <span className="muted">
            {t.state}
            {t.error ? `: ${t.error}` : ''}
          </span>
          {t.state === 'running' && <button onClick={() => void window.api.downloadsPause(t.id)}>Pause</button>}
          {(t.state === 'paused' || t.state === 'error') && <button onClick={() => void window.api.downloadsResume(t.id)}>Resume</button>}
          {(t.newChapters ?? 0) > 0 && <span className="dl-badge">{t.newChapters} новых глав</span>}
          {(t.newChapters ?? 0) > 0 && t.latestChapterId && (
            <button onClick={() => void window.api.downloadsAdd(t.latestChapterId!)}>Скачать новую главу</button>
          )}
          {t.state === 'completed' && <button onClick={() => void open(t.id)}>Open</button>}
          <button onClick={() => void window.api.downloadsSetPriority(t.id, t.priority === 10 ? 0 : 10)}>
            {t.priority > 0 ? '↓prio' : '↑prio'}
          </button>
          <button onClick={() => void window.api.downloadsRemove(t.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}

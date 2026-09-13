import { useEffect, useState } from 'react'
import type { DownloadTask } from '@shared/downloads'

export default function Downloads(): JSX.Element {
  const [tasks, setTasks] = useState<DownloadTask[]>([])
  useEffect(() => {
    window.api.downloadsList().then(setTasks)
    return window.api.onDownloadsChanged(setTasks)
  }, [])
  return (
    <div className="screen downloads">
      <h3>Downloads</h3>
      {tasks.length === 0 && <div className="muted">Нет загрузок</div>}
      {tasks.map((t) => (
        <div key={t.id} className="dl-row">
          <span className="dl-title">{t.title}</span>
          <progress max={t.totalPages} value={t.completedPages.length} />
          <span className="muted">{t.completedPages.length}/{t.totalPages}</span>
          <span className="muted">{t.state}{t.error ? `: ${t.error}` : ''}</span>
          {t.state === 'running' && <button onClick={() => void window.api.downloadsPause(t.id)}>Pause</button>}
          {(t.state === 'paused' || t.state === 'error') && <button onClick={() => void window.api.downloadsResume(t.id)}>Resume</button>}
          <button onClick={() => void window.api.downloadsSetPriority(t.id, t.priority === 10 ? 0 : 10)}>{t.priority > 0 ? '↓prio' : '↑prio'}</button>
          <button onClick={() => void window.api.downloadsRemove(t.id)}>✕</button>
        </div>
      ))}
    </div>
  )
}

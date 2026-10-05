import { useEffect, useState } from 'react'
import type { LibraryItem, ReadingStatus } from '@shared/library'
import { READING_STATUSES } from '@shared/library'

const STATUS_LABELS: Record<ReadingStatus, string> = {
  reading: 'Reading', planned: 'Planned', completed: 'Completed',
  on_hold: 'On hold', dropped: 'Dropped'
}

interface Props {
  item: LibraryItem
  onClose: () => void
  onOpen: () => void
  onChanged: () => void
}

export default function LibraryItemModal({ item, onClose, onOpen, onChanged }: Props): JSX.Element {
  const [status, setStatus] = useState<ReadingStatus | ''>(item.status ?? '')
  const [rating, setRating] = useState(item.rating ?? 0)
  const [note, setNote] = useState(item.note)
  const [tags, setTags] = useState(item.tags.join(', '))

  useEffect(() => {
    setStatus(item.status ?? ''); setRating(item.rating ?? 0); setNote(item.note); setTags(item.tags.join(', '))
  }, [item.key])

  const save = async (): Promise<void> => {
    await window.api.librarySetStatus(item.key, status === '' ? null : status)
    await window.api.librarySetRating(item.key, rating > 0 ? rating : null)
    await window.api.librarySetNote(item.key, note)
    await window.api.librarySetTags(item.key, tags.split(',').map((t) => t.trim()).filter(Boolean))
    onChanged()
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay-card chapters" onClick={(e) => e.stopPropagation()}>
        <h3>{item.title || 'Без названия'}</h3>
        <div className="row">
          <label>Статус:</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as ReadingStatus | '')}>
            <option value="">— не в библиотеке —</option>
            {READING_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </div>
        <div className="row">
          <label>Оценка: {rating > 0 ? rating : '—'}</label>
          <input type="range" min={0} max={10} step={1} value={rating} onChange={(e) => setRating(Number(e.target.value))} />
        </div>
        <div className="row">
          <label>Заметка:</label>
        </div>
        <textarea className="cookie-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="row">
          <label>Теги (через запятую):</label>
        </div>
        <input className="text-input" value={tags} onChange={(e) => setTags(e.target.value)} />
        <div className="row">
          <button onClick={onOpen}>▶ Открыть</button>
          <button onClick={() => void save()}>Сохранить</button>
          <button onClick={async () => { await window.api.libraryRemove(item.key); onChanged() }}>Убрать из библиотеки</button>
          <button onClick={async () => {
            if (!window.confirm('Удалить запись из истории и библиотеки?')) return
            await window.api.libraryDelete(item.key); onChanged()
          }}>Удалить из истории</button>
          <button onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  )
}

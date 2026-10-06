import type { ReadingStatus } from '@shared/library'
import { STATUS_LABELS } from '../lib/library-menu'

const COLORS: Record<ReadingStatus, string> = {
  reading: '#2e8b57', planned: '#3a6ea5', completed: '#7a5cc4', on_hold: '#b5851f', dropped: '#8a3b3b'
}

/** Reading-status chip shown on catalog cards for works already in the library. */
export default function StatusBadge({ status }: { status?: ReadingStatus | null }): JSX.Element | null {
  if (!status) return null
  return <span className="manga-badge status-badge" style={{ background: COLORS[status] }}>{STATUS_LABELS[status]}</span>
}

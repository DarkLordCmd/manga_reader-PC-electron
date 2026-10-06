import { READING_STATUSES, type ReadingStatus } from '@shared/library'
import type { MenuItem } from '../components/ContextMenu'

export const STATUS_LABELS: Record<ReadingStatus, string> = {
  reading: 'Читаю', planned: 'В планах', completed: 'Прочитано',
  on_hold: 'Отложено', dropped: 'Брошено'
}

export interface MenuSubject {
  url: string
  title: string
  coverUrl: string | null
  source: string
  seriesId: string
}

export interface MenuState {
  key: string | null
  favorited: boolean
  status: ReadingStatus | null
}

/** Shared library/favorites context menu (catalog, library, favorites, history):
 * favorite toggle, reading-status group, and remove-from-library. Callers may
 * append extra items (e.g. "Удалить из истории"). */
export function buildLibraryMenuItems(subject: MenuSubject, state: MenuState, extra: MenuItem[] = []): MenuItem[] {
  const items: MenuItem[] = []
  if (state.favorited && state.key) {
    items.push({ label: 'Убрать из избранного', checked: true, onClick: () => void window.api.librarySetFavorite(state.key!, null) })
  } else {
    items.push({ label: '★ В избранное', onClick: () => void window.api.libraryAddFavorite(subject) })
  }
  items.push({ label: '', separator: true, onClick: () => {} })
  items.push({ label: 'Статус', disabled: true, onClick: () => {} })
  for (const s of READING_STATUSES) {
    items.push({ label: STATUS_LABELS[s], checked: state.status === s, onClick: () => void window.api.librarySetStatusFor(subject, s) })
  }
  if (state.status && state.key) {
    items.push({ label: '', separator: true, onClick: () => {} })
    items.push({ label: 'Убрать из библиотеки', danger: true, onClick: () => void window.api.libraryRemove(state.key!) })
  }
  if (extra.length > 0) {
    items.push({ label: '', separator: true, onClick: () => {} })
    items.push(...extra)
  }
  return items
}

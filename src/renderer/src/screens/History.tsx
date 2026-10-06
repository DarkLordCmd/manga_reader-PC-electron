import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../state/store'
import type { HistoryEntry } from '@shared/types'
import type { ReadingStatus } from '@shared/library'
import HistoryCardGrid from '../components/HistoryCardGrid'
import ContextMenu from '../components/ContextMenu'
import { buildLibraryMenuItems } from '../lib/library-menu'

export default function History(): JSX.Element {
  const { settings, setOpened, setScreen } = useStore()
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [activeTab, setActiveTab] = useState(0)
  const [menu, setMenu] = useState<{ x: number; y: number; entry: HistoryEntry; lookup: { key: string; favorited: boolean; status: ReadingStatus | null } | null } | null>(null)

  const refresh = useCallback(() => {
    window.api.getHistory().then(setEntries)
  }, [])

  useEffect(refresh, [refresh])

  useEffect(() => window.api.onLibraryChanged(refresh), [refresh])

  const visible = activeTab === 1 && settings.show_r34_history
    ? entries.filter((e) => e.category === 'r34')
    : entries.filter((e) => e.category === 'main')

  const clear = async (): Promise<void> => {
    await window.api.clearHistory()
    refresh()
  }

  const onContinue = async (e: HistoryEntry): Promise<void> => {
    if (e.url.startsWith('file://')) {
      const g = await window.api.openFolder(e.url.slice('file://'.length))
      if (g) {
        setOpened({ kind: 'local', ...g, startPage: Math.max(0, e.current_page - 1) })
        setScreen('Reader')
      }
      return
    }
    const r = await window.api.openUrl(e.url, Math.max(0, e.current_page - 1), e.series_id, e.cover_url ?? null)
    if (r) {
      setOpened({ kind: 'online', ...r, startPage: Math.max(0, e.current_page - 1), coverUrl: e.cover_url ?? null })
      setScreen('Reader')
      // Fetch the chapter list so the reader can show chapters and
      // auto-advance to the next one (mirrors the original app's
      // background chapter fetch on "Continue").
      void window.api.fetchChapterList(e.series_id).then((chapters) => {
        const idx = chapters.findIndex((c) => c.chapter_id === e.url)
        setOpened((prev) => (prev && prev.kind === 'online' && prev.url === e.url
          ? { ...prev, chapterList: chapters, chapterIndex: idx >= 0 ? idx : null }
          : prev))
      }).catch(() => { /* leave as-is */ })
    }
  }

  const openMenu = useCallback(async (e: React.MouseEvent, entry: HistoryEntry) => {
    e.preventDefault()
    const lookup = await window.api.libraryLookup(entry.url, entry.series_id)
    setMenu({ x: e.clientX, y: e.clientY, entry, lookup })
  }, [])

  return (
    <div className="screen">
      <div className="history-toolbar">
        <button className={activeTab === 0 ? 'tab active' : 'tab'} onClick={() => setActiveTab(0)}>📖 Main</button>
        {settings.show_r34_history && (
          <button className={activeTab === 1 ? 'tab active' : 'tab'} onClick={() => setActiveTab(1)}>🔞 R34</button>
        )}
        <div className="spacer" />
        <button onClick={() => void clear()}>🗑 Очистить</button>
      </div>
      {visible.length === 0
        ? <div className="empty muted">Нет истории просмотров</div>
        : <HistoryCardGrid
            entries={visible}
            onContinue={(e) => void onContinue(e)}
            onContextMenu={(e, entry) => void openMenu(e, entry)}
            onAddToLibrary={(e) => void window.api.libraryAdd({
              url: e.url, title: e.title, coverUrl: e.cover_url, source: e.source, seriesId: e.series_id
            })}
          />}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={buildLibraryMenuItems(
            { url: menu.entry.url, title: menu.entry.title, coverUrl: menu.entry.cover_url, source: menu.entry.source, seriesId: menu.entry.series_id },
            { key: menu.lookup?.key ?? null, favorited: !!menu.lookup?.favorited, status: menu.lookup?.status ?? null },
            [{
              label: 'Удалить из истории', danger: true, onClick: async () => {
                const l = menu.lookup?.key ? menu.lookup : await window.api.libraryLookup(menu.entry.url, menu.entry.series_id)
                if (l) await window.api.libraryDelete(l.key)
                refresh()
              }
            }]
          )}
        />
      )}
    </div>
  )
}
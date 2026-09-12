import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../state/store'
import type { HistoryEntry } from '@shared/types'
import HistoryCardGrid from '../components/HistoryCardGrid'

export default function History(): JSX.Element {
  const { settings, setOpened, setScreen } = useStore()
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [activeTab, setActiveTab] = useState(0)

  const refresh = useCallback(() => {
    window.api.getHistory().then(setEntries)
  }, [])

  useEffect(refresh, [refresh])

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
    const r = await window.api.openUrl(e.url, Math.max(0, e.current_page - 1), e.series_id)
    if (r) {
      setOpened({ kind: 'online', ...r, startPage: Math.max(0, e.current_page - 1) })
      setScreen('Reader')
    }
  }

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
        : <HistoryCardGrid entries={visible} onContinue={(e) => void onContinue(e)} />}
    </div>
  )
}
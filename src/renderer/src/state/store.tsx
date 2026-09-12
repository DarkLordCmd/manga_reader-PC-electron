import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Settings } from '@shared/settings'
import { defaultSettings } from '@shared/settings'
import type { ChapterListItem } from '@shared/ipc'

export type Screen = 'Reader' | 'Catalog' | 'History' | 'Settings'

export type OpenedGallery =
  | { kind: 'local'; id: string; title: string; pageCount: number; pages: string[]; url: string; startPage: number }
  | { kind: 'online'; id: string; title: string; pageCount: number; source: string; url: string; startPage: number; mangaId: string | null; chapterList?: ChapterListItem[] | null; chapterIndex?: number | null }

interface Store {
  screen: Screen
  setScreen: (s: Screen) => void
  settings: Settings
  setSettings: (s: Settings) => void
  opened: OpenedGallery | null
  setOpened: (g: OpenedGallery | null) => void
  pendingChapterList: { mangaId: string; title: string } | null
  setPendingChapterList: (v: { mangaId: string; title: string } | null) => void
}

const Ctx = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const [screen, setScreen] = useState<Screen>('Reader')
  const [settings, setSettingsState] = useState<Settings>(defaultSettings())
  const [opened, setOpened] = useState<OpenedGallery | null>(null)
  const [pendingChapterList, setPendingChapterList] = useState<{ mangaId: string; title: string } | null>(null)

  useEffect(() => {
    window.api.getSettings().then(setSettingsState)
  }, [])

  const setSettings = (s: Settings): void => {
    setSettingsState(s)
    window.api.setSettings(s)
  }

  return (
    <Ctx.Provider value={{
      screen, setScreen, settings, setSettings, opened, setOpened,
      pendingChapterList, setPendingChapterList
    }}>{children}</Ctx.Provider>
  )
}

export function useStore(): Store {
  const v = useContext(Ctx)
  if (!v) throw new Error('useStore outside provider')
  return v
}
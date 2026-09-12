import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Settings } from '@shared/settings'
import { defaultSettings } from '@shared/settings'

type Screen = 'Reader' | 'Catalog' | 'History' | 'Settings'

interface Store {
  screen: Screen
  setScreen: (s: Screen) => void
  settings: Settings
  setSettings: (s: Settings) => void
}

const Ctx = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const [screen, setScreen] = useState<Screen>('Reader')
  const [settings, setSettingsState] = useState<Settings>(defaultSettings())

  useEffect(() => {
    window.api.getSettings().then(setSettingsState)
  }, [])

  const setSettings = (s: Settings): void => {
    setSettingsState(s)
    window.api.setSettings(s)
  }

  return <Ctx.Provider value={{ screen, setScreen, settings, setSettings }}>{children}</Ctx.Provider>
}

export function useStore(): Store {
  const v = useContext(Ctx)
  if (!v) throw new Error('useStore outside provider')
  return v
}
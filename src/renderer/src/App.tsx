import { useEffect, useState } from 'react'
import { StoreProvider, useStore } from './state/store'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import LockScreen from './components/LockScreen'
import Reader from './screens/Reader'
import Catalog from './screens/Catalog'
import Library from './screens/Library'
import History from './screens/History'
import Settings from './screens/Settings'
import Downloads from './screens/Downloads'

function Shell(): JSX.Element {
  const { screen } = useStore()
  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <TopBar />
        {screen === 'Reader' && <Reader />}
        {screen === 'Catalog' && <Catalog />}
        {screen === 'Library' && <Library />}
        {screen === 'History' && <History />}
        {screen === 'Downloads' && <Downloads />}
        {screen === 'Settings' && <Settings />}
      </div>
    </div>
  )
}

export default function App(): JSX.Element {
  const [unlocked, setUnlocked] = useState<boolean | null>(null)
  useEffect(() => {
    window.api.pinHasPin().then((has) => setUnlocked(!has))
  }, [])
  if (unlocked === null) return <div className="app" />
  if (!unlocked) return <LockScreen onUnlock={() => setUnlocked(true)} />
  return <StoreProvider><Shell /></StoreProvider>
}
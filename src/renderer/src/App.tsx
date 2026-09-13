import { StoreProvider, useStore } from './state/store'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import Reader from './screens/Reader'
import Catalog from './screens/Catalog'
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
        {screen === 'History' && <History />}
        {screen === 'Downloads' && <Downloads />}
        {screen === 'Settings' && <Settings />}
      </div>
    </div>
  )
}

export default function App(): JSX.Element {
  return <StoreProvider><Shell /></StoreProvider>
}
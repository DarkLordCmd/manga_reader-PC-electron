import { useStore } from '../state/store'

const ITEMS: { key: 'Reader' | 'Catalog' | 'History' | 'Settings'; icon: string; label: string }[] = [
  { key: 'Reader', icon: '\u25B6', label: 'Reader' },
  { key: 'Catalog', icon: '\u2630', label: 'Catalog' },
  { key: 'History', icon: '\u{1F4DC}', label: 'History' },
  { key: 'Settings', icon: '\u2699', label: 'Settings' }
]

export default function Sidebar(): JSX.Element {
  const { screen, setScreen } = useStore()
  return (
    <nav className="sidebar">
      {ITEMS.map((it) => (
        <button
          key={it.key}
          title={it.label}
          className={`nav-btn${screen === it.key ? ' active' : ''}`}
          onClick={() => setScreen(it.key)}
        >
          {it.icon}
        </button>
      ))}
    </nav>
  )
}
import { useStore } from '../state/store'

const ITEMS: { key: 'Reader' | 'Catalog' | 'Popular' | 'Library' | 'Favorites' | 'History' | 'Downloads' | 'Settings'; icon: string; label: string }[] = [
  { key: 'Reader', icon: '\u25B6', label: 'Reader' },
  { key: 'Catalog', icon: '\u2630', label: 'Catalog' },
  { key: 'Popular', icon: '\u{1F525}', label: 'Popular' },
  { key: 'Library', icon: '\u2605', label: 'Library' },
  { key: 'Favorites', icon: '\u2665', label: 'Favorites' },
  { key: 'History', icon: '\u{1F4DC}', label: 'History' },
  { key: 'Downloads', icon: '\u2B73', label: 'Downloads' },
  { key: 'Settings', icon: '\u2699', label: 'Settings' }
]

export default function Sidebar(): JSX.Element {
  const { screen, setScreen, settings } = useStore()
  const items = settings.show_r34_history ? ITEMS : ITEMS.filter((it) => it.key !== 'Popular')
  return (
    <nav className="sidebar">
      {items.map((it) => (
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
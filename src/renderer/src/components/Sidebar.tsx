import type { ReactElement } from 'react';
import { useStore } from '../state/store';

type ScreenKey = 'Reader' | 'Catalog' | 'Popular' | 'Library' | 'Favorites' | 'History' | 'Downloads' | 'Settings';

/** Inline SVG instead of text/emoji glyphs: ⚙ ★ ♥ 🔥 📜 have different
 * metrics and Windows renders emoji in colour, so the buttons looked off-centre
 * and unevenly spaced. A single 24×24 grid with one stroke weight keeps the
 * whole rail optically aligned. */
const ICONS: Record<ScreenKey, ReactElement> = {
  Reader: (
    <svg viewBox="0 0 24 24" className="nav-icon" aria-hidden="true">
      <path d="M8 5.5v13l10-6.5-10-6.5Z" />
    </svg>
  ),
  Catalog: (
    <svg viewBox="0 0 24 24" className="nav-icon" aria-hidden="true">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  ),
  Popular: (
    <svg viewBox="0 0 24 24" className="nav-icon" aria-hidden="true">
      <path d="M12 3c.6 3.2 2.2 4.4 3.4 6.1A6.6 6.6 0 0 1 16.6 13a4.6 4.6 0 0 1-9.2 0c0-1.6.6-2.7 1.4-3.7.2 1.6 1 2.6 2 2.9C10.4 9.4 11.6 6.9 12 3Z" />
    </svg>
  ),
  Library: (
    <svg viewBox="0 0 24 24" className="nav-icon" aria-hidden="true">
      <path d="m12 4 2.5 5.1 5.5.8-4 3.9.9 5.5L12 16.7l-4.9 2.6.9-5.5-4-3.9 5.5-.8L12 4Z" />
    </svg>
  ),
  Favorites: (
    <svg viewBox="0 0 24 24" className="nav-icon" aria-hidden="true">
      <path d="M12 20.5s-7.2-4.7-7.2-9.4a4.1 4.1 0 0 1 7.2-2.7 4.1 4.1 0 0 1 7.2 2.7c0 4.7-7.2 9.4-7.2 9.4Z" />
    </svg>
  ),
  History: (
    <svg viewBox="0 0 24 24" className="nav-icon" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  ),
  Downloads: (
    <svg viewBox="0 0 24 24" className="nav-icon" aria-hidden="true">
      <path d="M12 4v10.5M7.5 10.5 12 15l4.5-4.5M4.5 18.5h15" />
    </svg>
  ),
  Settings: (
    <svg viewBox="0 0 24 24" className="nav-icon" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  ),
};

const ITEMS: { key: ScreenKey; label: string }[] = [
  { key: 'Reader', label: 'Reader' },
  { key: 'Catalog', label: 'Catalog' },
  { key: 'Popular', label: 'Popular' },
  { key: 'Library', label: 'Library' },
  { key: 'Favorites', label: 'Favorites' },
  { key: 'History', label: 'History' },
  { key: 'Downloads', label: 'Downloads' },
  { key: 'Settings', label: 'Settings' },
];

export default function Sidebar(): JSX.Element {
  const { screen, setScreen, settings } = useStore();
  const items = settings.show_r34_history ? ITEMS : ITEMS.filter((it) => it.key !== 'Popular');
  return (
    <nav className="sidebar">
      {items.map((it) => (
        <button
          key={it.key}
          title={it.label}
          aria-label={it.label}
          aria-current={screen === it.key ? 'page' : undefined}
          className={`nav-btn${screen === it.key ? ' active' : ''}`}
          onClick={() => setScreen(it.key)}
        >
          {ICONS[it.key]}
        </button>
      ))}
    </nav>
  );
}

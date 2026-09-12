import { useEffect } from 'react'

export interface HotkeyHandlers {
  onPrev: () => void
  onNext: () => void
  onToggleThumbs: () => void
  onToggleMode: () => void
  onToggleHelp: () => void
}

export function useHotkeys(h: HotkeyHandlers): void {
  useEffect(() => {
    const fn = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      switch (e.key) {
        case 'ArrowLeft': case 'a': case 'A': h.onPrev(); break
        case 'ArrowRight': case 'd': case 'D': h.onNext(); break
        case 'ArrowUp': case 'w': case 'W': h.onPrev(); break
        case 'ArrowDown': case 's': case 'S': h.onNext(); break
        case 't': case 'T': h.onToggleThumbs(); break
        case 'm': case 'M': h.onToggleMode(); break
        case '?': h.onToggleHelp(); break
      }
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [h])
}
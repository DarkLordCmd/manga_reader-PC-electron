import { useEffect } from 'react'

export interface HotkeyHandlers {
  onPrev: () => void
  onNext: () => void
  onToggleThumbs: () => void
  onToggleMode: () => void
  onToggleHelp: () => void
  onToggleImmersive?: () => void
}

export function useHotkeys(h: HotkeyHandlers, rtl = false): void {
  useEffect(() => {
    const fn = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      switch (e.key) {
        case 'ArrowLeft': case 'a': case 'A': rtl ? h.onNext() : h.onPrev(); break
        case 'ArrowRight': case 'd': case 'D': rtl ? h.onPrev() : h.onNext(); break
        case 'ArrowUp': case 'w': case 'W': h.onPrev(); break
        case 'ArrowDown': case 's': case 'S': h.onNext(); break
        case 't': case 'T': h.onToggleThumbs(); break
        case 'm': case 'M': h.onToggleMode(); break
        case 'h': case 'H': h.onToggleImmersive?.(); break
        case 'f': case 'F': h.onToggleImmersive?.(); break
        case '?': h.onToggleHelp(); break
      }
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [h, rtl])
}
import { useEffect } from 'react';

export interface HotkeyHandlers {
  onPrev: () => void;
  onNext: () => void;
  onToggleThumbs: () => void;
  onToggleMode: () => void;
  onToggleHelp: () => void;
  onToggleImmersive?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomReset?: () => void;
}

/**
 * Reader hotkeys.
 *
 * Letters are matched by PHYSICAL key (`e.code`), not by `e.key`: the UI is
 * Russian, and on a RU layout the physical A/D/W/S/T/M/H/F produce "ф/в/ц/ы/е/ь/р/а" —
 * with `e.key` every letter shortcut was dead for those users. Modifier
 * combinations are ignored so Ctrl+A / Ctrl+D / Ctrl+H do not turn pages while
 * the user is selecting text or using browser shortcuts.
 */
export function useHotkeys(h: HotkeyHandlers, rtl = false, disabled = false): void {
  useEffect(() => {
    if (disabled) return;
    const fn = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      switch (e.code) {
        case 'ArrowLeft':
          if (rtl) h.onNext();
          else h.onPrev();
          break;
        case 'ArrowRight':
          if (rtl) h.onPrev();
          else h.onNext();
          break;
        case 'ArrowUp':
          h.onPrev();
          break;
        case 'ArrowDown':
          h.onNext();
          break;
        case 'KeyA':
          if (rtl) h.onNext();
          else h.onPrev();
          break;
        case 'KeyD':
          if (rtl) h.onPrev();
          else h.onNext();
          break;
        case 'KeyW':
          h.onPrev();
          break;
        case 'KeyS':
          h.onNext();
          break;
        case 'KeyT':
          h.onToggleThumbs();
          break;
        case 'KeyM':
          h.onToggleMode();
          break;
        case 'KeyH':
        case 'KeyF':
          h.onToggleImmersive?.();
          break;
        case 'Equal':
        case 'NumpadAdd':
          h.onZoomIn?.();
          break;
        case 'Minus':
        case 'NumpadSubtract':
          h.onZoomOut?.();
          break;
        case 'Digit0':
        case 'Numpad0':
          h.onZoomReset?.();
          break;
        case 'Slash':
        case 'Digit7':
          // "?" is Shift+Slash on an EN layout and Shift+7 on a RU one.
          if (e.shiftKey) h.onToggleHelp();
          break;
        default:
          if (e.key === '?') h.onToggleHelp();
          break;
      }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [h, rtl, disabled]);
}

import { useEffect, useRef, type RefObject } from 'react';

let locks = 0;

/**
 * Freezes the scroll container behind an open modal.
 *
 * Overlays are fixed-position children of the scrolling `.screen`, so a wheel
 * over the backdrop (or past the end of the modal's own list) scrolled the list
 * behind it — after closing, the grid was somewhere else entirely. `overflow:
 * hidden` on `.screen` stops the chaining. A reference count keeps nested
 * dialogs working (the last one to close restores scrolling).
 */
export function useBodyScrollLock(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    locks++;
    document.body.classList.add('modal-open');
    return () => {
      locks = Math.max(0, locks - 1);
      if (locks === 0) document.body.classList.remove('modal-open');
    };
  }, [enabled]);
}

const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Shared dialog keyboard behavior: initial focus, Tab containment, Escape,
 * and focus restoration. The close callback is kept in a ref so parent
 * re-renders never yank focus back to the first control. */
export function useDialogFocus(onClose: () => void, initialFocusRef?: RefObject<HTMLElement>, enabled = true): RefObject<HTMLDivElement> {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!enabled) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = (): HTMLElement[] =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
    const focusInitial = (): void => {
      const target = initialFocusRef?.current ?? focusables()[0] ?? dialog;
      if (target === dialog) dialog.tabIndex = -1;
      target.focus({ preventScroll: true });
    };
    focusInitial();

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialog.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [initialFocusRef, enabled]);

  return dialogRef;
}

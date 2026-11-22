import { useEffect } from 'react';

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
export function useBodyScrollLock(): void {
  useEffect(() => {
    locks++;
    document.body.classList.add('modal-open');
    return () => {
      locks = Math.max(0, locks - 1);
      if (locks === 0) document.body.classList.remove('modal-open');
    };
  }, []);
}

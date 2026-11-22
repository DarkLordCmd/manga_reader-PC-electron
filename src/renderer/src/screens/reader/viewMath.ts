/** Reader page-navigation math, extracted pure so it can be unit-tested. */

export interface PageInterval {
  top: number;
  bottom: number;
}

/**
 * Index of the page that occupies the LARGEST part of the viewport, i.e. the
 * page the reader is actually looking at. Ties go to the page whose centre is
 * closest to the viewport centre.
 *
 * The old rule ("the first page that is still intersecting, else the largest
 * share of the page's OWN height") kept reporting the previous page while a
 * thin strip of it remained visible: at the end of a gallery the last page
 * filled the screen, the counter still said 55/56 and the thumbnail panel
 * highlighted the penultimate page. Area beats ratio because pages have
 * different heights — a short page covering half the screen has a bigger ratio
 * than a tall page covering most of it.
 *
 * `pages` are viewport-relative rects (`getBoundingClientRect()`); returns -1
 * when nothing intersects the viewport.
 */
export function dominantVisiblePage(pages: PageInterval[], viewTop: number, viewBottom: number): number {
  const mid = (viewTop + viewBottom) / 2;
  let best = -1;
  let bestArea = 0;
  let bestDist = Infinity;
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (!p) continue;
    const area = Math.min(p.bottom, viewBottom) - Math.max(p.top, viewTop);
    if (!(area > 0)) continue;
    const dist = Math.abs((p.top + p.bottom) / 2 - mid);
    const better = best === -1 || area > bestArea + 0.5 || (Math.abs(area - bestArea) <= 0.5 && dist < bestDist);
    if (better) {
      best = i;
      bestArea = area;
      bestDist = dist;
    }
  }
  return best;
}

/** Reader zoom range. The floor must match what the Settings slider allows
 * (0.3): clamping at 0.5 made "−" jump a 30 % page UP to 50 %. */
export const WIDTH_SCALE_MIN = 0.3;
export const WIDTH_SCALE_MAX = 1.5;
export const WIDTH_SCALE_DEFAULT = 0.85;

/** Quick-zoom clamp for the Scroll-mode image width. */
export function clampWidthScale(value: number): number {
  if (!Number.isFinite(value)) return WIDTH_SCALE_DEFAULT;
  return Math.min(WIDTH_SCALE_MAX, Math.max(WIDTH_SCALE_MIN, Math.round(value * 100) / 100));
}

/** First index of the visible spread in Book mode. The cover (index 0) is
 * shown ALONE, then fully aligned pairs start from index 1 — the documented
 * JHenTai-style pairing. The previous formula only aligned when `first > 0`, so
 * index 0 produced the pair (1,2): every spread was shifted by one and a real
 * two-page artwork was always split across two screens. */
export function spreadStart(currentIndex: number, pageCount: number, pagesPerScreen: number): number {
  const last = Math.max(0, pageCount - 1);
  const first = Math.min(Math.max(0, currentIndex), last);
  if (pagesPerScreen <= 1 || first === 0) return first;
  return Math.min(1 + Math.floor((first - 1) / pagesPerScreen) * pagesPerScreen, last);
}

/** Indices rendered on the current Book-mode spread. The cover is alone. */
export function spreadIndices(start: number, pageCount: number, pagesPerScreen: number): number[] {
  if (pageCount <= 0) return [];
  if (start === 0) return [0];
  return Array.from({ length: Math.min(pagesPerScreen, pageCount - start) }, (_, k) => start + k);
}

/** Whether the user has reached the final screen of the gallery.
 * Scroll: the last page itself is the current one.
 * Book: the visible spread covers the last page (works for odd and even
 * page counts — `currentIndex` is the first page of the spread, so a naive
 * `currentIndex + 1 >= pageCount` misses even counts entirely). */
export function isReaderAtEnd(currentIndex: number, pageCount: number, pagesPerScreen: number, mode: 'Scroll' | 'Book'): boolean {
  if (!Number.isInteger(currentIndex) || pageCount <= 0) return false;
  if (mode === 'Book') {
    // Compare against the pages ACTUALLY on the spread: the cover is rendered
    // alone, so `start + pagesPerScreen >= pageCount` claimed "end" on page 1 of
    // a 2-page chapter (and marked it read before the second page was shown).
    const start = spreadStart(currentIndex, pageCount, pagesPerScreen);
    const indices = spreadIndices(start, pageCount, pagesPerScreen);
    return indices.length > 0 && indices[indices.length - 1] === pageCount - 1;
  }
  return currentIndex === pageCount - 1;
}

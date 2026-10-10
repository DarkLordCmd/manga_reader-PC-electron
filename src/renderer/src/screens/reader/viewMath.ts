/** Reader page-navigation math, extracted pure so it can be unit-tested. */

/** First index of the visible spread in Book mode. Page 1 is shown alone
 * (first > 0 alignment keeps two-page spreads from merging unrelated pages). */
export function spreadStart(currentIndex: number, pageCount: number, pagesPerScreen: number): number {
  const last = Math.max(0, pageCount - 1);
  const first = Math.min(Math.max(0, currentIndex), last);
  if (pagesPerScreen > 1 && first > 0) {
    return Math.min(first - (first % pagesPerScreen), last);
  }
  return first;
}

/** Indices rendered on the current Book-mode spread. */
export function spreadIndices(start: number, pageCount: number, pagesPerScreen: number): number[] {
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
    const start = spreadStart(currentIndex, pageCount, pagesPerScreen);
    return start + pagesPerScreen >= pageCount;
  }
  return currentIndex === pageCount - 1;
}

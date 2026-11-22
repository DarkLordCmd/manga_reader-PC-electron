/** Bounded caches for the catalog session.
 *
 * `sigPagesRef` memoizes fetched pages per query signature (source|query|
 * filters|sort) so toggling a filter back is instant. Deep scrolling used to
 * append pages forever: 8 signatures × hundreds of pages × 25 cards kept the
 * whole session in memory. `pageCursorRef` had the same problem (one entry per
 * signature|page for the app's lifetime).
 */
export const MAX_PAGES_PER_SIG = 24;
export const MAX_CURSOR_ENTRIES = 256;

/** Keep at most `max` pages per signature, dropping the lowest page numbers
 * first (page 0 is the initial view and is worth keeping). */
export function trimPageCache<V>(m: Map<number, V>, max = MAX_PAGES_PER_SIG): void {
  while (m.size > max) {
    let victim: number | undefined;
    for (const k of m.keys()) {
      if (k !== 0) {
        victim = k;
        break;
      }
    }
    if (victim === undefined) victim = m.keys().next().value;
    if (victim === undefined) break;
    m.delete(victim);
  }
}

/** FIFO cap for the per-page cursor map. */
export function trimCursorCache<K, V>(m: Map<K, V>, max = MAX_CURSOR_ENTRIES): void {
  while (m.size > max) {
    const oldest = m.keys().next().value;
    if (oldest === undefined) break;
    m.delete(oldest);
  }
}

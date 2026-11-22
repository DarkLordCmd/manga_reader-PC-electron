/** Infinite-scroll guard for the catalog.
 *
 * The Catalog screen stays mounted while another screen is shown (its wrapper
 * is display:none so in-flight searches survive tab switches). A display:none
 * element reports clientHeight === 0 and scrollHeight === 0, so the old
 * "scrollTop + clientHeight >= scrollHeight - threshold" test was ALWAYS true
 * for the hidden screen — the 2.5 s interval then fetched page after page from
 * E-Hentai in the background, burning the rate-limit budget and slowing covers.
 */
export interface ScrollBox {
  clientHeight: number;
  scrollTop: number;
  scrollHeight: number;
  /** null for display:none (and position:fixed) elements. */
  offsetParent: unknown;
}

export function shouldAutoLoad(el: ScrollBox | null, threshold = 700): boolean {
  if (!el || el.clientHeight === 0 || el.offsetParent === null) return false;
  return el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;
}

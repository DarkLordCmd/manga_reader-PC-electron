/** Thumbnail-panel virtualization window math. Thumbs have (unknown) variable
 * heights, so rows use an approximate height; the current button is always
 * inside the window, letting scrollIntoView recenter exactly on it. */

export interface ThumbWindow {
  from: number;
  to: number;
  size: number;
  topPad: number;
  bottomPad: number;
}

export function thumbWindow(currentIndex: number, pageCount: number, windowHalf: number, rowHeight: number): ThumbWindow {
  if (pageCount <= 0) return { from: 0, to: -1, size: 0, topPad: 0, bottomPad: 0 };
  const size = Math.min(pageCount, windowHalf * 2 + 1);
  let from = Math.max(0, currentIndex - windowHalf);
  from = Math.max(0, Math.min(from, pageCount - size));
  const to = from + size - 1;
  return {
    from,
    to,
    size,
    topPad: from * rowHeight,
    bottomPad: Math.max(0, (pageCount - 1 - to) * rowHeight),
  };
}

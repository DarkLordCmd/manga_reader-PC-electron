import { describe, it, expect } from 'vitest';
import {
  spreadStart,
  spreadIndices,
  isReaderAtEnd,
  clampWidthScale,
  WIDTH_SCALE_DEFAULT,
  dominantVisiblePage,
} from '../src/renderer/src/screens/reader/viewMath';

describe('dominantVisiblePage', () => {
  const viewport = { top: 0, bottom: 700 };

  it('picks the page that fills the screen, not the sliver above it', () => {
    // The reported bug: the last page filled the viewport, but a thin strip of
    // the penultimate page remained visible at the top and was reported as the
    // current page (counter 55/56, penultimate thumb highlighted).
    const pages = [
      { top: -610, bottom: 110 }, // page 55, only its bottom strip is visible
      { top: 110, bottom: 700 }, // page 56, fills the rest
    ];
    expect(dominantVisiblePage(pages, viewport.top, viewport.bottom)).toBe(1);
  });

  it('ignores the page above even when it is much shorter (area beats ratio)', () => {
    // A short page can have a larger share of its OWN height visible than a
    // tall page (ratio 0.91 vs 0.75 here) while occupying far less of the
    // screen — the old ratio rule picked the short one.
    const pages = [
      { top: -10, bottom: 100 }, // 100 of its 110 px visible, area 100
      { top: 100, bottom: 900 }, // 600 of its 800 px visible, area 600
    ];
    expect(dominantVisiblePage(pages, 0, 700)).toBe(1);
  });

  it('keeps a tall webtoon page that spans the whole viewport', () => {
    expect(dominantVisiblePage([{ top: -2000, bottom: 5000 }], 0, 700)).toBe(0);
  });

  it('splits an exact area tie by centre distance (and prefers the earlier page)', () => {
    // Two pages split the viewport evenly; their centres are symmetric, so the
    // earlier page wins.
    expect(
      dominantVisiblePage(
        [
          { top: 0, bottom: 350 },
          { top: 350, bottom: 700 },
        ],
        0,
        700,
      ),
    ).toBe(0);
  });

  it('returns -1 when nothing is visible', () => {
    expect(dominantVisiblePage([], 0, 700)).toBe(-1);
    expect(dominantVisiblePage([{ top: 800, bottom: 900 }], 0, 700)).toBe(-1);
  });
});

describe('spreadStart', () => {
  it('shows the cover alone, then aligned pairs', () => {
    expect(spreadStart(0, 5, 2)).toBe(0); // cover alone
    expect(spreadStart(1, 5, 2)).toBe(1); // pages 2-3
    expect(spreadStart(2, 5, 2)).toBe(1); // second page of that spread
    expect(spreadStart(3, 5, 2)).toBe(3); // pages 4-5
    expect(spreadStart(4, 5, 2)).toBe(3);
  });

  it('clamps out-of-range indices into the last valid spread', () => {
    expect(spreadStart(99, 4, 2)).toBe(3); // 4 pages: [0], [1,2], [3]
    expect(spreadStart(-3, 4, 2)).toBe(0);
  });

  it('single-page galleries stay on page 0', () => {
    expect(spreadStart(0, 1, 2)).toBe(0);
  });

  it('always honours pageCount=0 as start 0', () => {
    expect(spreadStart(0, 0, 2)).toBe(0);
  });
});

describe('spreadIndices', () => {
  it('renders the cover alone and up to pagesPerScreen pages elsewhere', () => {
    expect(spreadIndices(0, 5, 2)).toEqual([0]); // cover alone
    expect(spreadIndices(1, 5, 2)).toEqual([1, 2]);
    expect(spreadIndices(3, 5, 2)).toEqual([3, 4]);
    expect(spreadIndices(4, 5, 2)).toEqual([4]); // odd tail
  });
});

describe('isReaderAtEnd', () => {
  it('Scroll: end is the very last page only', () => {
    expect(isReaderAtEnd(4, 5, 2, 'Scroll')).toBe(true);
    expect(isReaderAtEnd(3, 5, 2, 'Scroll')).toBe(false);
  });

  it('Book: end when the last spread covers the final page', () => {
    // 4 pages, cover alone: [0], [1,2], [3] → the lone last page is the end.
    expect(isReaderAtEnd(3, 4, 2, 'Book')).toBe(true);
    expect(isReaderAtEnd(2, 4, 2, 'Book')).toBe(false);
    expect(isReaderAtEnd(0, 4, 2, 'Book')).toBe(false);
  });

  it('Book: a 2-page chapter is not finished on the cover', () => {
    // Cover alone is page 1 of 2: the old `start + perScreen >= pageCount`
    // marked it read instantly.
    expect(isReaderAtEnd(0, 2, 2, 'Book')).toBe(false);
    expect(isReaderAtEnd(1, 2, 2, 'Book')).toBe(true);
  });

  it('Book: odd page count reaches the end on the trailing spread', () => {
    expect(isReaderAtEnd(4, 5, 2, 'Book')).toBe(true); // [3,4]
    expect(isReaderAtEnd(1, 5, 2, 'Book')).toBe(false); // [1,2]
  });

  it('returns false for empty galleries and non-integer indices', () => {
    expect(isReaderAtEnd(0, 0, 2, 'Book')).toBe(false);
    expect(isReaderAtEnd(Number.NaN, 5, 2, 'Scroll')).toBe(false);
  });
});

describe('clampWidthScale', () => {
  it('clamps into the reader zoom range and rounds to 0.01', () => {
    expect(clampWidthScale(0.9)).toBe(0.9);
    expect(clampWidthScale(0.94)).toBe(0.94);
    expect(clampWidthScale(2)).toBe(1.5);
    expect(clampWidthScale(0.1)).toBe(0.3);
    expect(clampWidthScale(Number.POSITIVE_INFINITY)).toBe(WIDTH_SCALE_DEFAULT);
  });

  it('keeps the 30% width the Settings slider can produce (zoom-out must not widen)', () => {
    // Regression: the floor was 0.5 while Settings allowed 0.3, so pressing
    // "−" on a 30% page jumped it UP to 50%.
    expect(clampWidthScale(0.3)).toBe(0.3);
    expect(clampWidthScale(0.35)).toBe(0.35);
    expect(clampWidthScale(0.3 - 0.05)).toBe(0.3);
  });
});

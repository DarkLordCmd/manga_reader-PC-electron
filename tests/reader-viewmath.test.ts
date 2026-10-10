import { describe, it, expect } from 'vitest';
import { spreadStart, spreadIndices, isReaderAtEnd } from '../src/renderer/src/screens/reader/viewMath';

describe('spreadStart', () => {
  it('shows page 1 alone, then aligns to spread boundaries', () => {
    expect(spreadStart(0, 5, 2)).toBe(0); // page 1 alone
    expect(spreadStart(1, 5, 2)).toBe(0); // 1 sits on the first (single) spread
    expect(spreadStart(2, 5, 2)).toBe(2);
    expect(spreadStart(3, 5, 2)).toBe(2);
    expect(spreadStart(4, 5, 2)).toBe(4); // last page alone (odd count)
  });

  it('clamps out-of-range indices into the last valid spread', () => {
    expect(spreadStart(99, 4, 2)).toBe(2);
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
  it('renders up to pagesPerScreen pages from the start', () => {
    expect(spreadIndices(2, 5, 2)).toEqual([2, 3]);
    expect(spreadIndices(4, 5, 2)).toEqual([4]); // odd tail
  });
});

describe('isReaderAtEnd', () => {
  it('Scroll: end is the very last page only', () => {
    expect(isReaderAtEnd(4, 5, 2, 'Scroll')).toBe(true);
    expect(isReaderAtEnd(3, 5, 2, 'Scroll')).toBe(false);
  });

  it('Book: even page count reaches the end on the last spread', () => {
    // 4 pages, 2 per screen → last spread [2,3], currentIndex starts it
    expect(isReaderAtEnd(2, 4, 2, 'Book')).toBe(true);
    expect(isReaderAtEnd(0, 4, 2, 'Book')).toBe(false);
  });

  it('Book: odd page count reaches the end only on the trailing single page', () => {
    expect(isReaderAtEnd(4, 5, 2, 'Book')).toBe(true); // spread [4]
    expect(isReaderAtEnd(2, 5, 2, 'Book')).toBe(false); // spread [2,3]
  });

  it('returns false for empty galleries and non-integer indices', () => {
    expect(isReaderAtEnd(0, 0, 2, 'Book')).toBe(false);
    expect(isReaderAtEnd(Number.NaN, 5, 2, 'Scroll')).toBe(false);
  });
});
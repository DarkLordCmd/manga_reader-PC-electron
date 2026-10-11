import { describe, it, expect } from 'vitest';
import { thumbWindow } from '../src/renderer/src/screens/reader/thumbWindow';

const ROW = 160;

describe('thumbWindow', () => {
  it('renders everything when the gallery fits the window', () => {
    const w = thumbWindow(3, 10, 10, ROW);
    expect(w.from).toBe(0);
    expect(w.to).toBe(9);
    expect(w.topPad).toBe(0);
    expect(w.bottomPad).toBe(0);
  });

  it('keeps the current index centered in large galleries', () => {
    const w = thumbWindow(500, 2000, 40, ROW);
    expect(w.from).toBe(460);
    expect(w.to).toBe(540);
    expect(w.size).toBe(81);
    expect(w.topPad).toBeCloseTo(460 * ROW);
    expect(w.bottomPad).toBeCloseTo((2000 - 1 - 540) * ROW);
  });

  it('clamps to the tail edge', () => {
    const w = thumbWindow(1999, 2000, 40, ROW);
    expect(w.to).toBe(1999);
    expect(w.from).toBe(1999 - 80);
    expect(w.bottomPad).toBe(0);
  });

  it('handles empty galleries', () => {
    const w = thumbWindow(0, 0, 10, ROW);
    expect(w.size).toBe(0);
    expect(w.to).toBe(-1);
  });

  it('treats a non-finite index as 0', () => {
    const w = thumbWindow(Number.NaN, 100, 40, ROW);
    expect(w.from).toBe(0);
    expect(w.to).toBe(80);
    const neg = thumbWindow(-5, 100, 10, ROW);
    expect(neg.from).toBe(0);
  });
});

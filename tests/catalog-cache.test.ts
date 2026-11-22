import { describe, it, expect } from 'vitest';
import { trimPageCache, trimCursorCache, MAX_PAGES_PER_SIG, MAX_CURSOR_ENTRIES } from '../src/renderer/src/screens/catalog/catalog-cache';

describe('catalog page cache bounds', () => {
  it('keeps page 0 and drops the lowest later pages first', () => {
    const m = new Map<number, string>();
    for (let i = 0; i < 30; i++) m.set(i, `p${i}`);
    trimPageCache(m);
    expect(m.size).toBe(MAX_PAGES_PER_SIG);
    expect(m.has(0)).toBe(true);
    expect(m.has(1)).toBe(false);
    expect(m.has(29)).toBe(true);
  });

  it('does nothing within the limit', () => {
    const m = new Map<number, string>([
      [0, 'a'],
      [1, 'b'],
    ]);
    trimPageCache(m, 5);
    expect(m.size).toBe(2);
  });

  it('caps the cursor map FIFO', () => {
    const m = new Map<string, number>();
    for (let i = 0; i < 300; i++) m.set(`sig|${i}`, i);
    trimCursorCache(m);
    expect(m.size).toBe(MAX_CURSOR_ENTRIES);
    expect(m.has('sig|0')).toBe(false);
    expect(m.has('sig|299')).toBe(true);
  });
});

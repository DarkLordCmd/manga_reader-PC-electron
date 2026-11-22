import { describe, it, expect } from 'vitest';
import { shouldAutoLoad, type ScrollBox } from '../src/renderer/src/screens/catalog/auto-load';

const box = (over: Partial<ScrollBox> = {}): ScrollBox => ({
  clientHeight: 700,
  scrollTop: 0,
  scrollHeight: 2000,
  offsetParent: {},
  ...over,
});

describe('shouldAutoLoad (catalog infinite scroll)', () => {
  it('never auto-loads a hidden (display:none) catalog', () => {
    // display:none → clientHeight 0 and offsetParent null. The old check saw
    // 0 >= -700 and fetched a page every 2.5 s in the background.
    expect(shouldAutoLoad(box({ clientHeight: 0, scrollHeight: 0, offsetParent: null }))).toBe(false);
    expect(shouldAutoLoad(box({ offsetParent: null }))).toBe(false);
    expect(shouldAutoLoad(null)).toBe(false);
  });

  it('loads near the bottom of the visible screen', () => {
    expect(shouldAutoLoad(box({ scrollTop: 1300 }))).toBe(true); // 1300+700 >= 2000-700
    expect(shouldAutoLoad(box({ scrollTop: 601 }))).toBe(true);
  });

  it('does not load in the middle of a long list', () => {
    expect(shouldAutoLoad(box({ scrollTop: 0 }))).toBe(false);
    expect(shouldAutoLoad(box({ scrollTop: 500 }))).toBe(false);
  });

  it('honours a custom threshold', () => {
    expect(shouldAutoLoad(box({ scrollTop: 0 }), 1300)).toBe(true);
    expect(shouldAutoLoad(box({ scrollTop: 0 }), 1299)).toBe(false);
  });
});

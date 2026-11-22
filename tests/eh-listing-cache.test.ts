import { describe, it, expect } from 'vitest';
import { ehListingCacheDecision } from '../src/main/services/sources/eh';

const MIN = 60_000;
const HOUR = 60 * MIN;

describe('ehListingCacheDecision (stale-while-revalidate)', () => {
  it('fetches when there is no cache or caching is disabled', () => {
    expect(ehListingCacheDecision(null, 5 * MIN)).toBe('fetch');
    expect(ehListingCacheDecision(0, 0)).toBe('fetch');
    expect(ehListingCacheDecision(1000, -1)).toBe('fetch');
  });

  it('serves fresh entries without a request', () => {
    expect(ehListingCacheDecision(0, 5 * MIN)).toBe('fresh');
    expect(ehListingCacheDecision(5 * MIN - 1, 5 * MIN)).toBe('fresh');
  });

  it('serves stale entries immediately and revalidates in the background', () => {
    expect(ehListingCacheDecision(5 * MIN, 5 * MIN)).toBe('revalidate');
    expect(ehListingCacheDecision(2 * HOUR, 5 * MIN)).toBe('revalidate');
    expect(ehListingCacheDecision(24 * HOUR - 1, 5 * MIN)).toBe('revalidate');
  });

  it('waits for the network when the cached listing is too old', () => {
    expect(ehListingCacheDecision(24 * HOUR, 5 * MIN)).toBe('fetch');
    expect(ehListingCacheDecision(7 * 24 * HOUR, 5 * MIN)).toBe('fetch');
  });
});

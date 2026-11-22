import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  torFallbackActiveFor,
  markTorFallbackSuccess,
  markTorFallbackFailure,
  isTorFallbackBlocked,
  resetTorFallback,
  isEhTimeoutError,
} from '../src/main/services/eh-sni-fallback';

describe('eh-sni-fallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    resetTorFallback();
  });

  it('inactive by default', () => {
    expect(torFallbackActiveFor('e-hentai.org')).toBe(false);
    expect(isTorFallbackBlocked('e-hentai.org')).toBe(false);
  });

  it('markTorFallbackSuccess sticks for the session (no re-probing direct)', () => {
    markTorFallbackSuccess('e-hentai.org');
    expect(torFallbackActiveFor('e-hentai.org')).toBe(true);
    expect(torFallbackActiveFor('E-Hentai.org')).toBe(true); // case-insensitive
    // Regression: a 10-minute TTL made the next request after expiry pay the
    // full direct timeout again, then fall back — a 30 s freeze every 10 min.
    vi.setSystemTime(10 * 60_000 + 1);
    expect(torFallbackActiveFor('e-hentai.org')).toBe(true);
    vi.setSystemTime(6 * 3600_000);
    expect(torFallbackActiveFor('e-hentai.org')).toBe(true);
  });

  it('markTorFallbackFailure blocks fallback route but not forever', () => {
    markTorFallbackFailure('e-hentai.org');
    expect(torFallbackActiveFor('e-hentai.org')).toBe(false);
    expect(isTorFallbackBlocked('e-hentai.org')).toBe(true);
    vi.setSystemTime(10 * 60_000 + 1);
    expect(isTorFallbackBlocked('e-hentai.org')).toBe(false);
  });

  it('hosts are isolated', () => {
    markTorFallbackSuccess('e-hentai.org');
    expect(torFallbackActiveFor('exhentai.org')).toBe(false);
  });

  it('isEhTimeoutError', () => {
    const e: any = new Error('timeout');
    e.ehSniTimeout = true;
    expect(isEhTimeoutError(e)).toBe(true);
    expect(isEhTimeoutError(new Error('x'))).toBe(false);
    expect(isEhTimeoutError(null)).toBe(false);
  });
});

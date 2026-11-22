import { describe, it, expect } from 'vitest';
import { buildPinnedDispatcher } from '../src/main/services/http';

describe('pinned dispatcher cache', () => {
  it('reuses the agent for the same host+IP', () => {
    // Regression: a fresh undici Agent (connection pool + keep-alive timers)
    // was built for every custom-DNS-pinned request and never closed.
    expect(buildPinnedDispatcher('example.com', '1.2.3.4')).toBe(buildPinnedDispatcher('example.com', '1.2.3.4'));
  });

  it('creates a separate agent when the resolved IP changes', () => {
    expect(buildPinnedDispatcher('example.com', '1.2.3.4')).not.toBe(buildPinnedDispatcher('example.com', '5.6.7.8'));
  });
});

import { describe, it, expect } from 'vitest';
import { parseCircuitEstablished } from '../src/main/services/tor-embedded';

describe('Tor control circuit health', () => {
  it('reports a usable circuit', () => {
    expect(parseCircuitEstablished('250-status/circuit-established=1\r\n250 OK\r\n')).toBe(true);
  });
  it('reports a daemon that cannot reach the network', () => {
    expect(parseCircuitEstablished('250-status/circuit-established=0\r\n250 OK\r\n')).toBe(false);
  });
  it('returns null for an unrelated/empty reply', () => {
    expect(parseCircuitEstablished('250 OK\r\n')).toBeNull();
    expect(parseCircuitEstablished('515 Authentication failed')).toBeNull();
  });
});

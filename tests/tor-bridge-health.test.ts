import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadBridgeHealth, markBridgeHealth, bridgeKey } from '../src/main/services/tor-bridge-health';

const BRIDGE = 'obfs4 187.127.149.46:34792 07D26D852BEBA997F3D6431B891073DA07E65D0D cert=abc iat-mode=0';

describe('tor bridge health', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bridge-health-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('keys by host:port', () => {
    expect(bridgeKey(BRIDGE)).toBe('187.127.149.46:34792');
    expect(bridgeKey('weird line without address')).toBe('weird line without address');
  });

  it('starts empty and records a failure', () => {
    expect(loadBridgeHealth(dir)).toEqual({});
    markBridgeHealth(dir, BRIDGE, false);
    const all = loadBridgeHealth(dir);
    expect(all['187.127.149.46:34792'].ok).toBe(false);
    expect(typeof all['187.127.149.46:34792'].at).toBe('number');
  });

  it('overwrites the previous result for the same bridge', () => {
    markBridgeHealth(dir, BRIDGE, false);
    markBridgeHealth(dir, BRIDGE, true);
    expect(loadBridgeHealth(dir)['187.127.149.46:34792'].ok).toBe(true);
  });

  it('ignores empty bridge lines', () => {
    markBridgeHealth(dir, '   ', false);
    expect(loadBridgeHealth(dir)).toEqual({});
  });

  it('survives a corrupt file', () => {
    markBridgeHealth(dir, BRIDGE, true);
    const p = join(dir, 'tor-bridge-health.json');
    expect(() => readFileSync(p, 'utf8')).not.toThrow();
    expect(loadBridgeHealth(dir)['187.127.149.46:34792'].ok).toBe(true);
  });
});

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * What actually happened to each bridge at the last real bootstrap attempt.
 *
 * `probeBridgeLine()` only opens a TCP connection, so a bridge whose obfs4
 * server rejects connections (`general SOCKS server failure`) still shows as
 * "reachable, 5 ms". This file records the truth learned by the daemon itself,
 * so the settings screen can say "did not bootstrap last time" next to it.
 */
export interface BridgeHealth {
  ok: boolean;
  at: number;
}

const FILE = 'tor-bridge-health.json';
const MAX_ENTRIES = 50;

function pathFor(userDataDir: string): string {
  return join(userDataDir, FILE);
}

export function bridgeKey(line: string): string {
  // host:port is enough to identify a bridge and keeps the file small.
  const m = line.match(/(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})/);
  return m ? `${m[1]}:${m[2]}` : line.slice(0, 80);
}

export function loadBridgeHealth(userDataDir: string): Record<string, BridgeHealth> {
  try {
    if (!existsSync(pathFor(userDataDir))) return {};
    const raw = JSON.parse(readFileSync(pathFor(userDataDir), 'utf-8')) as Record<string, BridgeHealth>;
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

export function markBridgeHealth(userDataDir: string, line: string, ok: boolean): void {
  if (!line.trim()) return;
  try {
    const all = loadBridgeHealth(userDataDir);
    all[bridgeKey(line)] = { ok, at: Date.now() };
    const entries = Object.entries(all)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX_ENTRIES);
    writeFileSync(pathFor(userDataDir), JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* best-effort */
  }
}

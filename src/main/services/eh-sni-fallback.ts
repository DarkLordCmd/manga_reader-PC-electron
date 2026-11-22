const TTL_MS = 10 * 60_000;
/** A host that already needed Tor once will almost certainly need it again in
 * this session. Retrying the direct path every 10 minutes cost a full 30 s
 * timeout on the first request after each expiry — the "site freezes for half
 * a minute every now and then" reports. The Tor mode therefore sticks for the
 * session (a VPN/network change is picked up by the next app start, or after
 * this generous window). */
const STICKY_TTL_MS = 12 * 3600_000;

type Mode = 'tor' | 'blocked';

interface Entry {
  mode: Mode;
  until: number;
}

const state = new Map<string, Entry>();

export function torFallbackActiveFor(host: string): boolean {
  const e = state.get(host.toLowerCase());
  if (!e) return false;
  if (Date.now() > e.until) {
    state.delete(host.toLowerCase());
    return false;
  }
  return e.mode === 'tor';
}

export function markTorFallbackSuccess(host: string): void {
  state.set(host.toLowerCase(), { mode: 'tor', until: Date.now() + STICKY_TTL_MS });
}

export function markTorFallbackFailure(host: string): void {
  state.set(host.toLowerCase(), { mode: 'blocked', until: Date.now() + TTL_MS });
}

export function isTorFallbackBlocked(host: string): boolean {
  const e = state.get(host.toLowerCase());
  if (!e) return false;
  if (Date.now() > e.until) {
    state.delete(host.toLowerCase());
    return false;
  }
  return e.mode === 'blocked';
}

export function resetTorFallback(): void {
  state.clear();
}

/** FetchWithTimeout tags our-own-timeout aborts with this flag. */
export function isEhTimeoutError(e: unknown): boolean {
  return !!(e as any)?.ehSniTimeout;
}

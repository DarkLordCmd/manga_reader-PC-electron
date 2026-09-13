const TTL_MS = 10 * 60_000

type Mode = 'tor' | 'blocked'

interface Entry {
  mode: Mode
  until: number
}

const state = new Map<string, Entry>()

export function torFallbackActiveFor(host: string): boolean {
  const e = state.get(host.toLowerCase())
  if (!e) return false
  if (Date.now() > e.until) {
    state.delete(host.toLowerCase())
    return false
  }
  return e.mode === 'tor'
}

export function markTorFallbackSuccess(host: string): void {
  state.set(host.toLowerCase(), { mode: 'tor', until: Date.now() + TTL_MS })
}

export function markTorFallbackFailure(host: string): void {
  state.set(host.toLowerCase(), { mode: 'blocked', until: Date.now() + TTL_MS })
}

export function isTorFallbackBlocked(host: string): boolean {
  const e = state.get(host.toLowerCase())
  if (!e) return false
  if (Date.now() > e.until) {
    state.delete(host.toLowerCase())
    return false
  }
  return e.mode === 'blocked'
}

export function resetTorFallback(): void {
  state.clear()
}

/** FetchWithTimeout tags our-own-timeout aborts with this flag. */
export function isEhTimeoutError(e: unknown): boolean {
  return !!(e as any)?.ehSniTimeout
}

export interface LimitParseResult {  kind: 'image-limit' | 'usage-limit' | 'sad-panda' | null
  resetAfterSec: number | null
}

export function parseLimitResponse(text: string): LimitParseResult {
  if (!text || text.trim().length === 0) return { kind: 'sad-panda', resetAfterSec: null }
  const t = text.slice(0, 2000)
  if (t.startsWith('You have exceeded your image')) return { kind: 'image-limit', resetAfterSec: null }
  const m = t.match(/exceeded your usage limit[^.]*\.?[^]*?reset in\s*(\d+)\s*second/i)
  if (t.toLowerCase().includes('exceeded your usage limit')) {
    return { kind: 'usage-limit', resetAfterSec: m ? Number(m[1]) : null }
  }
  return { kind: null, resetAfterSec: null }
}

import type { EhLimitState } from '@shared/ipc'
export type { EhLimitState }

export class EhLimitWatcher {
  private until = 0
  private kind = ''
  private cbs: ((blocked: boolean) => void)[] = []

  private emit(): void {
    const b = this.isBlocked()
    for (const cb of this.cbs) cb(b)
  }

  state(): EhLimitState {
    return { blocked: Date.now() < this.until, until: this.until, kind: this.kind }
  }

  isBlocked(): boolean {
    return this.state().blocked
  }

  block(kind: string, durationMs: number): void {
    this.kind = kind
    this.until = Math.max(this.until, Date.now() + durationMs)
    this.emit()
  }

  clear(): void {
    this.until = 0
    this.kind = ''
    this.emit()
  }

  remainingSec(): number {
    return Math.max(0, Math.ceil((this.until - Date.now()) / 1000))
  }

  onChange(cb: (blocked: boolean) => void): void {
    this.cbs.push(cb)
  }
}

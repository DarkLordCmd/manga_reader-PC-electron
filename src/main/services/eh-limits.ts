export interface LimitParseResult {
  /**
   * `empty` is not a limit: ExHentai without a valid session answers
   * `302 → forums.e-hentai.org/remoteapi.php → exhentai.org/?poni=no → …` and
   * Chromium hands back `200` with a zero-length body. That is an auth/Tor
   * problem and must never park the source.
   */
  kind: 'image-limit' | 'usage-limit' | 'empty' | null;
  resetAfterSec: number | null;
}

export function parseLimitResponse(text: string): LimitParseResult {
  if (!text || text.trim().length === 0) return { kind: 'empty', resetAfterSec: null };
  const t = text.slice(0, 2000);
  if (t.startsWith('You have exceeded your image')) return { kind: 'image-limit', resetAfterSec: null };
  const m = t.match(/exceeded your usage limit[^.]*\.?[^]*?reset in\s*(\d+)\s*second/i);
  if (t.toLowerCase().includes('exceeded your usage limit')) {
    return { kind: 'usage-limit', resetAfterSec: m ? Number(m[1]) : null };
  }
  return { kind: null, resetAfterSec: null };
}

import type { EhLimitState } from '@shared/ipc';
export type { EhLimitState };

/**
 * Limit state for the EH sources. E-Hentai and ExHentai share one client but
 * not one quota: a block recorded for `exhentai` must leave `ehentai` working
 * (and vice versa), so every block carries the group it applies to.
 *
 * Deadlines are kept PER GROUP. A single shared deadline let a new 2-minute
 * e-hentai usage limit inherit a 1-hour exhentai image limit (blocking the
 * wrong site for an hour) while the group swap also unblocked the exhentai
 * window that was still running.
 */
export class EhLimitWatcher {
  private blocks = new Map<string, { kind: string; until: number }>();
  private currentGroup: string | null = null;
  private cbs: ((blocked: boolean) => void)[] = [];

  private prune(now = Date.now()): void {
    for (const [key, b] of this.blocks) {
      if (now >= b.until) this.blocks.delete(key);
    }
  }

  private emit(): void {
    const b = this.isBlocked();
    for (const cb of this.cbs) cb(b);
  }

  state(): EhLimitState {
    this.prune();
    let best: { kind: string; until: number } | null = null;
    for (const b of this.blocks.values()) if (!best || b.until > best.until) best = b;
    return { blocked: best !== null, until: best?.until ?? 0, kind: best?.kind ?? '' };
  }

  isBlocked(): boolean {
    this.prune();
    return this.blocks.size > 0;
  }

  /** `group` null = the block covers every EH host. */
  groupOf(): string | null {
    return this.currentGroup;
  }

  /** True when this host group is inside an active block. */
  isBlockedFor(group: string | null): boolean {
    this.prune();
    if (this.blocks.size === 0) return false;
    if (this.blocks.has('*')) return true;
    if (!group) return true;
    return this.blocks.has(group);
  }

  block(kind: string, durationMs: number, group: string | null = null): void {
    const key = group ?? '*';
    const until = Date.now() + durationMs;
    this.currentGroup = group;
    // Extend an existing window for the SAME group only.
    this.blocks.set(key, { kind, until: Math.max(until, this.blocks.get(key)?.until ?? 0) });
    this.emit();
  }

  clear(): void {
    this.blocks.clear();
    this.currentGroup = null;
    this.emit();
  }

  remainingSec(): number {
    return Math.max(0, Math.ceil((this.state().until - Date.now()) / 1000));
  }

  onChange(cb: (blocked: boolean) => void): void {
    this.cbs.push(cb);
  }
}

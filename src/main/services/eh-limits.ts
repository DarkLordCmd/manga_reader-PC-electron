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
 */
export class EhLimitWatcher {
  private until = 0;
  private kind = '';
  private group: string | null = null;
  private cbs: ((blocked: boolean) => void)[] = [];

  private emit(): void {
    const b = this.isBlocked();
    for (const cb of this.cbs) cb(b);
  }

  state(): EhLimitState {
    return { blocked: Date.now() < this.until, until: this.until, kind: this.kind };
  }

  isBlocked(): boolean {
    return this.state().blocked;
  }

  /** `group` null = the block covers every EH host. */
  groupOf(): string | null {
    return this.group;
  }

  /** True when this host group is inside an active block. */
  isBlockedFor(group: string | null): boolean {
    if (!this.isBlocked()) return false;
    if (!this.group || !group) return true;
    return this.group === group;
  }

  block(kind: string, durationMs: number, group: string | null = null): void {
    this.kind = kind;
    this.group = group;
    this.until = Math.max(this.until, Date.now() + durationMs);
    this.emit();
  }

  clear(): void {
    this.until = 0;
    this.kind = '';
    this.group = null;
    this.emit();
  }

  remainingSec(): number {
    return Math.max(0, Math.ceil((this.until - Date.now()) / 1000));
  }

  onChange(cb: (blocked: boolean) => void): void {
    this.cbs.push(cb);
  }
}

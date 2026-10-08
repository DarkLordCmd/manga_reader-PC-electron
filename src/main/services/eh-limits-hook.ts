import type { EhLimitWatcher } from './eh-limits';
import { isEhHost } from './eh-session';

export function ehBlockedError(kind: string, remainingSec: number): Error {
  const label =
    kind === 'image-limit'
      ? 'Превышен лимит изображений E-Hentai'
      : kind === 'usage-limit'
        ? 'Превышен лимит использования E-Hentai'
        : 'Превышен лимит E-Hentai (sad panda)';
  const e = new Error(`${label}. Сброс через ${remainingSec} c. Включи domain fronting/Tor или смени аккаунт.`);
  (e as any).ehBlocked = true;
  return e;
}

interface HookOpts {
  watcher: EhLimitWatcher;
  switchAccount?: () => boolean;
}

let opts: HookOpts | null = null;

export function registerEhLimitHook(o: HookOpts): void {
  opts = o;
}

export function handleLimitFailure(kind: string, resetAfterSec: number | null): Error {
  const w = opts?.watcher;
  if (!w) return new Error('Лимит E-Hentai');
  const fallbackSec = resetAfterSec ?? 3600;
  // one account-switch attempt before hard blocking
  if (opts?.switchAccount?.()) {
    const e = ehBlockedError(kind, 0);
    (e as any).ehSwitched = true;
    return e;
  }
  w.block(kind, fallbackSec * 1000);
  return ehBlockedError(kind, w.remainingSec());
}

export async function retryOnce<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e: any) {
    if (!e?.ehBlocked || e?.ehBlockedHard) throw e;
    // the failed attempt already switched accounts — retry without switching again
    if (e?.ehSwitched) return await fn();
    if (!opts?.switchAccount?.()) throw e;
    return await fn();
  }
}

export function isEhLimitError(e: unknown): boolean {
  return !!(e as any)?.ehBlocked;
}

function isEhUrl(url: string): boolean {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return isEhHost(host) || host.includes('exhentai') || host.includes('e-hentai.org');
}

/** Throws immediately when an EH-host request is attempted while blocked. */
export function assertNotEhBlocked(url: string): void {
  const w = opts?.watcher;
  if (!w || !w.isBlocked() || !isEhUrl(url)) return;
  const st = w.state();
  const e = ehBlockedError(st.kind || 'usage-limit', w.remainingSec());
  (e as any).ehBlockedHard = true;
  throw e;
}

/** User-facing russian message while the watcher is blocked, else null. */
export function ehBlockedMessage(): string | null {
  const w = opts?.watcher;
  if (!w || !w.isBlocked()) return null;
  const st = w.state();
  return ehBlockedError(st.kind || 'usage-limit', w.remainingSec()).message;
}

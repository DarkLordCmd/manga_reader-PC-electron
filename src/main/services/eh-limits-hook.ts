import type { EhLimitWatcher } from './eh-limits';
import { isEhHost } from './eh-session';

export function ehBlockedError(kind: string, remainingSec: number): Error {
  const label =
    kind === 'image-limit'
      ? 'Превышен лимит изображений E-Hentai'
      : kind === 'usage-limit'
        ? 'Превышен лимит использования E-Hentai'
        : 'Превышен лимит E-Hentai';
  const e = new Error(`${label}. Сброс через ${remainingSec} c. Включи domain fronting/Tor или смени аккаунт.`);
  (e as any).ehBlocked = true;
  return e;
}

/**
 * ExHentai without a valid session redirects through
 * `forums.e-hentai.org/remoteapi.php` to `?poni=no` until Chromium gives up and
 * returns an empty 200. Same signature for a dead Tor circuit. Neither is a
 * quota, so this error never blocks the source and never rotates the account.
 */
export function ehEmptyResponseError(url?: string): Error {
  let host = '';
  try {
    host = url ? new URL(url).hostname : '';
  } catch {
    /* keep empty */
  }
  const where = host ? ` (${host})` : '';
  const e = new Error(
    `E-Hentai вернул пустую страницу${where}. Для ExHentai это обычно незалогиненная сессия ` +
      '(сброшенные cookie ipb_member_id / ipb_pass_hash / igneous или выход через Tor). ' +
      'Источник не заблокирован — обнови аккаунт или отключи Tor для источника.',
  );
  (e as any).ehEmpty = true;
  return e;
}

/**
 * Longest wait when E-Hentai does not say when the quota resets. An image
 * quota really does take a long time to recover; a usage-rate limit recovers
 * in seconds, so assuming an hour turned a hiccup into a dead source.
 */
function fallbackBlockSec(kind: string): number {
  if (kind === 'image-limit') return 3600;
  if (kind === 'usage-limit') return 120;
  return 600;
}

/** `exhentai` and `ehentai` are separate quotas behind one client. */
export function ehHostGroup(url: string): string | null {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const isEh = isEhHost(host) || host.includes('exhentai') || host.includes('e-hentai.org');
  if (!isEh) return null;
  return host.includes('exhentai') ? 'exhentai' : 'ehentai';
}

interface HookOpts {
  watcher: EhLimitWatcher;
  switchAccount?: () => boolean;
}

let opts: HookOpts | null = null;

export function registerEhLimitHook(o: HookOpts): void {
  opts = o;
}

export function handleLimitFailure(kind: string, resetAfterSec: number | null, url?: string): Error {
  const w = opts?.watcher;
  if (!w) return new Error('Лимит E-Hentai');
  // An empty body is an auth/transport symptom, not a quota: do not park the
  // source and do not rotate the account for it.
  if (kind === 'empty') return ehEmptyResponseError(url);

  const group = url ? ehHostGroup(url) : null;
  const fallbackSec = resetAfterSec ?? fallbackBlockSec(kind);
  // one account-switch attempt before hard blocking
  if (opts?.switchAccount?.()) {
    const e = ehBlockedError(kind, 0);
    (e as any).ehSwitched = true;
    return e;
  }
  w.block(kind, fallbackSec * 1000, group);
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

/** Throws immediately when this specific EH host group is inside a block. */
export function assertNotEhBlocked(url: string): void {
  const w = opts?.watcher;
  if (!w || !w.isBlocked()) return;
  const group = ehHostGroup(url);
  if (!group || !w.isBlockedFor(group)) return;
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

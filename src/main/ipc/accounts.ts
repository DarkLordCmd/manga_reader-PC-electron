import { dialog } from 'electron';
import { readFileSync } from 'fs';
import { z } from 'zod';
import { CH } from '@shared/ipc';
import type { CookieLoginInput } from '@shared/ipc';
import type { Settings } from '@shared/settings';
import { handleSafe, anyString, looseObject, nonNegInt } from './validate';
import type { SettingsService } from '../services/settings';
import { ExAccountsService, parseCookieLogin } from '../services/accounts';
import { mergeCookieHeaders } from '../services/accounts-parse';
import { whenEmbeddedTorReady } from '../services/tor-embedded';
import { verifyEhLogin } from '../services/eh-extras';

export interface AccountsDeps {
  settings: SettingsService;
  exAccounts: ExAccountsService;
  effectiveTorSocks(): string;
  runLoginWindow(url: string, torSocksAddr: string): Promise<{ cookies: string } | null>;
  broadcastSettingsChanged(s: Settings): void;
}

export function registerAccounts(deps: AccountsDeps): void {
  const { settings, exAccounts, effectiveTorSocks, runLoginWindow, broadcastSettingsChanged } = deps;

  handleSafe(CH.loginSite, z.tuple([anyString]), async (_e, url: string) => {
    const s = settings.get();
    // Tor only for the sites that actually need it (.onion, E-Hentai family,
    // nhentai) — routing other logins through a Tor exit gets them banned
    // (senkuro.me bans datacenter/Tor ranges).
    const lower = url.toLowerCase();
    const needsTor = url.includes('.onion') || lower.includes('exhentai') || lower.includes('e-hentai') || lower.includes('nhentai');
    // Opening the window before the bundled daemon has bootstrapped makes the
    // first .onion navigation hang for the whole proxy timeout.
    if (needsTor && s.builtin_tor) {
      try {
        await whenEmbeddedTorReady(120_000);
      } catch {
        /* window will surface the network error */
      }
    }
    const result = await runLoginWindow(url, needsTor ? effectiveTorSocks() : '');
    if (!result) return null;
    // A closed/cancelled EH window leaves guest cookies (an `onikakushi` stub);
    // saving them made every later request return an empty page. Verify the
    // session against the site before persisting anything.
    if (/exhentai|e-hentai/i.test(url)) {
      const v = await verifyEhLogin(url, result.cookies, needsTor ? effectiveTorSocks() : '');
      if (!v.ok) {
        throw new Error(
          `Вход в ExHentai не выполнен: ${v.reason}. Открой окно входа снова, введи логин/пароль и код с картинки (капча на onion обязательна).`,
        );
      }
    }
    // Persist cookies into settings depending on target. Merge with what is
    // already stored: a canceled/partial login must not replace a valid
    // session with guest cookies.
    const next = { ...settings.get() };
    const merge = (prev: string): string => mergeCookieHeaders(prev, result.cookies);
    if (url.includes('nhentai')) {
      if (url.includes('.onion')) next.nhentai_onion_cookies_raw = merge(next.nhentai_onion_cookies_raw);
      else next.nhentai_cookies_raw = merge(next.nhentai_cookies_raw);
    } else if (url.includes('.onion')) {
      next.onion_cookies_raw = merge(next.onion_cookies_raw);
    } else if (url.includes('senkuro')) {
      next.senkuro_cookies_raw = merge(next.senkuro_cookies_raw);
    }
    settings.save(next);
    // Refresh the renderer's snapshot: otherwise any later settings save
    // (reader toggles, tag bookmarks, quick searches) would echo the stale
    // pre-login cookie string back and overwrite the fresh session.
    broadcastSettingsChanged(settings.get());
    return result.cookies;
  });
  handleSafe(CH.loginPassword, z.tuple([anyString, anyString]), async (_e, user: string, pass: string) => {
    const r = await exAccounts.passwordLogin(user, pass);
    if (r.ok) {
      const s = settings.get();
      // Keep the account pool in sync with the cookie header used for clearnet ExHentai.
      broadcastSettingsChanged(s);
    }
    return r;
  });
  handleSafe(CH.cookieLogin, z.tuple([looseObject<CookieLoginInput>()]), async (_e, input: CookieLoginInput) => {
    return await exAccounts.cookieLogin(input);
  });
  handleSafe(CH.refreshIgneous, z.tuple([]), async () => await exAccounts.refreshIgneous());
  handleSafe(CH.parseCookieText, z.tuple([anyString]), (_e, text: string) => parseCookieLogin(text ?? ''));
  handleSafe(CH.getExAccounts, z.tuple([]), () => ({ accounts: exAccounts.accounts, currentId: exAccounts.currentId }));
  handleSafe(CH.setExAccount, z.tuple([nonNegInt]), (_e, id: number) => {
    exAccounts.setCurrent(id);
    return { accounts: exAccounts.accounts, currentId: exAccounts.currentId };
  });
  handleSafe(
    CH.addExAccount,
    z.tuple([anyString, anyString, anyString, anyString]),
    (_e, name: string, memberId: string, passHash: string, igneous: string) => {
      exAccounts.addManual(name, memberId, passHash, igneous);
      return { accounts: exAccounts.accounts, currentId: exAccounts.currentId };
    },
  );
  handleSafe(CH.removeExAccount, z.tuple([nonNegInt]), (_e, id: number) => {
    exAccounts.remove(id);
    return { accounts: exAccounts.accounts, currentId: exAccounts.currentId };
  });
  handleSafe(CH.importExAccounts, z.tuple([]), async () => {
    const r = await dialog.showOpenDialog({
      title: 'Выбери JSON, который сохранил юзерскрипт AutoLogin',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (r.canceled || r.filePaths.length === 0) return null;
    let content: string;
    try {
      content = readFileSync(r.filePaths[0], 'utf-8');
    } catch (e: any) {
      return { count: 0, accounts: { accounts: exAccounts.accounts, currentId: exAccounts.currentId } };
    }
    const count = exAccounts.importFromContent(content);
    return { count, accounts: { accounts: exAccounts.accounts, currentId: exAccounts.currentId } };
  });
}

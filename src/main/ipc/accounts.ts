import { dialog, ipcMain } from 'electron';
import { readFileSync } from 'fs';
import { z } from 'zod';
import { CH } from '@shared/ipc';
import type { CookieLoginInput } from '@shared/ipc';
import type { Settings } from '@shared/settings';
import { handleSafe, anyString, looseObject, nonNegInt } from './validate';
import type { SettingsService } from '../services/settings';
import { ExAccountsService, parseCookieLogin } from '../services/accounts';

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
    const result = await runLoginWindow(url, needsTor ? effectiveTorSocks() : '');
    if (!result) return null;
    // Persist cookies into settings depending on target
    const next = { ...settings.get() };
    if (url.includes('exhentai')) next.onion_cookies_raw = result.cookies;
    else if (url.includes('nhentai')) {
      if (url.includes('.onion')) next.nhentai_onion_cookies_raw = result.cookies;
      else next.nhentai_cookies_raw = result.cookies;
    } else if (url.includes('senkuro')) {
      next.senkuro_cookies_raw = result.cookies;
    }
    settings.save(next);
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
  ipcMain.handle(CH.refreshIgneous, async () => await exAccounts.refreshIgneous());
  handleSafe(CH.parseCookieText, z.tuple([anyString]), (_e, text: string) => parseCookieLogin(text ?? ''));
  ipcMain.handle(CH.getExAccounts, () => ({ accounts: exAccounts.accounts, currentId: exAccounts.currentId }));
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
  ipcMain.handle(CH.importExAccounts, async () => {
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

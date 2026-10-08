import { BrowserWindow, ipcMain } from 'electron';
import { CH } from '@shared/ipc';
import type { SyncState } from '@shared/sync';
import type { SyncService } from '../services/sync';

export interface GoogleAuthLike {
  status(): { authed: boolean; email: string | null; configured: boolean };
  login(): Promise<unknown>;
  logout(): Promise<void>;
}

export function broadcastSyncChanged(state: SyncState): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(CH.syncChanged, state);
}

export function registerSync(deps: { googleAuth: GoogleAuthLike; sync: SyncService }): void {
  const { googleAuth, sync } = deps;

  ipcMain.handle(CH.googleAuthStatus, () => googleAuth.status());
  ipcMain.handle(CH.googleLogin, async () => {
    const r = await googleAuth.login();
    return googleAuth.status();
  });
  ipcMain.handle(CH.googleLogout, async () => {
    await googleAuth.logout();
  });
  ipcMain.handle(CH.syncNow, () => sync.syncNow());
  ipcMain.handle(CH.syncGetState, () => sync.getState());
}

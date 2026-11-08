import { BrowserWindow } from 'electron';
import { z } from 'zod';
import { CH } from '@shared/ipc';
import type { SyncState } from '@shared/sync';
import type { SyncService } from '../services/sync';
import { handleSafe } from './validate';

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

  handleSafe(CH.googleAuthStatus, z.tuple([]), () => googleAuth.status());
  handleSafe(CH.googleLogin, z.tuple([]), async () => {
    const r = await googleAuth.login();
    return googleAuth.status();
  });
  handleSafe(CH.googleLogout, z.tuple([]), async () => {
    await googleAuth.logout();
  });
  handleSafe(CH.syncNow, z.tuple([]), () => sync.syncNow());
  handleSafe(CH.syncGetState, z.tuple([]), () => sync.getState());
}

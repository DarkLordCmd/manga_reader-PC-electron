import { ipcMain } from 'electron';
import { CH } from '../../shared/ipc';
import type { PinService } from '../services/pin';

export function registerPin(deps: { pin: PinService }): void {
  ipcMain.handle(CH.pinHasPin, () => deps.pin.hasPin());
  ipcMain.handle(CH.pinSetPin, (_e, p: string) => deps.pin.setPin(String(p)));
  ipcMain.handle(CH.pinRemovePin, (_e, p: string) => deps.pin.removePin(String(p)));
  ipcMain.handle(CH.pinVerifyPin, (_e, p: string) => deps.pin.verify(String(p)));
  ipcMain.handle(CH.pinFailedAttempt, () => deps.pin.failedAttempt());
}

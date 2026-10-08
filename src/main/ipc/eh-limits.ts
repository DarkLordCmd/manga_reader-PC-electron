import { ipcMain } from 'electron';
import { CH } from '../../shared/ipc';
import type { EhLimitWatcher } from '../services/eh-limits';

export function registerEhLimits(deps: { ehWatcher: EhLimitWatcher }): void {
  ipcMain.handle(CH.ehLimitsState, () => deps.ehWatcher.state());
}

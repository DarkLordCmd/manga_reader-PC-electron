import { BrowserWindow } from 'electron'
import { EhLimitWatcher, type EhLimitState } from './eh-limits'
import { CH } from '@shared/ipc'

export const ehWatcher = new EhLimitWatcher()

export function broadcastEhLimitState(): void {
  const s: EhLimitState = ehWatcher.state()
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(CH.ehLimitsChanged, s)
}

import { BrowserWindow } from 'electron';
import { z } from 'zod';
import { CH } from '@shared/ipc';
import type { SenkuroImportProgress } from '@shared/ipc';
import type { Settings } from '@shared/settings';
import { handleSafe } from './validate';
import { runSenkuroImport } from '../services/senkuro-import';
import { proxyForSource } from '../services/proxy-policy';
import type { LibraryService } from '../services/library';
import type { HistoryManager } from '../services/history';
import type { SettingsService } from '../services/settings';

const importOptions = z.object({
  statuses: z.array(z.string().max(20)).max(10).optional(),
  markRead: z.boolean().optional(),
  limit: z.number().int().positive().max(500).optional(),
});

export function registerSenkuroImport(deps: {
  library: LibraryService;
  history: HistoryManager;
  settings: SettingsService;
  effectiveTorSocks(): string;
  broadcastLibrary(): void;
  broadcastSettingsChanged(s: Settings): void;
}): void {
  handleSafe(CH.senkuroImport, z.tuple([importOptions.optional()]), async (_e, opts) => {
    const s = deps.settings.get();
    const send = (p: SenkuroImportProgress): void => {
      for (const w of BrowserWindow.getAllWindows()) {
        try {
          w.webContents.send(CH.senkuroImportProgress, p);
        } catch {
          /* window is closing */
        }
      }
    };
    const result = await runSenkuroImport(
      {
        library: deps.library,
        history: deps.history,
        settings: deps.settings,
        proxy: proxyForSource('senkuro', s, deps.effectiveTorSocks()),
        onProgress: send,
      },
      opts ?? {},
    );
    if (result.ok) {
      deps.broadcastLibrary();
      deps.broadcastSettingsChanged(deps.settings.get());
    }
    return result;
  });
}

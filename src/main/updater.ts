import { app } from 'electron';
import { logger } from './services/logger';

/**
 * Auto-update bootstrap. `electron-updater` is only meaningful for packaged
 * builds: it reads the app-update.yml that electron-builder writes next to the
 * binary from the `publish` config in electron-builder.yml (GitHub Releases).
 * Dev/unpacked runs short-circuit here. All failures are swallowed and logged
 * — an unreachable update channel must never prevent the app from starting.
 */
export function registerAutoUpdater(): void {
  if (!app.isPackaged) return;
  void import('electron-updater')
    .then((mod) => {
      // electron-updater is CJS: depending on the bundler's interop the named
      // export may only be reachable through `default`. Accessing
      // `autoUpdater.autoDownload` on undefined threw
      // "Cannot set properties of undefined" in the packaged build, so the
      // updater never even ran a check.
      const autoUpdater = (mod as any).autoUpdater ?? (mod as any).default?.autoUpdater;
      if (!autoUpdater) {
        logger.warn('[updater] electron-updater does not expose autoUpdater — updates disabled');
        return;
      }
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.on('error', (e: Error) => logger.warn('[updater]', e?.message ?? String(e)));
      autoUpdater.on('update-available', (info: { version?: string }) => logger.info('[updater] update available:', info?.version));
      autoUpdater.checkForUpdates().catch((e: Error) => logger.warn('[updater] check failed:', e?.message ?? String(e)));
    })
    .catch((e: Error) => logger.warn('[updater] init failed:', e?.message ?? String(e)));
}

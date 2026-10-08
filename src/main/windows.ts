import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { logger } from './services/logger';

export function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 480,
    minHeight: 360,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    let allowed = false;
    try {
      const devUrl = process.env['ELECTRON_RENDERER_URL'];
      const u = new URL(url);
      if (devUrl) allowed = u.origin === new URL(devUrl).origin;
      else allowed = u.href.startsWith(pathToFileURL(join(__dirname, '../renderer')).href);
    } catch {
      allowed = false;
    }
    if (!allowed) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  // Hidden helper windows (the browser-fetch engine and the login window) stay
  // open, so `window-all-closed` never fires and closing the main window left
  // the app (and its child processes) running. Quit explicitly on main close.
  win.on('closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
      logger.info('[main-window] load fail', code, desc, url, 'main:', isMain);
    });
    win.webContents.on('console-message', (_e, _lvl, msg, line, src) => {
      console.log(`[main-window-console] (${src ?? '?'}:${line ?? '?'}): ${String(msg).slice(0, 300)}`);
    });
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

export function registerLifecycle(deps: { onWillQuit: () => void }): void {
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('will-quit', deps.onWillQuit);
}

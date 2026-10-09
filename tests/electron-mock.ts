import { tmpdir } from 'os';
import { join } from 'path';

const noop = (): void => {};
const resolved = async (): Promise<void> => undefined;

const webContents = {
  send: noop,
  on: noop,
  once: noop,
  off: noop,
  removeListener: noop,
  executeJavaScript: async () => undefined,
  loadURL: resolved,
  loadFile: resolved,
  getURL: () => '',
  isLoadingMainFrame: () => false,
  setWindowOpenHandler: noop,
  getAllWindows: () => [],
};

class BrowserWindow {
  static getAllWindows(): BrowserWindow[] {
    return [];
  }
  webContents = webContents;
  on = noop;
  once = noop;
  off = noop;
  close = noop;
  destroy = noop;
  isDestroyed = () => false;
  setTitle = noop;
  show = noop;
  focus = noop;
  setMenuBarVisibility = noop;
}

const defaultStorage = {
  webRequest: { onBeforeRequest: noop, onHeadersReceived: noop, onBeforeSendHeaders: noop, onCompleted: noop },
  cookies: { get: async () => [], set: async () => {}, remove: async () => {} },
  setProxy: resolved,
  setPermissionRequestHandler: noop,
  setPermissionCheckHandler: noop,
};

const session = {
  fromPartition: () => defaultStorage,
  defaultSession: defaultStorage,
};

const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (s: string) => Buffer.from(s),
  decryptString: (b: Buffer) => b.toString('utf8'),
};

const httpFetchStub = async (url: string) => new Response('mocked', { status: 200 });

const ipcMain = { handle: noop };
const protocol = { registerSchemesAsPrivileged: noop, handle: resolved };
const net = { fetch: httpFetchStub };
const dialog = {
  showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  showSaveDialog: async () => ({ canceled: true, filePath: '' }),
  showErrorBox: noop,
};
const shell = { openExternal: resolved };
const clipboard = { readText: () => '', writeText: noop };
const nativeTheme = { shouldUseDarkColors: () => true };
const app = {
  getPath: () => join(tmpdir(), 'electron-mock-userdata'),
  getAppPath: () => join(tmpdir(), 'electron-mock-app'),
  getVersion: () => '0.0.0-test',
  whenReady: resolved,
  on: noop,
  once: noop,
  commandLine: { appendSwitch: noop },
  quit: noop,
  requestSingleInstanceLock: () => true,
};

export { BrowserWindow, session, ipcMain, protocol, net, safeStorage, dialog, shell, clipboard, nativeTheme, app };

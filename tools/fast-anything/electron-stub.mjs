/* global process, Buffer */
// Minimal electron stand-in so the harness can run under plain Node.
export const app = {
  getVersion: () => '44.0.0',
  getPath: () => process.cwd(),
  getName: () => 'manga-reader',
  isPackaged: false,
  on: () => {},
  whenReady: async () => {},
};
export const BrowserWindow = class {};
export const ipcMain = { handle: () => {}, on: () => {} };
export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (s: string) => Buffer.from(s),
  decryptString: (b: Buffer) => b.toString(),
};
export default { app, BrowserWindow, ipcMain, safeStorage };

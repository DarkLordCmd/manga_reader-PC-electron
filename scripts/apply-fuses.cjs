// electron-builder afterPack hook: harden the Electron fuses of the packaged exe.
//
// Default fuses are permissive and give a local attacker a straightforward path
// into the app's context (which holds ExHentai cookies and the DPAPI-encrypted
// settings):
//   ELECTRON_RUN_AS_NODE=1 "Manga Reader.exe" -e "..."   -> arbitrary code
//   NODE_OPTIONS=--require evil.js                        -> arbitrary code at boot
//   --inspect                                             -> debug the main process
//   editing app.asar next to the exe                      -> replaced app code
//   Network\Cookies                                       -> readable via OSCrypt "peanuts"
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const path = require('node:path');

exports.default = async function afterPack(context) {
  const { appOutDir, packager, electronPlatformName } = context;
  const exeName = `${packager.appInfo.productFilename}${electronPlatformName === 'win32' ? '.exe' : ''}`;
  const exe = path.join(appOutDir, exeName);
  await flipFuses(exe, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    // Cookie encryption via DPAPI: without it Chromium falls back to the
    // well-known "peanuts" key and the cookie jar is readable by any local
    // process. Cost: the first launch after this change logs the user out.
    [FuseV1Options.EnableCookieEncryption]: true,
    // Refuse an unpacked `app` directory next to the executable, and validate
    // the asar integrity header electron-builder embeds.
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    // The renderer now runs on app://renderer, so file:// needs no special
    // privileges at all.
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  });
  console.log(`[fuses] hardened ${exe}`);
};

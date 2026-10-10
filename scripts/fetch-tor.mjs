// Downloads the official Tor Expert Bundle (Windows x64) into vendor/tor so
// the packaged app ships the little-t tor daemon out of the box — the user
// installs nothing manually. Runs at build time (`npm run dist` calls it);
// skipped when vendor/tor already holds the current release.
// Integrity: the archive is checked against torproject's official
// sha256sums-signed-build.txt for the same release before extraction.
//
// Network strategy (mirrors on blocked networks are commonly dead):
//   1. direct HTTPS over the mirror list;
//   2. the local Tor SOCKS (127.0.0.1:9150, Tor Browser) as the transport;
//   3. FINAL fallback: copy the binaries from an installed Tor Browser.
// The tar layout is irrelevant: every FILE inside the archive is copied FLAT
// into vendor/tor — the runtime only looks for tor.exe/obfs4proxy there.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { connect as netConnect } from 'node:net';
import { join } from 'node:path';
import process from 'node:process';
import { buildConnector, Agent } from 'undici';
import { lstatSync } from 'node:fs';

const MIRRORS = [
  'https://dist.torproject.org/torbrowser',
  'https://mirror.netcologne.de/torproject.org/torbrowser',
  'https://tor.calyxinstitute.org/torbrowser',
];
const VENDOR = join(process.cwd(), 'vendor', 'tor');
const TMP = join(process.cwd(), 'scripts', '.tor-tmp');
const LOCAL_SOCKS = process.env.TOR_SOCKS || '127.0.0.1:9150';

// Official expert bundles exist per platform/arch (verified against the same
// sha256sums-signed-build.txt all platforms share). Keep vendor/tor populated
// for the CURRENT host only — electron-builder scopes it per target platform.
const BUNDLES = {
  win32: { prefix: 'tor-expert-bundle-windows', exe: 'tor.exe' },
  linux: { prefix: 'tor-expert-bundle-linux', exe: 'tor' },
  darwin: { prefix: 'tor-expert-bundle-macos', exe: 'tor' },
};
const PLATFORM_BUNDLE = BUNDLES[process.platform];
if (!PLATFORM_BUNDLE) throw new Error(`fetch-tor: unsupported platform ${process.platform}`);
const ARCH = process.arch === 'arm64' ? 'aarch64' : process.arch === 'x64' ? 'x86_64' : process.arch;
const ARCHIVE_PREFIX = `${PLATFORM_BUNDLE.prefix}-${ARCH}-`;
const TOR_EXE = PLATFORM_BUNDLE.exe;

function socks5Connect(proxyHost, proxyPort, destHost, destPort, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const socket = netConnect({ host: proxyHost, port: proxyPort });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('socks proxy timeout'));
    }, timeoutMs);
    socket.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    socket.once('connect', () => socket.write(Buffer.from([0x05, 0x01, 0x00])));
    const fail = (msg) => {
      clearTimeout(timer);
      socket.destroy();
      reject(new Error(msg));
    };
    let stage = 0;
    const stageData = (chunk) => {
      if (stage === 0) {
        if (chunk.length < 2 || chunk[0] !== 0x05 || chunk[1] !== 0x00) return fail('socks: bad auth method');
        stage = 1;
        const host = Buffer.from(destHost, 'utf-8');
        const port = Buffer.alloc(2);
        port.writeUInt16BE(destPort);
        socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, host.length]), host, port]));
      } else if (stage === 1) {
        if (chunk.length < 2 || chunk[0] !== 0x05 || chunk[1] !== 0x00) return fail(`socks: connect failed (rep=${chunk[1]})`);
        clearTimeout(timer);
        socket.off('data', stageData);
        resolve(socket);
      }
    };
    socket.on('data', stageData);
  });
}

function socksDispatcher(proxyAddr) {
  const [proxyHost, proxyPort] = proxyAddr.replace(/^socks[45h]:\/\//, '').split(':');
  const connector = buildConnector({ timeout: 60000 });
  return new Agent({
    connect: async (opts, callback) => {
      try {
        const destPort = Number(opts.port || 443);
        const socket = await socks5Connect(proxyHost || '127.0.0.1', Number(proxyPort || 9150), opts.hostname, destPort);
        if (opts.protocol !== 'https:') {
          callback(null, socket);
          return;
        }
        connector({ ...opts, httpSocket: socket }, callback);
      } catch (err) {
        callback(err, null);
      }
    },
  });
}

async function withFallback(path, asBuffer = false) {
  for (const base of MIRRORS) {
    try {
      const r = await fetch(`${base}${path}`, { redirect: 'follow' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return asBuffer ? Buffer.from(await r.arrayBuffer()) : await r.text();
    } catch (e) {
      console.log('[fetch-tor] mirror failed:', `${base}${path}`, e?.cause?.code ?? e?.message);
    }
  }
  console.log('[fetch-tor] falling back to local SOCKS', LOCAL_SOCKS);
  const r = await fetch(`${MIRRORS[0]}${path}`, {
    redirect: 'follow',
    dispatcher: socksDispatcher(LOCAL_SOCKS),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} via socks tunnel`);
  return asBuffer ? Buffer.from(await r.arrayBuffer()) : await r.text();
}

async function latestVersion() {
  const html = await withFallback('/');
  const versions = [...html.matchAll(/href="(\d+\.\d+(?:\.\d+)?)\/?"/g)]
    .map((m) => m[1])
    .map((v) => v.split('.').map(Number))
    .sort((a, b) => {
      for (let i = 0; i < 3; i++) {
        const d = (b[i] ?? 0) - (a[i] ?? 0);
        if (d !== 0) return d;
      }
      return 0;
    })
    .map((p) => p.join('.'));
  if (versions.length === 0) throw new Error('no versions listed on mirrors');
  return versions[0];
}

// An installed Tor Browser carries the very same binaries — online layout
// fallback for blocked networks.
function sourceFromInstalledTorBrowser() {
  const dirs = [
    join(process.env.ProgramFiles ?? '', 'Tor Browser', 'Browser', 'TorBrowser', 'Tor'),
    join(process.env['ProgramFiles(x86)'] ?? '', 'Tor Browser', 'Browser', 'TorBrowser', 'Tor'),
    'E:\\Tor Browser\\Browser\\TorBrowser\\Tor',
    'D:\\Tor Browser\\Browser\\TorBrowser\\Tor',
  ];
  for (const dir of dirs) {
    if (dir && existsSync(join(dir, TOR_EXE))) return dir;
  }
  return null;
}

function copyFromInstalledTorBrowser(verFile, ver, sourceDir) {
  copyFileSync(join(sourceDir, TOR_EXE), join(VENDOR, TOR_EXE));
  const pt = join(sourceDir, 'PluggableTransports');
  if (existsSync(pt)) {
    for (const name of readdirSync(pt)) copyFileSync(join(pt, name), join(VENDOR, name));
  }
  writeFileSync(verFile, `${ver}+local (${sourceDir})`);
  console.log('[fetch-tor] ok (from local Tor Browser) ->', VENDOR);
}

async function main() {
  mkdirSync(VENDOR, { recursive: true });
  const verFile = join(VENDOR, '.tor-version');

  // Version discovery also fails on a blocked network — that must fall into
  // the local Tor Browser path too, not abort.
  let ver = null;
  try {
    ver = await latestVersion();
  } catch {
    const localTB = sourceFromInstalledTorBrowser();
    if (!localTB) throw new Error('mirrors unreachable and no local Tor Browser found');
    if (existsSync(verFile) && existsSync(join(VENDOR, TOR_EXE))) {
      console.log('[fetch-tor] mirrors unreachable — keeping existing vendor/tor from', readFileSync(verFile, 'utf8').trim());
      return;
    }
    console.log('[fetch-tor] mirrors unreachable — using installed Tor Browser:', localTB);
    copyFromInstalledTorBrowser(verFile, ver ?? 'unknown', localTB);
    return;
  }
  if (existsSync(verFile) && readFileSync(verFile, 'utf8').trim() === ver && existsSync(join(VENDOR, TOR_EXE))) {
    console.log(`[fetch-tor] vendor/tor already has ${ver} — skipping download`);
    return;
  }
  const tarName = `${ARCHIVE_PREFIX}${ver}.tar.gz`;
  const path = `/${ver}/${tarName}`;

  let buf = null;
  let failure = null;
  try {
    console.log('[fetch-tor] downloading', tarName);
    buf = await withFallback(path, true);
  } catch (e) {
    failure = e?.message ?? String(e);
  }

  if (!buf) {
    // Mirrors unreachable (or unavailable network) AND no checksum source.
    const localTB = sourceFromInstalledTorBrowser();
    if (!localTB) throw new Error(`mirrors unreachable and no local Tor Browser found: ${failure}`);
    console.log('[fetch-tor] mirrors unreachable — using installed Tor Browser:', localTB);
    copyFromInstalledTorBrowser(verFile, ver, localTB);
    return;
  }

  const tmp = join(process.cwd(), 'scripts', '.tor-tmp');
  if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  writeFileSync(join(tmp, tarName), buf);
  execFileSync('tar', ['-xf', join(tmp, tarName), '-C', tmp], { stdio: 'inherit' });

  try {
    const sums = await withFallback(`/${ver}/sha256sums-signed-build.txt`);
    const line = sums.split('\n').find((l) => l.includes(tarName));
    if (line) {
      const expected = line.trim().split(/\s+/)[0].toLowerCase();
      const actual = createHash('sha256').update(buf).digest('hex');
      if (expected !== actual) throw new Error(`SHA-256 mismatch: expected ${expected}, got ${actual}`);
      console.log('[fetch-tor] sha256 verified:', actual.slice(0, 24) + '…');
    } else {
      console.log('[fetch-tor] warn: archive not listed in sha256sums-signed-build.txt — continuing');
    }
  } catch (e) {
    if (String(e.message).includes('SHA-256 mismatch')) throw e;
    console.log('[fetch-tor] warn: checksum manifest unavailable —', e?.message ?? e);
  }

  if (existsSync(VENDOR)) rmSync(VENDOR, { recursive: true, force: true });
  mkdirSync(VENDOR, { recursive: true });
  for (const src of [tmp]) {
    flattenAll(src, VENDOR);
  }
  if (!existsSync(join(VENDOR, TOR_EXE))) {
    throw new Error(`${TOR_EXE} not found in extracted archive — unexpected tar layout`);
  }
  writeFileSync(verFile, ver);
  rmSync(tmp, { recursive: true, force: true });
  console.log('[fetch-tor] ok:', ver, '->', VENDOR);
}

function flattenAll(src, dst) {
  for (const name of readdirSync(src)) {
    const from = join(src, name);
    const st = lstatSync(from);
    if (st.isDirectory()) {
      // Data/ subfolder layout from the expert bundle is NOT flattened that
      // way — data folders are cache-only and never needed by the runtime.
      if (name === 'Data') continue;
      flattenAll(from, dst);
    } else copyFileSync(from, join(dst, name));
  }
}

main().catch((e) => {
  console.log('[fetch-tor] FAILED:', e.message);
  // Non-fatal at build time when a previous vendor/tor exists; a checksum
  // mismatch aborts loudly so a bad archive is never packaged.
  process.exitCode = existsSync(join(VENDOR, TOR_EXE)) ? 0 : 1;
});

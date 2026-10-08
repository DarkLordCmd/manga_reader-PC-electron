import { spawn, type ChildProcess } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import { probeBridgeLine, parseBridgeAddr } from './tor-check';
import { logger } from './logger';

/** Bundled "little-t tor" daemon so the user does not have to install or
 * configure Tor Browser. Lifecycle:
 *   - settings.builtin_tor switches the daemon on/off;
 *   - it listens strictly on 127.0.0.1:9153 (SOCKS) / 9158 (control, reserved)
 *     so the user's own Tor Browser on 9150 cannot collide;
 *   - bridges from settings.tor_bridges are probed, ranked by latency and
 *     started ONE per embedded-tor launch (fastest configures first); if the
 *     bootstrap fails, a watchdog switches to the next ranked bridge;
 *   - obfs4proxy/lyrebird ships next to the tor binary;
 *   - `--__OwningControllerProcess` makes tor exit when our process exits. */
export const EMBEDDED_SOCKS_PORT = 9153;

const BOOT_TIMEOUT_MS = 90_000;
const WATCHDOG_INTERVAL_MS = 20_000;
const MAX_CONSECUTIVE_SOCKS_FAILURES = 2;

let proc: ChildProcess | null = null;
let activeSocks: string | null = null;
let currentBridge: string | null = null;
let readyResolve: (() => void) | null = null;
let readyPromise: Promise<void> = Promise.resolve();
const skippedBridges = new Set<string>();
let lastStart: { bridges: string; dataDir: string } | null = null;
let watchdog: ReturnType<typeof setInterval> | undefined = undefined;
let socksAliveStreak = 0;
let restarting = false;

function resetReadyPromise(): void {
  readyPromise = new Promise((resolve) => {
    readyResolve = resolve;
  });
}
resetReadyPromise();

export function embeddedTorSocks(): string | null {
  return activeSocks;
}

/** Resolves once the embedded daemon has bootstrapped (Bootstrapped 100%).
 * Resolves immediately if already up. Waits for the daemon to be *spawned*
 * first (startup bridge ranking can take seconds, during which `proc` is null)
 * and rejects only if it is still not ready after `timeoutMs`. */
export async function whenEmbeddedTorReady(timeoutMs = 120_000): Promise<void> {
  if (activeSocks) return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (activeSocks) return;
    if (proc && !proc.killed) {
      const remaining = Math.max(1, deadline - Date.now());
      await Promise.race([readyPromise, new Promise<void>((r) => setTimeout(r, remaining))]);
    } else {
      // The daemon has not been spawned yet (bridge ranking / restart): wait for
      // it instead of failing the caller's request immediately.
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error('embedded tor not ready');
}

function torBinaryDir(): string | null {
  const candidates = [app.isPackaged ? join(process.resourcesPath ?? '', 'tor') : '', join(app.getAppPath(), 'vendor', 'tor')].filter(
    Boolean,
  );
  const exe = process.platform === 'win32' ? 'tor.exe' : 'tor';
  for (const dir of candidates) {
    if (existsSync(join(dir, exe))) return dir;
  }
  return null;
}

function bridgeArgs(bridges: string, binDir: string): string[] {
  const lines = bridges
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (lines.length === 0) return [];
  const args: string[] = [];
  if (lines.some((l) => l.startsWith('obfs4 '))) {
    // Recent Tor Browser renamed obfs4proxy to lyrebird — accept both.
    const exe =
      process.platform === 'win32'
        ? (['obfs4proxy.exe', 'lyrebird.exe'].find((n) => existsSync(join(binDir, n))) ?? 'obfs4proxy.exe')
        : (['obfs4proxy', 'lyrebird'].find((n) => existsSync(join(binDir, n))) ?? 'obfs4proxy');
    args.push('--ClientTransportPlugin', `obfs4 exec ${join(binDir, exe)}`);
  }
  for (const bridge of lines) args.push('--Bridge', bridge);
  args.push('--UseBridges', '1');
  return args;
}

/** TCP probes every bridge concurrently and returns its line sorted by
 * measured latency; dead ones are dropped, keeping only reachable lines. */
async function rankBridges(bridges: string): Promise<string[]> {
  const lines = bridges
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (lines.length === 0) return [];
  const probed = await Promise.all(
    lines.map(async (l) => {
      return await probeBridgeLine(l);
    }),
  );
  const ok = probed.filter((p) => p.state === 'reachable' && parseBridgeAddr(p.line));
  return ok.sort((a, b) => (a.latencyMs ?? 1e9) - (b.latencyMs ?? 1e9)).map((p) => p.line);
}

/** SOCKS receiver heartbeat — a trivial SOCKS5 greeting that tor answers even
 * before relays are up, so it proves the daemon's listener is responsive. */
function socksAlive(timeoutMs = 4_000): Promise<boolean> {
  return new Promise((resolve) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const net = require('net') as typeof import('net');
    const sock = net.connect({ host: '127.0.0.1', port: EMBEDDED_SOCKS_PORT });
    const done = (v: boolean): void => {
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve(v);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    sock.once('timeout', () => done(false));
  });
}

function stopProcess(): void {
  if (proc) {
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
  }
  proc = null;
  activeSocks = null;
  currentBridge = null;
}

function launchTor(bridgeLine: string, binDir: string, dataDir: string): void {
  const args: string[] = [
    '--SocksPort',
    `127.0.0.1:${EMBEDDED_SOCKS_PORT} IPv6Traffic PreferIPv6`,
    '--ControlPort',
    '127.0.0.1:9158',
    '--CookieAuthentication',
    '1',
    '--ClientOnly',
    '1',
    '--DataDirectory',
    dataDir,
    '--Log',
    'notice stdout',
    '--__OwningControllerProcess',
    String(process.pid),
  ];
  args.push(...bridgeArgs(bridgeLine, binDir));
  currentBridge = bridgeLine || null;
  try {
    proc = spawn(join(binDir, process.platform === 'win32' ? 'tor.exe' : 'tor'), args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (e: any) {
    logger.info('[tor-embedded] spawn failed:', e?.message);
    proc = null;
    return;
  }
  proc.stdout?.on('data', onTorLine);
  proc.stderr?.on('data', onTorLine);
  proc.on('exit', (code) => {
    logger.info(`[tor-embedded] tor exited code=${code}${currentBridge ? ' (bridge ' + parseBridgeAddr(currentBridge)?.host + ')' : ''}`);
    stopProcess();
  });
}

function onTorLine(buf: Buffer): void {
  for (const line of buf.toString('utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    if (t.includes('Bootstrapped 100%')) {
      activeSocks = `127.0.0.1:${EMBEDDED_SOCKS_PORT}`;
      socksAliveStreak = 0;
      readyResolve?.();
      logger.info(`[tor-embedded] ready on ${activeSocks}${currentBridge ? ' via bridge ' + parseBridgeAddr(currentBridge)?.host : ''}`);
    }
    logger.info('[tor-embedded]', t);
  }
}

/** Boots the daemon with a single (given) bridge and waits for bootstrap. */
async function attemptBridge(bridgeLine: string, binDir: string, dataDir: string): Promise<{ socks: string } | null> {
  resetReadyPromise();
  mkdirSync(dataDir, { recursive: true });
  launchTor(bridgeLine, binDir, dataDir);
  if (!proc) return null;
  return await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), BOOT_TIMEOUT_MS);
    const poll = setInterval(() => {
      if (activeSocks) {
        clearTimeout(timer);
        clearInterval(poll);
        resolve({ socks: activeSocks ?? '' });
      } else if (!proc) {
        clearTimeout(timer);
        clearInterval(poll);
        resolve(null);
      }
    }, 500);
    readyPromise
      .then(() => {
        clearTimeout(timer);
        clearInterval(poll);
        resolve(activeSocks ? { socks: activeSocks } : null);
      })
      .catch(() => {});
  });
}

async function bootFastRecovery(): Promise<void> {
  // Reserved for logs (intentionally no-op).
}
void bootFastRecovery;

async function runRotation(bridges: string, userDataDir: string): Promise<{ socks: string } | null> {
  const binDir = torBinaryDir();
  if (!binDir) {
    logger.info('[tor-embedded] bundled tor not found (vendor/tor or resources/tor) — fallback to user Tor');
    return null;
  }
  const dataRoot = join(userDataDir, 'tor-data');
  mkdirSync(dataRoot, { recursive: true });
  lastStart = { bridges, dataDir: dataRoot };

  const ranked = await rankBridges(bridges);
  if (ranked.length === 0) {
    logger.info('[tor-embedded] no reachable bridge — starting tor WITHOUT bridges (direct)');
    return await attemptBridge('', binDir, dataRoot);
  }
  const candidates = ranked.filter((l) => !skippedBridges.has(l));
  const tried = candidates.length > 0 ? candidates : ranked; // nothing left → start over
  logger.info(
    `[tor-embedded] bridge ranking: ${ranked.map((l) => parseBridgeAddr(l)?.host).join(' → ')}${skippedBridges.size ? ` (skipped: ${skippedBridges.size})` : ''}`,
  );
  for (const cand of tried) {
    stopProcess();
    logger.info(`[tor-embedded] trying bridge ${parseBridgeAddr(cand)?.host}`);
    const r = await attemptBridge(cand, binDir, dataRoot);
    if (r) {
      startWatchdog(cand);
      return r;
    }
    logger.info(`[tor-embedded] bridge ${parseBridgeAddr(cand)?.host} failed to bootstrap — blacklisting for this session`);
    skippedBridges.add(cand);
    stopProcess();
  }
  // Every bridge failed → allow next invocation to try everything again.
  skippedBridges.clear();
  logger.info('[tor-embedded] all bridges exhausted; falling back to direct start');
  return await attemptBridge('', binDir, dataRoot);
}

function startWatchdog(bridgeLine: string): void {
  clearInterval(watchdog!);
  socksAliveStreak = 0;
  watchdog = setInterval(async () => {
    if (!proc || restarting) return;
    const alive = await socksAlive();
    socksAliveStreak = alive ? 0 : socksAliveStreak + 1;
    if (socksAliveStreak < MAX_CONSECUTIVE_SOCKS_FAILURES) return;
    logger.info(`[tor-embedded] SOCKS listener dead via bridge ${parseBridgeAddr(bridgeLine)?.host} — rotating`);
    restarting = true;
    stopProcess();
    clearInterval(watchdog!);
    const cfg = lastStart;
    if (cfg) {
      skippedBridges.add(bridgeLine);
      void startEmbeddedTor(cfg.bridges, join(cfg.dataDir, '..')).catch((e) => logger.warn('[tor-embedded] watchdog restart failed', e));
    }
    restarting = false;
  }, WATCHDOG_INTERVAL_MS);
}

export async function startEmbeddedTor(bridges: string, userDataDir: string): Promise<{ socks: string } | null> {
  if (proc && !proc.killed) return { socks: `127.0.0.1:${EMBEDDED_SOCKS_PORT}` };
  return await runRotation(bridges, userDataDir);
}

export function stopEmbeddedTor(): void {
  clearInterval(watchdog!);
  stopProcess();
}

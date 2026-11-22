import { spawn, type ChildProcess } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import { probeBridgeLine, parseBridgeAddr } from './tor-check';
import { markBridgeHealth } from './tor-bridge-health';
import { logger } from './logger';
import { EMBEDDED_CONTROL_PORT, EMBEDDED_SOCKS_PORT } from './tor-config';

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
export { EMBEDDED_SOCKS_PORT, EMBEDDED_CONTROL_PORT } from './tor-config';

const BOOT_TIMEOUT_MS = 45_000;
const WATCHDOG_INTERVAL_MS = 20_000;
const MAX_CONSECUTIVE_SOCKS_FAILURES = 2;
/** Circuit checks are noisier than a dead listener (a transient network blip
 * rebuilds circuits within seconds), so require a minute before rotating. */
const MAX_CONSECUTIVE_CIRCUIT_FAILURES = 3;

let proc: ChildProcess | null = null;
let activeSocks: string | null = null;
let currentBridge: string | null = null;
let readyResolve: (() => void) | null = null;
let readyPromise: Promise<void> = Promise.resolve();
const skippedBridges = new Set<string>();
let lastStart: { bridges: string; dataDir: string } | null = null;
/** How many --Bridge lines the running daemon actually uses (the app launches
 * the fastest reachable one; Tor warns that two would enable conflux). */
let activeBridgeCount = 0;
let watchdog: ReturnType<typeof setInterval> | undefined = undefined;
let socksAliveStreak = 0;
let restarting = false;
/** Resolves the current attemptBridge() as a failure; used when the bridge is
 * provably dead long before BOOT_TIMEOUT_MS. */
let abortAttempt: (() => void) | null = null;
let bridgeFailStreak = 0;
let attemptStartedAt = 0;
/** Set while an intentional stop/rotation is in progress, so the child's
 * `exit` event does not schedule a second, competing restart. */
let stopping = false;
let restartTimer: ReturnType<typeof setTimeout> | undefined = undefined;
let restartDelayMs = 5_000;
/** Single-flight guard for bridge rotation. Without it an `exit`-driven
 * restart and a watchdog rotation could run concurrently: the second one
 * killed the freshly started daemon right before it finished bootstrapping,
 * so an unstable bridge set turned into an endless restart storm (each cycle
 * paying the full 10-40 s bootstrap). */
let rotationInFlight: Promise<{ socks: string } | null> | null = null;

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
    // An intentional stop must fail fast instead of making callers wait out the
    // whole timeout for a daemon that will never come up.
    if (stopping && !proc) throw new Error('embedded tor stopped');
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

/** Parses the Tor control reply for `status/circuit-established`: 1 = at
 * least one usable circuit exists, 0 = daemon alive but unable to reach the
 * network (dead bridge/guard). `null` means the reply did not contain it. */
export function parseCircuitEstablished(reply: string): boolean | null {
  const m = reply.match(/status\/circuit-established=([01])/);
  return m ? m[1] === '1' : null;
}

/** Runs one authenticated command on the local Tor control port and returns
 * the full reply, or null when the port/cookie is unavailable. */
function controlCommand(command: string, dataDir: string, timeoutMs = 5_000): Promise<string | null> {
  return new Promise((resolve) => {
    let cookie: Buffer;
    try {
      cookie = readFileSync(join(dataDir, 'control_auth_cookie'));
    } catch {
      resolve(null);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const net = require('net') as typeof import('net');
    const sock = net.connect({ host: '127.0.0.1', port: EMBEDDED_CONTROL_PORT });
    let buf = '';
    let stage = 1;
    const finish = (v: string | null): void => {
      clearTimeout(timer);
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    sock.setTimeout(timeoutMs);
    sock.once('error', () => finish(null));
    sock.once('timeout', () => finish(null));
    sock.once('connect', () => sock.write(`AUTHENTICATE ${cookie.toString('hex')}\r\n`));
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      if (stage === 1 && buf.includes('250 OK')) {
        stage = 2;
        buf = '';
        sock.write(`${command}\r\n`);
        return;
      }
      if (stage === 2 && (buf.includes('250 OK') || /^5\d\d /m.test(buf))) {
        finish(/^5\d\d /m.test(buf) ? null : buf);
      }
    });
  });
}

function controlCircuitEstablished(dataDir: string): Promise<boolean | null> {
  return controlCommand('GETINFO status/circuit-established', dataDir).then((reply) =>
    reply === null ? null : parseCircuitEstablished(reply),
  );
}

/** Tor rate-limits NEWNYM itself (observed: "Rate limiting NEWNYM request:
 * delaying by 5-10 seconds"). Firing it twice in quick succession makes the
 * second one a no-op, so the retry still uses the banned circuit. Space the
 * signals out and wait for the queue to clear first. */
let lastNewnymAt = 0;
const NEWNYM_MIN_GAP_MS = 11_000;

async function newnymSpaced(dataDir: string): Promise<boolean> {
  const wait = NEWNYM_MIN_GAP_MS - (Date.now() - lastNewnymAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const reply = await controlCommand('SIGNAL NEWNYM', dataDir);
  if (reply && reply.includes('250 OK')) lastNewnymAt = Date.now();
  return !!reply && reply.includes('250 OK');
}

/** Drops the current circuit (`SIGNAL NEWNYM`) so the next request does not
 * inherit a slow/dead path. Used by the login window when the first page
 * takes too long; a no-op when the bundled daemon is not running. */
export async function requestNewTorCircuit(): Promise<boolean> {
  const cfg = lastStart;
  if (!cfg || !proc || !activeSocks) return false;
  const ok = await newnymSpaced(cfg.dataDir);
  logger.info(`[tor-embedded] SIGNAL NEWNYM ${ok ? 'ok' : 'failed'}`);
  return ok;
}

/** Exit relays we already tripped a per-IP limit on in this session. NEWNYM
 * alone frequently reuses the SAME exit for the same destination, so a plain
 * "new circuit" does not lift a site ban. Excluding the banned relay from the
 * circuit path makes Tor pick a different one. */
const excludedExits = new Set<string>();
let excludedAt = 0;
const EXCLUDED_TTL_MS = 30 * 60_000;
const MAX_EXCLUDED = 15;

/** Exit fingerprints of BUILT general circuits (last hop of each path).
 * Paths with fewer than 3 nodes are skipped: with bridges Tor briefly builds
 * one-hop circuits through the BRIDGE itself, and their "last node" is the
 * bridge — excluding that broke connectivity entirely ("Not using bridge … it
 * is in ExcludeNodes"). A normal circuit is guard/bridge + middle + exit. */
export function parseExitFingerprints(reply: string): string[] {
  const out: string[] = [];
  for (const line of reply.split('\n')) {
    if (!line.includes(' BUILT ') || !/PURPOSE=GENERAL/.test(line)) continue;
    const fps = [...line.matchAll(/\$([0-9A-Fa-f]{40})/g)].map((m) => m[1].toUpperCase());
    if (fps.length >= 3) out.push(fps[fps.length - 1]);
  }
  return out;
}

/** Fingerprints mentioned in the configured bridge lines — never exclude these. */
function bridgeFingerprints(bridges: string): Set<string> {
  const set = new Set<string>();
  for (const m of bridges.matchAll(/\b([0-9A-Fa-f]{40})\b/g)) set.add(m[1].toUpperCase());
  return set;
}

async function currentExits(dataDir: string): Promise<string[]> {
  const reply = await controlCommand('GETINFO circuit-status', dataDir);
  return reply ? parseExitFingerprints(reply) : [];
}

/** Clears our exclusion list and asks for a fresh circuit. Used as a safety net:
 * a wrong exclusion must never leave the daemon unable to build circuits. */
async function clearExclusions(dataDir: string): Promise<void> {
  excludedExits.clear();
  await controlCommand('SETCONF ExcludeNodes=', dataDir);
  await controlCommand('SIGNAL NEWNYM', dataDir);
}

/**
 * Moves to a DIFFERENT exit relay: blacklist the one we are on, then NEWNYM and
 * wait until a circuit with a new exit is built. This is what actually bypasses
 * a per-IP ban (E-Hentai "excessive request rate"), because the ban follows the
 * exit address. Returns changed=false when the control port is unavailable or
 * Tor could not build a circuit outside the blacklist (exclusions are reverted).
 */
export async function rotateTorExit(): Promise<{ changed: boolean; exit: string | null }> {
  const cfg = lastStart;
  if (!cfg || !proc || !activeSocks) return { changed: false, exit: null };
  if (Date.now() - excludedAt > EXCLUDED_TTL_MS) {
    excludedExits.clear();
    excludedAt = Date.now();
  }
  const bridges = bridgeFingerprints(cfg.bridges ?? '');
  let before = await currentExits(cfg.dataDir);
  if (before.length === 0) {
    // Just after a previous NEWNYM the circuits may be torn down already; give
    // Tor a moment so we still learn (and exclude) the exit we were banned on.
    await new Promise((r) => setTimeout(r, 600));
    before = await currentExits(cfg.dataDir);
  }
  for (const fp of before) {
    if (bridges.has(fp)) continue; // a bridge is not an exit
    excludedExits.add(fp);
  }
  if (excludedExits.size > 0) {
    const list = [...excludedExits].filter((fp) => !bridges.has(fp)).slice(-MAX_EXCLUDED).map((fp) => `$${fp}`);
    const reply = await controlCommand(`SETCONF ExcludeNodes=${list.join(',')}`, cfg.dataDir);
    if (!reply) {
      logger.warn('[tor-embedded] SETCONF ExcludeNodes rejected — rotating without exclusions');
      await clearExclusions(cfg.dataDir);
    }
  }
  const signal = await newnymSpaced(cfg.dataDir);
  if (!signal) return { changed: false, exit: null };
  // NEWNYM marks circuits dirty, but Tor builds a replacement only when the next
  // stream needs one — polling circuit-status here would time out even though the
  // exit WILL change on the next request. Look briefly for a rebuilt circuit (to
  // report the new exit), then accept the rotation.
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    const after = await currentExits(cfg.dataDir);
    const fresh = after.find((fp) => !before.includes(fp) && !bridges.has(fp));
    if (fresh) {
      logger.info(`[tor-embedded] rotated exit ${before[before.length - 1] ?? '?'} -> ${fresh}`);
      return { changed: true, exit: fresh };
    }
  }
  logger.info('[tor-embedded] circuit invalidated; the next request picks a new exit (banned exits excluded)');
  return { changed: true, exit: null };
}

export interface TorDiagnostics {
  running: boolean;
  socks: string | null;
  bootstrap: string | null;
  circuits: number;
  exits: string[];
  bridgeCount: number;
}

/** Snapshot for the settings screen: bootstrap phase, built circuits and the
 * exits currently in use. Also lets the UI warn when only one bridge is
 * configured (Tor wants at least two for conflux/resilience). */
export async function getTorDiagnostics(): Promise<TorDiagnostics> {
  const cfg = lastStart;
  const running = !!proc && !!activeSocks;
  const bridgeCount = activeBridgeCount;
  if (!cfg || !running) return { running, socks: activeSocks, bootstrap: null, circuits: 0, exits: [], bridgeCount };
  let bootstrap: string | null = null;
  let circuits = 0;
  let exits: string[] = [];
  try {
    const phase = await controlCommand('GETINFO status/bootstrap-phase', cfg.dataDir);
    const m = phase?.match(/PROGRESS=(\d+)(?:\s+TAG=([^\s]+))?/);
    bootstrap = m ? (m[2] ? `${m[1]}% ${m[2]}` : `${m[1]}%`) : null;
    const status = await controlCommand('GETINFO circuit-status', cfg.dataDir);
    if (status) {
      circuits = status.split('\n').filter((l) => l.includes(' BUILT ')).length;
      exits = parseExitFingerprints(status);
    }
  } catch {
    /* diagnostics are best-effort */
  }
  return { running, socks: activeSocks, bootstrap, circuits, exits, bridgeCount };
}
function stopProcess(): void {
  const child = proc;
  proc = null;
  activeSocks = null;
  currentBridge = null;
  if (child) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
}

/** Kills the current child and waits (bounded) until it is really gone.
 * Tor keeps a lock on its DataDirectory and the SOCKS/control ports until the
 * process exits: spawning the next bridge immediately after `kill()` made the
 * new tor fail with "could not lock data directory"/EADDRINUSE, which looked
 * like "this bridge is dead" and blacklisted a perfectly good bridge. */
async function stopProcessAndWait(timeoutMs = 3_000): Promise<void> {
  const child = proc;
  if (!child) {
    stopProcess();
    return;
  }
  const exited = new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const t = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(t);
      resolve();
    });
  });
  stopProcess();
  await exited;
}

/** Restarts Tor after an unexpected exit or a confirmed dead-circuit state.
 * Uses the same bridge list/data dir as the last successful start; the delay
 * backs off to 60 s so a permanently blocked network is not hammered. */
function scheduleRestart(reason: string): void {
  if (stopping || restartTimer) return;
  // A rotation is already in progress and will either succeed or schedule its
  // own restart — never start a competing one that kills its daemon.
  if (rotationInFlight) return;
  const cfg = lastStart;
  if (!cfg) return;
  const delay = restartDelayMs;
  restartDelayMs = Math.min(60_000, restartDelayMs * 2);
  logger.info(`[tor-embedded] ${reason}; restarting in ${Math.round(delay / 1000)}s`);
  restartTimer = setTimeout(() => {
    restartTimer = undefined;
    if (stopping) return;
    void runRotation(cfg.bridges, join(cfg.dataDir, '..'))
      .then((r) => {
        if (r) restartDelayMs = 5_000;
        else scheduleRestart('restart produced no usable Tor');
      })
      .catch((e) => {
        logger.warn('[tor-embedded] restart failed', e);
        scheduleRestart('restart error');
      });
  }, delay);
}

function launchTor(bridgeLine: string, binDir: string, dataDir: string): void {
  activeBridgeCount = bridgeLine.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).length;
  const args: string[] = [
    '--SocksPort',
    // No PreferIPv6: it makes Tor prefer IPv6 for relay/directory connections,
    // which is slower (or broken) on IPv4-only ISP links. Tor Browser itself
    // does not set it either.
    `127.0.0.1:${EMBEDDED_SOCKS_PORT} IPv6Traffic IsolateSOCKSAuth`,
    '--ControlPort',
    `127.0.0.1:${EMBEDDED_CONTROL_PORT}`,
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
  const child = proc;
  // `spawn` does not throw for ENOENT/EACCES/"not a valid Win32 application" —
  // the failure only arrives as an 'error' event. Without this listener the
  // half-created child stayed "alive" forever: attemptBridge waited the full
  // 45 s per bridge and whenEmbeddedTorReady() hung until its 120 s timeout.
  child.on('error', (e: any) => {
    logger.warn('[tor-embedded] tor process error:', e?.message ?? e);
    if (child === proc) stopProcess();
    abortAttempt?.();
    if (!stopping) scheduleRestart('tor process error');
  });
  child.stdout?.on('data', (b: Buffer) => onTorLine(child, b));
  child.stderr?.on('data', (b: Buffer) => onTorLine(child, b));
  child.on('exit', (code) => {
    // A newer process may already have replaced this one (bridge rotation);
    // an exit from the old child must not kill or restart the new daemon.
    if (child !== proc) return;
    logger.info(`[tor-embedded] tor exited code=${code}${currentBridge ? ' (bridge ' + parseBridgeAddr(currentBridge)?.host + ')' : ''}`);
    stopProcess();
    if (stopping) return;
    scheduleRestart('tor exited unexpectedly');
  });
}

function onTorLine(child: ChildProcess, buf: Buffer): void {
  // Output of a replacement/stopped child must never mark the daemon ready:
  // a late "Bootstrapped 100%" from the previous process used to advertise
  // 127.0.0.1:9153 while the new one had not even bound the port.
  if (child !== proc) return;
  for (const line of buf.toString('utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    // The watchdog opens a control connection every 20 s; tor logs each one at
    // notice level. Logging them grew main.log by ~4k lines/day for no signal.
    if (t.includes('New control connection')) continue;
    // obfs4 answers this when the bridge is down/blocked — retrying the same
    // one only burns the bootstrap timeout.
    if (t.includes('unable to connect') && /general SOCKS server failure|connection refused|TLS error/i.test(t)) {
      bridgeFailStreak++;
      if (bridgeFailStreak >= 3 && !activeSocks) {
        logger.info('[tor-embedded] bridge unreachable, rotating early');
        abortAttempt?.();
        stopProcess();
      }
    }
    if (t.includes('Bootstrapped 100%')) {
      activeSocks = `127.0.0.1:${EMBEDDED_SOCKS_PORT}`;
      socksAliveStreak = 0;
      bridgeFailStreak = 0;
      restartDelayMs = 5_000;
      readyResolve?.();
      logger.info(
        `[tor-embedded] ready on ${activeSocks}${currentBridge ? ' via bridge ' + parseBridgeAddr(currentBridge)?.host : ''}` +
          (attemptStartedAt ? ` after ${((Date.now() - attemptStartedAt) / 1000).toFixed(1)} s` : ''),
      );
    }
    logger.info('[tor-embedded]', t);
  }
}

/** Boots the daemon with a single (given) bridge and waits for bootstrap. */
async function attemptBridge(bridgeLine: string, binDir: string, dataDir: string): Promise<{ socks: string } | null> {
  if (stopping) return null;
  resetReadyPromise();
  bridgeFailStreak = 0;
  attemptStartedAt = Date.now();
  mkdirSync(dataDir, { recursive: true });
  launchTor(bridgeLine, binDir, dataDir);
  if (!proc) return null;
  const result = await new Promise<{ socks: string } | null>((resolve) => {
    let settled = false;
    const finish = (v: { socks: string } | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      abortAttempt = null;
      resolve(v);
    };
    // A bridge that answers "general SOCKS server failure" will never
    // bootstrap; aborting on the third such line turns a 90-second wait per
    // dead bridge into ~20 seconds, so the next ranked bridge starts sooner.
    abortAttempt = () => finish(null);
    const timer = setTimeout(() => finish(null), BOOT_TIMEOUT_MS);
    const poll = setInterval(() => {
      if (stopping) finish(null);
      else if (activeSocks) finish({ socks: activeSocks ?? '' });
      else if (!proc) finish(null);
    }, 500);
    readyPromise
      .then(() => finish(activeSocks ? { socks: activeSocks } : null))
      .catch(() => {});
  });
  if (bridgeLine.trim() && !stopping) markBridgeHealth(join(dataDir, '..'), bridgeLine, !!result);
  return result;
}

async function bootFastRecovery(): Promise<void> {
  // Reserved for logs (intentionally no-op).
}
void bootFastRecovery;

/** Bridge that actually bootstrapped last time, persisted across launches:
 * starting from it skips both the latency probe and the walk through dead
 * bridges, which is most of a cold start. */
const PREFERRED_TTL_MS = 7 * 24 * 3600_000;

function preferredBridgePath(userDataDir: string): string {
  return join(userDataDir, 'tor-last-bridge.json');
}

function loadPreferredBridge(userDataDir: string, bridges: string): string | null {
  try {
    const j = JSON.parse(readFileSync(preferredBridgePath(userDataDir), 'utf-8')) as { line?: string; at?: number };
    if (!j.line || typeof j.at !== 'number' || Date.now() - j.at > PREFERRED_TTL_MS) return null;
    const known = bridges
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    return known.includes(j.line) ? j.line : null;
  } catch {
    return null;
  }
}

function savePreferredBridge(userDataDir: string, line: string): void {
  if (!line.trim()) return;
  try {
    // The bridge line is a censored-network secret (address + fingerprint) and
    // is encrypted in settings.json; the remembered copy was 0644 plaintext.
    writeFileSync(preferredBridgePath(userDataDir), JSON.stringify({ line, at: Date.now() }), { mode: 0o600 });
  } catch {
    /* best-effort */
  }
}

function clearPreferredBridge(userDataDir: string): void {
  try {
    rmSync(preferredBridgePath(userDataDir), { force: true });
  } catch {
    /* ignore */
  }
}

async function runRotation(bridges: string, userDataDir: string): Promise<{ socks: string } | null> {
  // Single-flight: exit-driven restarts and watchdog rotations used to run
  // concurrently and kill each other's daemon mid-bootstrap.
  if (rotationInFlight) return await rotationInFlight;
  const run = rotate(bridges, userDataDir).finally(() => {
    rotationInFlight = null;
  });
  rotationInFlight = run;
  return await run;
}

async function rotate(bridges: string, userDataDir: string): Promise<{ socks: string } | null> {
  const binDir = torBinaryDir();
  if (!binDir) {
    logger.info('[tor-embedded] bundled tor not found (vendor/tor or resources/tor) — fallback to user Tor');
    return null;
  }
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = undefined;
  }
  const dataRoot = join(userDataDir, 'tor-data');
  mkdirSync(dataRoot, { recursive: true });
  lastStart = { bridges, dataDir: dataRoot };

  const remembered = loadPreferredBridge(userDataDir, bridges);
  if (remembered) {
    await stopProcessAndWait();
    if (stopping) return null;
    logger.info(`[tor-embedded] trying remembered bridge ${parseBridgeAddr(remembered)?.host}`);
    if (await attemptBridge(remembered, binDir, dataRoot)) {
      savePreferredBridge(userDataDir, remembered);
      startWatchdog(remembered, dataRoot);
      return { socks: `127.0.0.1:${EMBEDDED_SOCKS_PORT}` };
    }
    if (stopping) return null;
    logger.info('[tor-embedded] remembered bridge failed — full rotation');
    skippedBridges.add(remembered);
    clearPreferredBridge(userDataDir);
  }

  const ranked = await rankBridges(bridges);
  if (stopping) return null;
  if (ranked.length === 0) {
    logger.info('[tor-embedded] no reachable bridge — starting tor WITHOUT bridges (direct)');
    await stopProcessAndWait();
    if (stopping) return null;
    const direct = await attemptBridge('', binDir, dataRoot);
    if (direct) startWatchdog('', dataRoot);
    return direct;
  }
  const candidates = ranked.filter((l) => !skippedBridges.has(l));
  const tried = candidates.length > 0 ? candidates : ranked; // nothing left → start over
  logger.info(
    `[tor-embedded] bridge ranking: ${ranked.map((l) => parseBridgeAddr(l)?.host).join(' → ')}${skippedBridges.size ? ` (skipped: ${skippedBridges.size})` : ''}`,
  );
  for (const cand of tried) {
    if (stopping) return null;
    await stopProcessAndWait();
    if (stopping) return null;
    logger.info(`[tor-embedded] trying bridge ${parseBridgeAddr(cand)?.host}`);
    const r = await attemptBridge(cand, binDir, dataRoot);
    if (stopping) return null;
    if (r) {
      savePreferredBridge(userDataDir, cand);
      startWatchdog(cand, dataRoot);
      return r;
    }
    logger.info(`[tor-embedded] bridge ${parseBridgeAddr(cand)?.host} failed to bootstrap — blacklisting for this session`);
    skippedBridges.add(cand);
  }
  // Every bridge failed → allow the next invocation to try everything again
  // (kept as a session hint, but the list is re-ranked from scratch: a bridge
  // may have recovered between attempts).
  skippedBridges.clear();
  logger.info('[tor-embedded] all bridges exhausted; falling back to direct start');
  await stopProcessAndWait();
  if (stopping) return null;
  const direct = await attemptBridge('', binDir, dataRoot);
  if (direct) startWatchdog('', dataRoot);
  return direct;
}

function startWatchdog(bridgeLine: string, dataDir: string): void {
  clearInterval(watchdog!);
  watchdog = undefined;
  if (stopping) return;
  socksAliveStreak = 0;
  watchdog = setInterval(async () => {
    if (stopping || !proc || restarting) return;
    const alive = await socksAlive();
    const circuit = alive ? await controlCircuitEstablished(dataDir) : null;
    // A listening SOCKS port with `circuit-established=0` means the daemon is
    // up but cut off from the network (dead bridge/guard) — restart instead of
    // serving 60-second timeouts. Unknown control state falls back to the
    // listener check so platforms without the cookie file still work.
    const healthy = alive && circuit !== false;
    socksAliveStreak = healthy ? 0 : socksAliveStreak + 1;
    const limit = alive ? MAX_CONSECUTIVE_CIRCUIT_FAILURES : MAX_CONSECUTIVE_SOCKS_FAILURES;
    if (socksAliveStreak < limit) return;
    logger.info(
      `[tor-embedded] ${
        alive ? 'Tor cannot build circuits' : 'SOCKS listener dead'
      } via bridge ${parseBridgeAddr(bridgeLine)?.host ?? 'direct'} — rotating`,
    );
    restarting = true;
    stopProcess();
    clearInterval(watchdog!);
    const cfg = lastStart;
    if (!cfg) {
      restarting = false;
      scheduleRestart('no configuration for watchdog restart');
      return;
    }
    skippedBridges.add(bridgeLine);
    void runRotation(cfg.bridges, join(cfg.dataDir, '..'))
      .then((r) => {
        if (r) restartDelayMs = 5_000;
        else scheduleRestart('watchdog rotation produced no usable Tor');
      })
      .catch((e) => {
        logger.warn('[tor-embedded] watchdog restart failed', e);
        scheduleRestart('watchdog restart error');
      })
      .finally(() => {
        restarting = false;
      });
  }, WATCHDOG_INTERVAL_MS);
}

export async function startEmbeddedTor(bridges: string, userDataDir: string): Promise<{ socks: string } | null> {
  stopping = false;
  if (proc && !proc.killed) {
    // The daemon may still be bootstrapping: never hand out a dead address.
    if (activeSocks) return { socks: activeSocks };
    try {
      await whenEmbeddedTorReady();
    } catch {
      return null;
    }
    if (stopping) return null;
    return activeSocks ? { socks: activeSocks } : null;
  }
  return await runRotation(bridges, userDataDir);
}

export async function stopEmbeddedTor(): Promise<void> {
  stopping = true;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = undefined;
  }
  clearInterval(watchdog!);
  watchdog = undefined;
  // Wake an in-flight attemptBridge so its bridge loop aborts immediately
  // instead of spawning the next tor.exe after stopEmbeddedTor() returned.
  abortAttempt?.();
  // Wait for the process to really exit: the next start needs the SOCKS port
  // and the DataDirectory lock, and a dying tor still holds both.
  await stopProcessAndWait();
  // Also let an in-flight rotation observe `stopping` and clear the
  // single-flight guard — otherwise a start() issued right after this stop
  // returns the OLD rotation's result and the new bridge list is never used.
  if (rotationInFlight) {
    try {
      await rotationInFlight;
    } catch {
      /* the aborted rotation has nothing useful to report */
    }
  }
  skippedBridges.clear();
  // Unblock anything awaiting readiness: a stopped daemon will never boot.
  readyResolve?.();
}

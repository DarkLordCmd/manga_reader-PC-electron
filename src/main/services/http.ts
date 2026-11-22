import { Agent, type Dispatcher, ProxyAgent, buildConnector, fetch as undiciFetch } from 'undici';
import { connect as netConnect } from 'net';
import { isFrontingEnabled, supportsFronting, frontingIpFor, buildFrontingDispatcher, markUnavailable } from './domain-fronting';
import { isEhHost, notifyEhSetCookies } from './eh-session';
import {
  torFallbackActiveFor,
  markTorFallbackSuccess,
  markTorFallbackFailure,
  isTorFallbackBlocked,
  isEhTimeoutError,
} from './eh-sni-fallback';
import { resolveViaCustomDns, customDnsActive } from './custom-dns';
import { userAgentForUrl } from './user-agent';
import { logger } from './logger';
import { isEmbeddedTorProxy, torConnectTimeoutMs, torIsolationAuth, torIsolationGroup } from './tor-config';

/** Tor SOCKS address used for the automatic SNI-timeout fallback on EH hosts.
 * Injected from main (settings), empty string disables the fallback. */
let torFallbackAddr = '';
export function setTorFallbackAddr(addr: string): void {
  torFallbackAddr = addr;
}
function torFallbackAvailable(): boolean {
  return torFallbackAddr.trim() !== '';
}
import { parseLimitResponse } from './eh-limits';
import { handleLimitFailure, assertNotEhBlocked, retryOnce } from './eh-limits-hook';

export interface HttpFetchOptions {
  url: string;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  body?: string;
  timeoutMs?: number;
  redirect?: 'follow' | 'manual';
  /** When true, an empty body from the direct path triggers a domain-fronting retry. */
  frontOnEmpty?: boolean;
  /** When true, an HTTP >= 400 status on the direct path (e.g. a DNS-poisoned
   * block page or Cloudflare reject) is retried through the fallback chain
   * (custom-DNS pin, then Tor) instead of surfacing immediately. */
  allowHttpFallback?: boolean;
}

export interface HttpResult {
  status: number;
  text: string;
  setCookies: string[];
}

function normalizeSocksAddr(addr: string): string {
  return addr
    .trim()
    .replace(/^socks5h:\/\//, '')
    .replace(/^socks5:\/\//, '')
    .replace(/^socks4:\/\//, '');
}

/** Minimal SOCKS5 CONNECT with remote DNS (like `curl --socks5-hostname`). */
/** SOCKS5 CONNECT. With `auth`, the client performs RFC 1929 user/password
 * authentication; Tor uses that pair to isolate this stream's circuit from
 * streams with other credentials (IsolateSOCKSAuth), so EH listings, the image
 * CDN and everything else no longer queue behind one congested circuit. */
function socks5Connect(
  proxyHost: string,
  proxyPort: number,
  destHost: string,
  destPort: number,
  // A first connection through Tor (circuit build + exit connect) regularly
  // needs 10-25 s; the old 20 s cap aborted healthy first requests.
  timeoutMs = 30_000,
  auth?: { username: string; password: string },
): Promise<import('net').Socket> {
  return new Promise((resolve, reject) => {
    const socket = netConnect({ host: proxyHost, port: proxyPort });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`socks proxy timeout (${proxyHost}:${proxyPort})`));
    }, timeoutMs);
    socket.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    const fail = (msg: string): void => {
      clearTimeout(timer);
      socket.destroy();
      reject(new Error(msg));
    };
    socket.once('connect', () => {
      // Offer only the method we will use: Tor picks the first supported one,
      // and a no-auth greeting would silently lose the isolation.
      socket.write(Buffer.from(auth ? [0x05, 0x01, 0x02] : [0x05, 0x01, 0x00]));
    });

    const connectPacket = (): Buffer => {
      const host = Buffer.from(destHost, 'utf-8');
      if (host.length > 255) throw new Error('socks: hostname too long');
      const port = Buffer.alloc(2);
      port.writeUInt16BE(destPort);
      return Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, host.length]), host, port]);
    };

    type Stage = 'greeting' | 'auth' | 'connect';
    let stage: Stage = 'greeting';
    let buf = Buffer.alloc(0);
    const stageData = (chunk: Buffer): void => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (stage === 'greeting') {
          if (buf.length < 2) return;
          if (buf[0] !== 0x05) return fail('socks: bad version');
          const method = buf[1];
          if (method === 0x00 && !auth) {
            buf = buf.subarray(2);
            stage = 'connect';
            try {
              socket.write(connectPacket());
            } catch (e: any) {
              return fail(e?.message ?? 'socks: bad target');
            }
            continue;
          }
          if (method === 0x02 && auth) {
            buf = buf.subarray(2);
            const u = Buffer.from(auth.username, 'utf8');
            const p = Buffer.from(auth.password, 'utf8');
            if (u.length > 255 || p.length > 255) return fail('socks: auth too long');
            socket.write(Buffer.concat([Buffer.from([0x01, u.length]), u, Buffer.from([p.length]), p]));
            stage = 'auth';
            continue;
          }
          return fail(method === 0xff ? 'socks: no acceptable auth method' : 'socks: unexpected auth method');
        }
        if (stage === 'auth') {
          if (buf.length < 2) return;
          if (buf[0] !== 0x01 || buf[1] !== 0x00) return fail('socks: username/password rejected');
          buf = buf.subarray(2);
          stage = 'connect';
          try {
            socket.write(connectPacket());
          } catch (e: any) {
            return fail(e?.message ?? 'socks: bad target');
          }
          continue;
        }
        // Reply: VER REP RSV ATYP [BND.ADDR] BND.PORT.
        if (buf.length < 4) return;
        if (buf[0] !== 0x05 || buf[1] !== 0x00) return fail(`socks: connect failed (rep=${buf[1]})`);
        const atyp = buf[3];
        if (atyp === 0x03) {
          if (buf.length < 5) return; // length byte not here yet
          if (buf.length < 5 + buf[4] + 2) return;
        } else if (atyp === 0x01) {
          if (buf.length < 4 + 4 + 2) return;
        } else if (atyp === 0x04) {
          if (buf.length < 4 + 16 + 2) return;
        } else {
          return fail(`socks: bad address type ${atyp}`);
        }
        clearTimeout(timer);
        // Detach the handshake watcher: it would misinterpret the tunnelling
        // HTTP traffic as SOCKS frames and destroy the socket mid-request.
        socket.off('data', stageData);
        resolve(socket);
        return;
      }
    };
    socket.on('data', stageData);
  });
}

/** One Agent per proxy address: a fresh undici Agent used to be built for every
 * request (and every page-image attempt), each with its own connector, pool and
 * keep-alive timers that were never closed. Reusing them keeps the connection
 * count flat during long reading sessions. */
const socksDispatchers = new Map<string, Agent>();
const MAX_DISPATCHERS = 8;

/* ---- Tor circuit health -------------------------------------------------- */

type TorCircuitResetFn = () => Promise<unknown>;
let torCircuitReset: TorCircuitResetFn | null = null;
/** Injected from main (tor-embedded) to avoid a tor-embedded → tor-check → http
 * import cycle. */
export function setTorCircuitReset(fn: TorCircuitResetFn | null): void {
  torCircuitReset = fn;
}

let lastCircuitResetAt = 0;
let circuitResetPromise: Promise<unknown> | null = null;
/** One NEWNYM per 20 s, shared by all failing connections, so a burst of bad
 * streams cannot flood Tor with control signals (it rate-limits them anyway). */
function resetTorCircuitOnce(): Promise<unknown> {
  if (!torCircuitReset) return Promise.resolve();
  if (Date.now() - lastCircuitResetAt < 20_000) return circuitResetPromise ?? Promise.resolve();
  if (!circuitResetPromise) {
    circuitResetPromise = (async () => {
      try {
        await torCircuitReset?.();
      } catch {
        /* best-effort */
      } finally {
        lastCircuitResetAt = Date.now();
        circuitResetPromise = null;
      }
    })();
  }
  return circuitResetPromise;
}

const torConnectFailures = new Map<string, number[]>();
/** True when the same proxy produced ≥2 SOCKS-connect failures in 20 s. */
function noteTorConnectFailure(proxyKey: string): boolean {
  const now = Date.now();
  const recent = (torConnectFailures.get(proxyKey) ?? []).filter((t) => now - t < 20_000);
  recent.push(now);
  torConnectFailures.set(proxyKey, recent);
  return recent.length >= 2;
}

/** Best-effort circuit warm-up after Tor boot / NEWNYM: a SOCKS CONNECT makes
 * Tor build the circuit now instead of on the user's first click. The socket is
 * closed immediately; no HTTP request is made. */
export function warmTorCircuits(proxy: string | undefined, hosts: string[]): void {
  const addr = (proxy ?? '').trim();
  if (!addr || hosts.length === 0) return;
  const hostPort = addr.replace(/^socks5h?:\/\//i, '').split('/')[0] ?? '';
  const [h, p] = hostPort.split(':');
  const port = Number(p || 9150);
  if (!h || !Number.isFinite(port)) return;
  const isolated = isEmbeddedTorProxy(addr);
  for (const target of hosts) {
    const auth = isolated ? torIsolationAuth(target) : undefined;
    void (async () => {
      const sock = await socks5Connect(h, port, target, 443, 12_000, auth);
      sock.destroy();
    })().catch(() => {
      /* warm-up is best-effort */
    });
  }
}

/** Connection-pool settings for the Tor path. undici's default keepAliveTimeout
 * is 4 s: after a short pause between pages the tunnel was closed and the next
 * request paid a fresh SOCKS CONNECT + exit-connect + TLS handshake (0.3-1 s,
 * and often a new circuit). Tor streams are cheap to keep open, so hold them
 * for a minute and cap the pool so a burst of covers cannot flood one circuit. */
const TOR_POOL: {
  keepAliveTimeout: number;
  keepAliveMaxTimeout: number;
  keepAliveTimeoutThreshold: number;
  connections: number;
} = {
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 10 * 60_000,
  keepAliveTimeoutThreshold: 5_000,
  connections: 8,
};

function buildSocksDispatcher(proxy: string): Agent {
  const key = normalizeSocksAddr(proxy);
  const cached = socksDispatchers.get(key);
  if (cached) return cached;
  const [proxyHost, proxyPort] = key.split(':');
  const port = Number(proxyPort || 9150);
  const connector = buildConnector({ timeout: 30_000 });
  const agent = new Agent({
    ...TOR_POOL,
    connect: async (opts: any, callback) => {
      const destPort = Number(opts.port || (opts.protocol === 'https:' ? 443 : 80));
      const host = String(opts.hostname ?? '');
      // The bundled daemon accepts SOCKS credentials for stream isolation; a
      // user-provided SOCKS proxy may validate or reject them, so it stays
      // no-auth. Each traffic class gets its own username → its own circuit.
      const isolated = isEmbeddedTorProxy(key);
      const auth = isolated ? torIsolationAuth(host) : undefined;
      const timeout = isolated ? torConnectTimeoutMs(host) : 30_000;
      const open = (): Promise<import('net').Socket> =>
        socks5Connect(proxyHost || '127.0.0.1', port, host, destPort, timeout, auth);
      let socket: import('net').Socket;
      const startedAt = Date.now();
      try {
        socket = await open();
        const ms = Date.now() - startedAt;
        if (ms > 4_000) {
          logger.info(
            `[tor-connect] ${host} (${isolated ? torIsolationGroup(host) : 'direct-proxy'}) ${ms} ms`,
          );
        }
      } catch (err) {
        // Two dead SOCKS connects in a row usually mean a stuck circuit, not a
        // dead site: ask Tor for a new circuit once and retry (NEWNYM is
        // rate-limited, so resetTorCircuitOnce is shared and spaced).
        if (isolated && noteTorConnectFailure(key)) {
          await resetTorCircuitOnce();
          try {
            socket = await open();
          } catch (err2) {
            callback(err2 as Error, null);
            return;
          }
        } else {
          callback(err as Error, null);
          return;
        }
      }
      try {
        if (opts.protocol !== 'https:') {
          // Plain HTTP (e.g. Tor .onion mirrors): undici's TLS connector
          // asserts on httpSocket for non-TLS origins ("httpSocket can only
          // be sent on TLS update") — hand the raw tunnelled socket back.
          callback(null, socket);
          return;
        }
        connector({ ...opts, httpSocket: socket }, callback);
      } catch (err) {
        socket.destroy();
        callback(err as Error, null);
      }
    },
  });
  while (socksDispatchers.size >= MAX_DISPATCHERS) {
    const oldest = socksDispatchers.keys().next().value;
    if (oldest === undefined) break;
    const evicted = socksDispatchers.get(oldest);
    socksDispatchers.delete(oldest);
    void evicted?.close().catch(() => {});
  }
  socksDispatchers.set(key, agent);
  return agent;
}

/** HTTP(S)-CONNECT proxy support. The ExHentai "dedicated proxy" setting is
 * documented as a normal HTTP proxy ("http://127.0.0.1:8080"), but every proxy
 * address used to be treated as SOCKS5: host parsed as "http", port NaN. */
const httpProxyDispatchers = new Map<string, ProxyAgent>();

function proxyKind(addr: string): 'http' | 'socks' {
  return /^https?:\/\//i.test(addr.trim()) ? 'http' : 'socks';
}

function buildHttpProxyDispatcher(addr: string): ProxyAgent {
  const key = addr.trim();
  const cached = httpProxyDispatchers.get(key);
  if (cached) return cached;
  const uri = /^https?:\/\//i.test(key) ? key : `http://${key}`;
  const agent = new ProxyAgent({ uri });
  while (httpProxyDispatchers.size >= MAX_DISPATCHERS) {
    const oldest = httpProxyDispatchers.keys().next().value;
    if (oldest === undefined) break;
    const evicted = httpProxyDispatchers.get(oldest);
    httpProxyDispatchers.delete(oldest);
    void evicted?.close().catch(() => {});
  }
  httpProxyDispatchers.set(key, agent);
  return agent;
}

/** Dispatcher for a user-configured proxy, honouring its scheme. */
function proxyDispatcherFor(proxy: string): Dispatcher {
  return proxyKind(proxy) === 'http' ? buildHttpProxyDispatcher(proxy) : buildSocksDispatcher(proxy);
}

/** Public alias: consumers that fetch outside httpFetch (page images, viewer
 * HTML) must use the same scheme-aware dispatcher. */
export function buildProxyDispatcher(proxy: string): Dispatcher {
  return proxyDispatcherFor(proxy);
}

export function isHttpProxy(proxy: string): boolean {
  return proxyKind(proxy) === 'http';
}

interface Dispatchers {
  dispatcher?: Dispatcher;
  frontHost?: string;
  /** True when the request must go through our pinned undici dispatcher —
   * Chromium resolves DNS itself and would ignore it. */
  pinned: boolean;
}

function buildDispatcherFor(url: string, proxy?: string): Dispatchers {
  if (proxy && proxy.trim() !== '') {
    return { dispatcher: proxyDispatcherFor(proxy), pinned: false };
  }
  if (isFrontingEnabled()) {
    try {
      const host = new URL(url).hostname;
      if (supportsFronting(host)) {
        // No dispatcher here: performFetch tries the direct path first and
        // builds a fronting dispatcher with a FRESH IP only for the fallback.
        return { frontHost: host, pinned: false };
      }
    } catch {
      /* ignore */
    }
  }
  // Custom-DNS pinning is only applied on the fallback path (a direct/system
  // failure was already recorded for the host) — a preemptive pin would break
  // hosts the system DNS resolves fine.
  if (customDnsActive()) {
    const host = (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return '';
      }
    })();
    if (host && directFailedUntil.has(host) && Date.now() < directFailedUntil.get(host)!) {
      const ip = pinnedIpCache.get(host);
      if (ip) return { dispatcher: buildPinnedDispatcher(host, ip), pinned: true };
    }
  }
  return { pinned: false };
}

const pinnedIpCache = new Map<string, string>();
/** Host-keyed state maps are bounded: a long session probes many mirrors and
 * custom-DNS hosts, and these entries never expired on their own. */
function setBounded<K, V>(map: Map<K, V>, key: K, value: V, limit = 200): void {
  if (!map.has(key) && map.size >= limit) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

export function rememberDirectFailureFor(host: string): void {
  setBounded(directFailedUntil, host, Date.now() + 10 * 60_000);
}
const directFailedUntil = new Map<string, number>();

async function customDnsDispatcher(url: string): Promise<{ dispatcher?: Dispatcher; pinned: boolean }> {
  if (!customDnsActive()) return { pinned: false };
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  })();
  if (!host || !directFailedUntil.has(host)) return { pinned: false };
  try {
    const p = await resolveViaCustomDns(host);
    if (!p) return { pinned: false };
    setBounded(pinnedIpCache, host, p);
    return { dispatcher: buildPinnedDispatcher(host, p), pinned: true };
  } catch {
    return { pinned: false };
  }
}

/** One pinned Agent per host+IP, bounded like the SOCKS dispatchers: a fresh
 * Agent per request leaked a connection pool and keep-alive timers on every
 * custom-DNS-pinned fetch (the direct path is pinned for 10 minutes at a
 * time, so that was every request to a blocked host). */
const pinnedDispatchers = new Map<string, Agent>();

export function buildPinnedDispatcher(host: string, ip: string): Agent {
  const key = `${host}|${ip}`;
  const cached = pinnedDispatchers.get(key);
  if (cached) return cached;
  const tlsConnector = buildConnector({ timeout: 15_000 });
  const agent = new Agent({
    ...TOR_POOL,
    connect: async (opts: any, callback) => {
      try {
        const port = Number(opts?.port || (opts?.protocol === 'https:' ? 443 : 80));
        const socket = netConnect({ host: ip, port });
        await new Promise<void>((res, rej) => {
          socket.once('connect', () => res());
          socket.once('error', rej);
        });
        if (opts?.protocol === 'https:') {
          // TLS upgrade over the pinned TCP socket: SNI and cert validation
          // still use the real hostname, only the connection target is the
          // custom-DNS-resolved IP.
          tlsConnector({ ...opts, httpSocket: socket }, callback);
        } else {
          callback(null, socket);
        }
      } catch (err) {
        callback(err as Error, null);
      }
    },
  });
  while (pinnedDispatchers.size >= MAX_DISPATCHERS) {
    const oldest = pinnedDispatchers.keys().next().value;
    if (oldest === undefined) break;
    const evicted = pinnedDispatchers.get(oldest);
    pinnedDispatchers.delete(oldest);
    void evicted?.close().catch(() => {});
  }
  pinnedDispatchers.set(key, agent);
  return agent;
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

/**
 * When no explicit proxy / domain-fronting dispatcher is needed, run the
 * request through Chromium's network stack (`net.fetch`) instead of undici:
 * it has a browser-grade TLS fingerprint, honors the system proxy, HTTP/2,
 * and passes Cloudflare — exactly how JHenTai's native HTTP behaves. Falls
 * back to undici's `fetch` outside Electron (e.g. unit tests).
 */
async function defaultFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron');
    if (electron?.net?.fetch) return await electron.net.fetch(url, init);
  } catch {
    /* not inside Electron main */
  }
  return fetch(url, init);
}

function extractSetCookies(res: Response): string[] {
  try {
    const getSetCookie = (res.headers as any).getSetCookie;
    return typeof getSetCookie === 'function'
      ? (getSetCookie.call(res.headers) ?? [])
      : (res.headers.get('set-cookie') ?? '')
          .split(/,(?=\s*[^=\s]+=)/)
          .map((s) => s.trim())
          .filter(Boolean);
  } catch {
    return [];
  }
}

/** Electron sessions, one per SOCKS proxy address, for Chromium-grade fetches
 * through the proxy (browser TLS/HTTP2 fingerprint — what clears Cloudflare
 * where undici's Node-TLS handshake gets a 403). */
const proxySessions = new Map<string, Promise<any>>();
async function getElectronProxySession(addr: string): Promise<any | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron');
    if (!electron?.session?.fromPartition) return null;
    let pending = proxySessions.get(addr);
    if (!pending) {
      // persist:* keeps the Tor circuit pool per address across windows
      const ses = electron.session.fromPartition(`persist:http-proxy-${addr}`);
      const created = ses
        .setProxy({
          proxyRules: `socks5://${normalizeSocksAddr(addr)}`,
          proxyBypassRules: '',
        })
        .catch(() => {})
        .then(() => ses);
      proxySessions.set(addr, created);
      pending = created;
    }
    return await pending;
  } catch {
    return null;
  }
}

/** When inside Electron, run a proxied request through the Chromium network
 * stack (net.fetch + proxied session). Returns null when unavailable so
 * callers fall back to the undici SOCKS dispatcher. */
async function electronProxyFetch(url: string, init: any, addr: string): Promise<Response | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron');
    if (!electron?.net?.fetch) return null;
    const ses = await getElectronProxySession(addr);
    if (!ses) return null;
    return (await electron.net.fetch(url, { ...init, session: ses })) as unknown as Response;
  } catch {
    return null;
  }
}

function buildInit(opts: HttpFetchOptions): any {
  return {
    method: opts.method ?? 'GET',
    headers: normalizeHeaders({
      // Per-host on purpose: MangaDex's edge rejects a browser-shaped UA
      // outright (see services/user-agent.ts), everything else wants one.
      'User-Agent': userAgentForUrl(opts.url),
      ...(opts.headers ?? {}),
    }),
    body: opts.body,
    redirect: opts.redirect,
  };
}

function timeoutError(host: string, url: string): any {
  const e: any = new Error(
    `Соединение с ${host || url} прервано по таймауту — сайт недоступен ` +
      '(DNS/SNI-блокировка на уровне провайдера или сеть). ' +
      'Включи Tor для этого источника в настройках или используй доступный источник.',
  );
  e.ehSniTimeout = true;
  e.host = host;
  return e;
}

/** Response plus the handle that keeps the request's timeout armed. The timer
 * must stay alive until the BODY has been read: `fetch()` resolves as soon as
 * the headers arrive, so clearing it there left slow/trickling bodies with no
 * deadline at all (requests hung for minutes instead of failing). Callers must
 * call `dispose()` once the body is consumed. */
interface TimedResponse {
  res: Response;
  dispose: () => void;
}

async function fetchWithTimeout(
  url: string,
  init: any,
  ms: number,
  dispatcher?: Dispatcher,
  forceUndici = false,
): Promise<TimedResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
  };
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    /* ignore */
  }
  try {
    const full = { ...init, signal: controller.signal };
    let res: Response;
    // Even in the "force undici" (pinned custom-DNS) branch the dispatcher MUST
    // be passed: `fetch(url, full)` resolved the hostname through the system
    // resolver again, so the pinned IP from the custom/DoH resolver was ignored
    // (DNS leak + the very poisoning the pin exists to bypass).
    if (forceUndici && dispatcher) res = (await undiciFetch(url, { ...full, dispatcher } as any)) as unknown as Response;
    else if (forceUndici) res = await fetch(url, full);
    // NOTE: do NOT route proxied requests through Electron's net.fetch:
    // its network stack hangs to the full timeout on SOCKS proxies (no
    // SOCKS support there), leaving the working undici path starved by the
    // abort already triggered.
    else if (dispatcher) {
      // Always use npm undici's own fetch with a custom dispatcher: the
      // global (Node builtin) fetch's handler is not guaranteed to be
      // compatible across Node versions ("invalid onError method").
      res = (await undiciFetch(url, { ...full, dispatcher } as any)) as unknown as Response;
    } else res = await defaultFetch(url, full);
    return { res, dispose };
  } catch (e: any) {
    dispose();
    // Our own timeout surfaces as an abort. A hard timeout on BOTH the direct
    // and the fronting path is the signature of a TCP handshake succeeding but
    // the TLS ClientHello being dropped — classic ISP-side SNI blocking of
    // this domain. Surface a clear, actionable message instead of a bare
    // `AbortError`.
    if (e?.name === 'AbortError') throw timeoutError(host, url);
    // undici wraps every transport failure in a generic `TypeError: fetch
    // failed` and hides the real reason in `e.cause` (SOCKS handshake result,
    // ECONNREFUSED on the Tor port, DNS failure, …). Unwrap it so the user
    // sees an actionable message instead of a bare "fetch failed".
    const cause = e?.cause;
    const cmsg = String(cause?.message ?? cause ?? '');
    if (String(e?.message ?? '') === 'fetch failed' && cmsg) {
      const l = cmsg.toLowerCase();
      let msg: string;
      const addr = l.match(/\d{1,3}(?:\.\d{1,3}){3}:\d+/)?.[0] ?? '127.0.0.1:9150';
      if (l.includes('econnrefused') || l.includes('socks proxy timeout')) {
        msg = `Не удалось подключиться к Tor SOCKS (${addr}) — проверь, что Tor запущен и адрес совпадает с настройками.`;
      } else if (l.includes('socks:')) {
        msg = `Tor не смог соединиться с ${host || url} (${cmsg}) — зеркало может быть недоступно, проверь Tor-сеть или смени адрес зеркала в настройках.`;
      } else {
        msg = `Сетевая ошибка при запросе ${host || url}: ${cmsg}`;
      }
      const e2: any = new Error(msg);
      e2.isNetworkFailure = true;
      throw e2;
    }
    throw e;
  }
}

/** Reads a body while the request timeout is still armed, mapping an abort
 * during the read to the same actionable timeout error. */
async function readTimed<T>(host: string, url: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (e: any) {
    if (e?.name === 'AbortError') throw timeoutError(host, url);
    throw e;
  }
}

/**
 * Performs one request.
 * - Plain proxy (Tor): goes straight through the proxy dispatcher.
 * - Domain-fronting mode: tries the direct path first (fast when the domain
 *   resolves, which is the common case), and only falls back to fronting
 *   (undici → hardcoded IP) when the direct attempt fails. Failed fronting
 *   IPs are marked unavailable for a while.
 * - Otherwise: direct path only (Chromium net.fetch, undici outside Electron).
 */
async function performFetch(
  opts: HttpFetchOptions,
  dispatcher: Dispatcher | undefined,
  frontHost: string | undefined,
  pinned: boolean,
): Promise<{ res: Response; bodyText: string | null; dispose: () => void }> {
  const baseTimeout = opts.timeoutMs ?? 30_000;
  const init = buildInit(opts);
  // `redirect:'manual'` must stay on undici: Chromium returns an opaque
  // redirect response (status 0, no headers), so Set-Cookie would be lost.
  // Same when a custom-DNS pin is active: Chromium resolves DNS itself and
  // ignores our dispatcher.
  const forceUndici = opts.redirect === 'manual' || pinned;
  const frontOnEmpty = opts.frontOnEmpty === true;
  const noop = (): void => {
    /* body already consumed */
  };

  if (!frontHost) {
    const t = await fetchWithTimeout(opts.url, init, baseTimeout, dispatcher, forceUndici);
    return { res: t.res, bodyText: null, dispose: t.dispose };
  }

  const host = hostnameOf(opts.url);
  // Domain-fronting mode: DIRECT first (fast when the domain resolves, which
  // is the common case), fronting IP as the fallback. The direct attempt must
  // NOT use the fronting dispatcher — it used to, so the "direct" try and the
  // "fallback" try both hit the same IP (2x timeout, no direct path at all).
  let directEmpty: { res: Response; text: string } | null = null;
  if (!forceUndici) {
    try {
      const t = await fetchWithTimeout(opts.url, init, Math.min(baseTimeout, 12_000), undefined, false);
      if (!frontOnEmpty) return { res: t.res, bodyText: null, dispose: t.dispose };
      const text = await readTimed(host, opts.url, () => t.res.text());
      t.dispose();
      if (text.trim().length > 0) return { res: t.res, bodyText: text, dispose: noop };
      // Empty body (e.g. ExHentai sad panda / IP rate-limit) → try fronting.
      directEmpty = { res: t.res, text };
    } catch {
      /* direct failed, fall through to fronting */
    }
  }

  // A FRESH fronting IP for this attempt: the fallback used to reuse the IP
  // picked before the direct attempt, retrying the same dead address.
  const ip = frontingIpFor(frontHost);
  try {
    const t = await fetchWithTimeout(opts.url, init, 10_000, buildFrontingDispatcher(frontHost, ip), false);
    return { res: t.res, bodyText: null, dispose: t.dispose };
  } catch (e) {
    markUnavailable(frontHost, ip);
    if (directEmpty) {
      // Fronting unreachable — surface the direct (empty) result so the
      // caller reports the accurate sad-panda/rate-limit error instead of a
      // network timeout.
      return { res: directEmpty.res, bodyText: directEmpty.text, dispose: noop };
    }
    throw e;
  }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Hosts eligible for the automatic Tor fallback on network failures. */
function isEhSiteHost(host: string): boolean {
  return host.includes('exhentai') || host.includes('e-hentai.org');
}

/**
 * Network-level failures that are worth a Tor retry: our own timeout aborts
 * (tagged), and transport errors (net::ERR_*, node fetch failures, socket
 * resets, DNS failures). Deliberately NOT: structured business errors
 * (ehBlocked, layout-changed) and plain HTTP <status> errors.
 */
function isNetworkLevelError(e: unknown): boolean {
  if (isEhTimeoutError(e)) return true;
  const err = e as any;
  if (!err || typeof err !== 'object') return false;
  // explicit tag set by the fetch-failed unwrapping above
  if (err.isNetworkFailure === true) return true;
  if (err.code === 'layout-changed' || err.ehBlocked !== undefined) return false;
  const msg = String(err.message ?? '');
  if (msg.startsWith('HTTP ')) return false;
  const m = msg.toLowerCase();
  return [
    'net::err',
    'fetch failed',
    'und_err',
    'econnreset',
    'econnrefused',
    'enotfound',
    'socket hang up',
    'eai_again',
    'etimedout',
    'receiver error',
  ].some((s) => m.includes(s));
}

/**
 * Runs `run` once; on a network-level failure (DNS/SNI block or dead path)
 * with no explicit proxy, retries once through the fallback Tor SOCKS
 * dispatcher. Cooldown state (eh-sni-fallback) prevents repeated 20-30s
 * timeouts: after a success later requests go straight through Tor; after a
 * failure the fallback is parked for 10 minutes.
 */
async function withSniFallback<T>(
  url: string,
  requestProxy: string | undefined,
  run: (proxy: string | undefined) => Promise<T>,
): Promise<T> {
  const host = hostnameOf(url);
  let proxied = requestProxy;
  if (!proxied && torFallbackAvailable() && !host.includes('.onion') && torFallbackActiveFor(host)) {
    proxied = torFallbackAddr;
  }
  try {
    return await run(proxied);
  } catch (e) {
    const retryable = isNetworkLevelError(e) || (e as any)?.allowHttpFallback === true;
    const canFallback =
      !proxied &&
      torFallbackAvailable() &&
      !isTorFallbackBlocked(host) &&
      retryable &&
      (isEhSiteHost(host) || !['', 'localhost', '127.0.0.1'].includes(host));
    if (!canFallback) throw e;
    // 1st: custom-DNS pin (fixes DNS-poisoning), 2nd: Tor (fixes everything else).
    if (customDnsActive()) {
      rememberDirectFailureFor(host);
      try {
        const r = await run(proxied); // buildDispatcherFor consults pin cache now
        pinnedOkFor(host);
        return r;
      } catch {
        /* pin failed, fall through to tor */
      }
    }
    try {
      const r = await run(torFallbackAddr);
      markTorFallbackSuccess(host);
      return r;
    } catch {
      markTorFallbackFailure(host);
      throw e;
    }
  }
}

function pinnedOkFor(host: string): void {
  // Successful pin - keep routing pinned for the TTL (10 min), so the dead
  // system path isn't retried every request.
  setBounded(directFailedUntil, host, Date.now() + 10 * 60_000);
}

export async function httpFetch(opts: HttpFetchOptions, proxy?: string): Promise<HttpResult> {
  return retryOnce(async () => {
    return await withSniFallback(opts.url, proxy, async (p) => {
      assertNotEhBlocked(opts.url);
      await customDnsDispatcher(opts.url);
      const { dispatcher, frontHost, pinned } = buildDispatcherFor(opts.url, p);
      const { res, bodyText, dispose } = await performFetch(opts, dispatcher, frontHost, pinned);
      try {
        const setCookies = extractSetCookies(res);
        if (setCookies.length > 0) {
          try {
            const host = new URL(opts.url).hostname;
            if (isEhHost(host)) notifyEhSetCookies(host, setCookies);
          } catch {
            /* ignore */
          }
        }
        const hostLower = hostnameOf(opts.url);
        // Body is read exactly once here; the timer stays armed until it is
        // fully consumed (a stalled body must not hang the request forever).
        const text = bodyText ?? (await readTimed(hostLower, opts.url, () => res.text()));
        if (isEhHost(hostLower) || hostLower.includes('exhentai') || hostLower.includes('e-hentai.org')) {
          const lim = parseLimitResponse(text.slice(0, 4000));
          if (lim.kind) throw handleLimitFailure(lim.kind, lim.resetAfterSec, opts.url);
        }
        // Opt-in HTTP fallback (nhentai et al.): a 4xx/5xx on the direct path
        // may mean a DNS-poisoned block page or a Cloudflare reject — let
        // withSniFallback retry via custom-DNS pin, then Tor.
        if (opts.allowHttpFallback === true && res.status >= 400) {
          const e: any = new Error(`HTTP ${res.status} for ${opts.url}`);
          e.allowHttpFallback = true;
          throw e;
        }
        return { status: res.status, text, setCookies };
      } finally {
        dispose();
      }
    });
  });
}

export async function httpGetText(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 20_000,
  proxy?: string,
): Promise<{ status: number; text: string }> {
  return httpFetch({ url, headers, timeoutMs }, proxy);
}

export async function httpFetchBinary(
  url: string,
  headers: Record<string, string> = {},
  proxy?: string,
  timeoutMs = 30_000,
  allowHttpFallback = false,
): Promise<Uint8Array> {
  return await withSniFallback(url, proxy, async (p) => {
    assertNotEhBlocked(url);
    await customDnsDispatcher(url);
    const { dispatcher, frontHost, pinned } = buildDispatcherFor(url, p);
    const { res, dispose } = await performFetch({ url, headers, timeoutMs, method: 'GET', allowHttpFallback }, dispatcher, frontHost, pinned);
    try {
      if (!res.ok) {
        // Release the tunnel: undici only recycles a connection once the body
        // is consumed or cancelled, otherwise the Tor stream sat idle until the
        // 300 s body timeout and the next request opened a new one.
        void res.body?.cancel().catch(() => {});
        const e: any = new Error(`HTTP ${res.status} for ${url}`);
        if (allowHttpFallback) e.allowHttpFallback = true;
        throw e;
      }
      // Body is read while the timeout is still armed; limit pages arrive as text/html instead of an image.
      const hostLower = hostnameOf(url);
      const buf = Buffer.from(await readTimed(hostLower, url, () => res.arrayBuffer()));
      const ct = res.headers.get('content-type') ?? '';
      if ((isEhHost(hostLower) || hostLower.includes('exhentai') || hostLower.includes('e-hentai.org')) && ct.includes('text/html')) {
        const lim = parseLimitResponse(buf.slice(0, 4000).toString('utf-8'));
        if (lim.kind) throw handleLimitFailure(lim.kind, lim.resetAfterSec, url);
      }
      return new Uint8Array(buf);
    } finally {
      dispose();
    }
  });
}

export async function httpGetJson(url: string, headers: Record<string, string> = {}, proxy?: string, timeoutMs = 20_000): Promise<unknown> {
  const r = await httpFetch(
    {
      url,
      headers: { Accept: 'application/json', ...headers },
      timeoutMs,
    },
    proxy,
  );
  if (r.status !== 200) throw new Error(`HTTP ${r.status} for ${url}`);
  return JSON.parse(r.text);
}

export async function httpPostJson(
  url: string,
  body: string,
  headers: Record<string, string> = {},
  proxy?: string,
  timeoutMs = 20_000,
): Promise<unknown> {
  const r = await httpFetch(
    {
      url,
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      timeoutMs,
    },
    proxy,
  );
  if (r.status >= 300) throw new Error(`HTTP ${r.status} for ${url}`);
  return JSON.parse(r.text);
}

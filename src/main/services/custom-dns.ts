import { Resolver } from 'dns';
import { connect as netConnect } from 'net';
import { Agent, buildConnector, fetch as undiciFetch } from 'undici';

/** Known blocker-circumvention DNS servers (user-provided, plain UDP). */
export const KNOWN_DNS_SERVERS: { name: string; server: string }[] = [
  { name: 'ComssDNS', server: '83.220.169.155' },
  { name: 'XboxDNS', server: '111.88.96.50' },
  { name: 'XboxDNS v2', server: '87.228.47.200' },
  { name: 'XboxDNS old', server: '176.99.11.77' },
  { name: 'MalwDNS', server: '84.21.189.133' },
];

/** DoH presets the UI can paste in one click. JSON DoH must work over GET. */
export const KNOWN_DOH_SERVERS: { name: string; server: string }[] = [
  { name: 'Comss DoH', server: 'https://dns.comss.ru/dns-query' },
  { name: 'Cloudflare DoH', server: 'https://cloudflare-dns.com/dns-query' },
  { name: 'Google DoH', server: 'https://dns.google/resolve' },
];

/**
 * Bootstrap IPs for DoH providers: resolving the DoH server's own hostname
 * through the (possibly poisoned) system DNS defeats the purpose, so we
 * connect straight to a pinned IP while validating TLS against the hostname.
 */
export const DOH_BOOTSTRAP_IPS: Record<string, string> = {
  'dns.comss.ru': '83.220.169.155',
  'dns.comss.online': '83.220.169.155',
  'cloudflare-dns.com': '1.1.1.1',
  'one.one.one.one': '1.1.1.1',
  'dns.google': '8.8.8.8',
  'dns.quad9.net': '9.9.9.9',
};

export const AIR_DNS_TEST_HOST = 'ya.ru';

function isDohServer(server: string): boolean {
  return server.startsWith('https://');
}

export function parseDnsServerList(raw: string): string[] {
  const oct = '(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)';
  const re = new RegExp(`^${oct}(\\.${oct}){3}$`);
  const dohRe = /^https:\/\/[A-Za-z0-9.-]+(?:\/[^\s,;]*)?$/;
  return [
    ...new Set(
      (raw ?? '')
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter((s) => re.test(s) || dohRe.test(s)),
    ),
  ];
}

interface CacheEntry {
  ips: string[];
  expiresAt: number;
  failUntil: number;
}

const TTL_MS = 10 * 60_000;
const FAIL_MS = 2 * 60_000;
const cache = new Map<string, CacheEntry>();

let servers: string[] = [];
let resolverCounter = 0;

export function setCustomDnsServers(list: string[]): void {
  servers = list;
  cache.clear();
}

export function customDnsActive(): boolean {
  return servers.length > 0;
}

export function customDnsServers(): string[] {
  return [...servers];
}

/**
 * JSON-over-HTTPS DNS query (DoH) with GET `?name=&type=A`. When the DoH
 * host has a known pinned IP, TCP is made to the bootstrap IP and TLS is
 * upgraded over that socket with the real hostname as SNI (so the resolved
 * IP can't be poisoned and the cert still validates).
 */
function pinnedBootstrapAgent(ip: string): Agent {
  const tlsConnector = buildConnector({ timeout: 8000 });
  return new Agent({
    connect: async (opts: any, callback) => {
      try {
        const port = Number(opts?.port || (opts?.protocol === 'https:' ? 443 : 80));
        const socket = netConnect({ host: ip, port });
        await new Promise<void>((res, rej) => {
          socket.once('connect', () => res());
          socket.once('error', rej);
        });
        if (opts?.protocol === 'https:') {
          tlsConnector({ ...opts, httpSocket: socket }, callback);
        } else {
          callback(null, socket);
        }
      } catch (err) {
        callback(err as Error, null);
      }
    },
  });
}

async function dohResolve(server: string, host: string): Promise<string[]> {
  const u = new URL(server);
  let dispatcher: Agent | undefined;
  if (isDohServer(server)) {
    const boot = DOH_BOOTSTRAP_IPS[u.hostname.toLowerCase()];
    if (boot) dispatcher = pinnedBootstrapAgent(boot);
  }
  const query = new URL(server);
  query.searchParams.set('name', host);
  query.searchParams.set('type', 'A');
  const res = await undiciFetch(query.toString(), {
    dispatcher,
    signal: AbortSignal.timeout(4000),
    headers: { accept: 'application/dns-json' },
  });
  if (!res.ok) throw new Error(`DoH HTTP ${res.status}`);
  const j = (await res.json()) as Record<string, any>;
  const answers: any[] = Array.isArray(j?.Answer) ? j.Answer : [];
  return answers.filter((a) => a?.type === 1 && typeof a?.data === 'string' && /^\d+(\.\d+){3}$/.test(a.data)).map((a) => String(a.data));
}

async function queryServer(server: string, host: string): Promise<string[]> {
  if (isDohServer(server)) return dohResolve(server, host);
  const resolver = new Resolver({ timeout: 4000, tries: 2 });
  resolver.setServers([server]);
  return await new Promise<string[]>((resolve, reject) => {
    resolver.resolve4(host, (err, addrs) => {
      if (err) reject(err);
      else resolve(addrs ?? []);
    });
  });
}

/**
 * Resolves `host` through the configured custom DNS/DoH servers, bypassing
 * the ISP's poisoned resolver. DoH (https:// URLs) is tried first; plain UDP
 * servers serve as further fallbacks within a single resolution attempt.
 * Returns a rotating IP or null when the bypass path isn't usable.
 */
export async function resolveViaCustomDns(host: string): Promise<string | null> {
  if (servers.length === 0 || !host || host.includes('.onion')) return null;
  if (host === 'localhost' || host === '127.0.0.1') return null;
  let entry = cache.get(host);
  const now = Date.now();
  if (entry && now < entry.failUntil) return null;
  if (!entry || now >= entry.expiresAt) {
    // Round-robin the starting point, then try the remaining servers too so
    // one flaky resolver doesn't park the host in the fail state.
    const start = resolverCounter++ % servers.length;
    const candidates = [...servers.slice(start), ...servers.slice(0, start)];
    let ips: string[] = [];
    for (const server of candidates) {
      try {
        ips = await queryServer(server, host);
      } catch {
        ips = [];
      }
      if (ips.length > 0) break;
    }
    if (ips.length === 0) {
      entry = { ips: [], expiresAt: now + TTL_MS, failUntil: now + FAIL_MS };
      cache.set(host, entry);
      return null;
    }
    entry = { ips, expiresAt: now + TTL_MS, failUntil: 0 };
    cache.set(host, entry);
  }
  const list = entry.ips;
  if (list.length === 0) return null;
  const idx = Math.floor(Date.now() / 1000) % list.length;
  return list[idx];
}

/**
 * Pure JSON health check for the DNS checks IPC: annotates each server with
 * whether it answered correctly for a test host. Supports DoH servers too.
 */
export async function checkCustomDns(host: string): Promise<{ server: string; ok: boolean; ip: string | null; ms: number }[]> {
  const out: { server: string; ok: boolean; ip: string | null; ms: number }[] = [];
  for (const server of servers) {
    const start = Date.now();
    try {
      const ips = await queryServer(server, host);
      const ip = ips[0] ?? null;
      out.push({ server, ok: ip !== null, ip, ms: Date.now() - start });
    } catch {
      out.push({ server, ok: false, ip: null, ms: Date.now() - start });
    }
  }
  return out;
}

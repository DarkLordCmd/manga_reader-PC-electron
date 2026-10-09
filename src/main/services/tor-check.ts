import { connect } from 'net';
import { httpFetch } from './http';

export interface TorStatus {
  state: 'unknown' | 'checking' | 'connected' | 'disconnected';
  latencyMs?: number;
  reason?: string;
}

export interface BridgeStatus {
  line: string;
  state: 'reachable' | 'unreachable' | 'unparsable';
  latencyMs?: number;
  reason?: string;
}

export interface SiteStatus {
  key: string;
  state: 'unknown' | 'checking' | 'up' | 'down';
  reason?: string;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const TOR_UA = 'Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0';

const SITES: { key: string; url: string; onion: boolean }[] = [
  { key: 'mangadex', url: 'https://api.mangadex.org/ping', onion: false },
  { key: 'exhentai_normal', url: 'https://exhentai.org', onion: false },
  { key: 'exhentai_onion', url: 'http://exhentai55ld2wyap5juskbm67czulomrouspdacjamjeloj7ugjbsad.onion', onion: true },
  { key: 'ehentai', url: 'https://e-hentai.org', onion: false },
  { key: 'nhentai', url: 'https://nhentai.net', onion: false },
  { key: 'nhentai_onion', url: 'http://nhentaithbeuysdaiiqf6nkxey6qzlbtb5wlwheq22abjfehlzghtgid.onion', onion: true },
  { key: 'comx', url: 'https://com-x.life', onion: false },
  { key: 'senkuro', url: 'https://senkuro.me', onion: false },
  { key: 'mangashi', url: 'https://manga-shi.org', onion: false },
  { key: 'remanga', url: 'https://remanga.org', onion: false },
  { key: 'mangalib', url: 'https://mangalib.me', onion: false },
];

export function probeSocks5Handshake(addr: string): Promise<TorStatus> {
  return new Promise((resolve) => {
    const started = Date.now();
    let host = addr.trim();
    let port = 9150;
    if (host.includes(':')) {
      const idx = host.lastIndexOf(':');
      const p = Number(host.slice(idx + 1));
      if (!isNaN(p) && p > 0) {
        port = p;
        host = host.slice(0, idx);
      }
    }
    host = host.replace(/^socks5h?:\/\//, '').replace(/^\[|\]$/g, '');

    const sock = connect({ host, port });
    sock.setTimeout(6000);
    sock.once('error', (err) => {
      sock.destroy();
      resolve({ state: 'disconnected', reason: err.message });
    });
    sock.once('timeout', () => {
      sock.destroy();
      resolve({ state: 'disconnected', reason: 'нет ответа на SOCKS5-приветствие (порт открыт, но это не Tor?)' });
    });
    let replied = false;
    sock.once('connect', () => {
      // SOCKS5 greeting: version 5, 1 auth method offered, method 0x00 (no auth)
      sock.write(Buffer.from([0x05, 0x01, 0x00]));
    });
    sock.once('data', (buf: Buffer) => {
      if (replied) return;
      replied = true;
      sock.destroy();
      const reply = buf;
      if (reply[0] !== 0x05) {
        resolve({ state: 'disconnected', reason: `ответ не похож на SOCKS5 (получено 0x${reply[0]?.toString(16)}, ожидалось 0x05)` });
      } else if (reply[1] === 0xff) {
        resolve({ state: 'disconnected', reason: 'SOCKS5-сервер отклонил все предложенные методы авторизации' });
      } else {
        resolve({ state: 'connected', latencyMs: Date.now() - started });
      }
    });
  });
}

export function parseBridgeAddr(line: string): { host: string; port: number } | null {
  const tokens = line.trim().split(/\s+/);
  for (const t of tokens) {
    const cleaned = t.replace(/^\[|\]$/g, '');
    if (cleaned.includes(':')) {
      const idx = cleaned.lastIndexOf(':');
      const host = cleaned.slice(0, idx);
      const port = Number(cleaned.slice(idx + 1));
      if (host && !isNaN(port) && port > 0) return { host, port };
    }
  }
  return null;
}

export function probeBridgeLine(line: string): Promise<BridgeStatus> {
  return new Promise((resolve) => {
    const addr = parseBridgeAddr(line);
    if (!addr) {
      resolve({ line, state: 'unparsable' });
      return;
    }
    const started = Date.now();
    const sock = connect({ host: addr.host, port: addr.port });
    sock.setTimeout(6000);
    sock.once('error', (err) => {
      sock.destroy();
      resolve({ line, state: 'unreachable', reason: err.message });
    });
    sock.once('timeout', () => {
      sock.destroy();
      resolve({ line, state: 'unreachable', reason: 'timeout' });
    });
    sock.once('connect', () => {
      sock.destroy();
      resolve({ line, state: 'reachable', latencyMs: Date.now() - started });
    });
  });
}

export async function probeSite(key: string, torAddr: string, torProxiedSites: string[]): Promise<SiteStatus> {
  const site = SITES.find((s) => s.key === key);
  if (!site) return { key, state: 'down', reason: 'неизвестный сайт' };
  const useTor = site.onion || torProxiedSites.includes(key);
  try {
    const r = await httpFetch(
      {
        url: site.url,
        headers: { 'User-Agent': site.onion ? TOR_UA : UA },
        timeoutMs: 10_000,
      },
      useTor ? torAddr || '127.0.0.1:9150' : undefined,
    );
    // Any HTTP response (even 4xx) means the site is up
    return { key, state: 'up' };
  } catch (err: any) {
    return { key, state: 'down', reason: err?.message ?? String(err) };
  }
}

export function allSiteKeys(): string[] {
  return SITES.map((s) => s.key);
}
export function siteLabel(key: string): string {
  const labels: Record<string, string> = {
    mangadex: 'MangaDex',
    exhentai_normal: 'ExHentai (обычный)',
    exhentai_onion: 'ExHentai (onion)',
    ehentai: 'E-Hentai',
    nhentai: 'NHentai',
    nhentai_onion: 'NHentai (onion)',
    comx: 'Com-X',
    senkuro: 'Senkuro',
    mangashi: 'Manga-shi',
    remanga: 'Remanga',
    mangalib: 'Mangalib',
  };
  return labels[key] ?? key;
}

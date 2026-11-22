/** Ports and stream-isolation rules for the bundled Tor.
 *
 * Isolated module on purpose: both tor-embedded and http need the port numbers,
 * and importing them from each other would create a cycle (tor-embedded →
 * tor-check → http).
 */

export const EMBEDDED_SOCKS_PORT = 9153;
export const EMBEDDED_CONTROL_PORT = 9158;
export const EMBEDDED_SOCKS_ADDR = `127.0.0.1:${EMBEDDED_SOCKS_PORT}`;

export type TorIsolationGroup = 'eh-pages' | 'eh-images' | 'onion' | 'general';

/** One circuit per traffic class instead of one circuit for everything:
 * an image prefetch must not queue a catalog listing behind itself, and a
 * site that bans an exit should not take the image CDN down with it.
 * Tor isolates circuits by the SOCKS username/password pair when
 * IsolateSOCKSAuth is on (it is by default; launchTor also passes it). */
export function torIsolationGroup(host: string): TorIsolationGroup {
  const h = (host ?? '').toLowerCase().replace(/\.$/, '');
  if (!h) return 'general';
  if (h.endsWith('.onion')) return 'onion';
  if (h === 'ehgt.org' || h.endsWith('.ehgt.org') || h === 'hath.network' || h.endsWith('.hath.network')) {
    return 'eh-images';
  }
  if (h === 'exhentai.org' || h.endsWith('.exhentai.org') || h === 'e-hentai.org' || h.endsWith('.e-hentai.org')) {
    return 'eh-pages';
  }
  return 'general';
}

/** Stable credentials per class: the same pair reuses the same circuit. */
export function torIsolationAuth(host: string): { username: string; password: string } {
  return { username: `manga-${torIsolationGroup(host)}`, password: 'isolation-v1' };
}

/** Only the bundled daemon is known to accept arbitrary SOCKS credentials for
 * isolation. Sending them to a user-provided proxy could break authentication,
 * so those connections keep using no-auth. */
export function isEmbeddedTorProxy(proxy: string): boolean {
  const raw = (proxy ?? '').trim().toLowerCase();
  if (!raw) return false;
  const noScheme = raw.replace(/^socks5h?:\/\//, '');
  const hostPort = noScheme.split('/')[0];
  const [host, port] = hostPort.split(':');
  return (host === '127.0.0.1' || host === 'localhost') && port === String(EMBEDDED_SOCKS_PORT);
}

/** SOCKS-connect budget per class: a dead image host must not hold a cover
 * slot for the full 30 s used by first page loads. */
export function torConnectTimeoutMs(host: string): number {
  switch (torIsolationGroup(host)) {
    case 'eh-images':
      return 18_000;
    case 'general':
      return 22_000;
    default:
      return 30_000;
  }
}

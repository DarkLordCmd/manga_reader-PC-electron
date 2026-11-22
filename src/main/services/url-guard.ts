/**
 * Guard for URLs the main process is asked to fetch on behalf of the renderer.
 *
 * `manga://cover/<url>` is an open fetch: whatever URL the renderer puts in the
 * path is downloaded by the main process, which has full network access and
 * bypasses the renderer's CORS. With renderer compromise that is an SSRF
 * primitive against loopback/LAN services. Cover images never live on private
 * addresses, so those are refused; === .onion hosts stay allowed.
 */
function isPrivateIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const h = host.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  if (h === '::' || h === '::1') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true; // unique-local fc00::/7
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true; // link-local fe80::/10
  // IPv4-mapped: the URL parser normalises ::ffff:127.0.0.1 to ::ffff:7f00:1,
  // so both the dotted and the hex form must be understood.
  const dotted = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return isPrivateIpv4(dotted[1]);
  const hex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return isPrivateIpv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return false;
}

export function isSafeRemoteUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  // A trailing dot ("localhost." / "foo.local.") is the same host to the
  // resolver but was a different string to the old check.
  const host = u.hostname.toLowerCase().replace(/\.+$/, '');
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  // Numeric/obfuscated loopback spellings the URL parser keeps as-is.
  if (host === '0.0.0.0' || host === '[::]' || host === '::') return false;
  if (host.startsWith('[') || host.includes(':')) return !isPrivateIpv6(host);
  return !isPrivateIpv4(host);
}

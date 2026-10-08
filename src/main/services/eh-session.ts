const EH_HOSTS = new Set(['e-hentai.org', 'exhentai.org', 'api.e-hentai.org', 'forums.e-hentai.org', 'upld.e-hentai.org']);

let handler: ((host: string, setCookies: string[]) => void) | null = null;

export function setEhSetCookieHandler(fn: ((host: string, setCookies: string[]) => void) | null): void {
  handler = fn;
}

export function isEhHost(host: string): boolean {
  return EH_HOSTS.has(host);
}

export function notifyEhSetCookies(host: string, setCookies: string[]): void {
  if (handler && setCookies.length > 0) handler(host, setCookies);
}

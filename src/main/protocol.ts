import { app, protocol, net } from 'electron';
import { join, normalize, sep } from 'path';
import { detectImageMime } from './app/mime';
import { pathToFileURL } from 'url';
import { readZipEntry } from './services/zip-gallery';
import { requestPage, getGalleryPages } from './services/online-gallery';
import { parseMangaPageUrl } from './services/page-url';
import { logger } from './services/logger';
import { isSafeRemoteUrl } from './services/url-guard';
import { cspFor } from './security';
import type { Gallery } from './services/gallery';
import type { SettingsService } from './services/settings';

// Scheme privileges MUST be registered before the app 'ready' event fires:
// Electron throws ("should be called before app is ready") if this runs later.
// index.ts imports this module during main-process bootstrap, so the call below
// executes pre-ready — exactly like the previous inline call site did. Do NOT
// move it inside registerMangaProtocol(), which runs from app.whenReady().
protocol.registerSchemesAsPrivileged([
  { scheme: 'manga', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  // The UI is served from here instead of file://. A de-privileged file:// page
  // cannot load Vite's ESM assets (`crossorigin`), which forced the app to keep
  // the permissive GrantFileProtocolExtraPrivileges fuse on. With a dedicated
  // scheme the renderer gets a real, isolated origin and the fuse stays off.
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

const RENDERER_HOST = 'renderer';

/** Serves out/renderer over `app://renderer/…` (production builds only). */
export function registerAppProtocol(): void {
  const root = normalize(join(app.getAppPath(), 'out', 'renderer'));
  const csp = cspFor(false);
  protocol.handle('app', async (request) => {
    let rel: string;
    try {
      const u = new URL(request.url);
      if (u.hostname !== RENDERER_HOST) return new Response('Not found', { status: 404 });
      rel = decodeURIComponent(u.pathname);
    } catch {
      return new Response('Not found', { status: 404 });
    }
    if (rel === '' || rel === '/') rel = '/index.html';
    const target = normalize(join(root, rel));
    // Path traversal guard: the resolved file must stay inside out/renderer.
    if (target !== root && !target.startsWith(root + sep)) {
      logger.warn('[app-protocol] refused out-of-root path', rel);
      return new Response('Not found', { status: 404 });
    }
    try {
      const res = await net.fetch(pathToFileURL(target).toString());
      if (!target.endsWith('.html')) return res;
      // custom protocols bypass webRequest.onHeadersReceived, so the document
      // carries its own CSP header.
      const headers = new Headers(res.headers);
      headers.set('Content-Security-Policy', csp);
      return new Response(res.body, { status: res.status, headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

export function registerMangaProtocol(deps: {
  state: {
    galleries: Map<string, Gallery>;
    zipMeta: Map<string, { zipPath: string; entries: string[] }>;
    onlineHeaders: Map<string, Record<string, string>>;
    ZIP_TMP: string;
  };
  settings: SettingsService;
  getCover(url: string): Promise<Buffer>;
  whenEmbeddedTorReady(ms: number): Promise<unknown>;
  embeddedTorSocks(): string | null;
}): void {
  const { galleries, zipMeta, onlineHeaders, ZIP_TMP } = deps.state;

  protocol.handle('manga', async (request) => {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);

    if (url.hostname === 'cover') {
      const encoded = parts[0];
      if (!encoded) return new Response('Not found', { status: 404 });
      const target = decodeURIComponent(encoded);
      // The renderer decides this URL, so the main process must not become a
      // generic fetcher for loopback/LAN services.
      if (!isSafeRemoteUrl(target)) {
        logger.warn('[cover] refused non-public url', target.slice(0, 120));
        return new Response('Not found', { status: 404 });
      }
      try {
        const s = deps.settings.get();
        // Cold start: an .onion cover requested before the bundled Tor finished
        // bootstrapping would 404 and the <img> would never retry. Wait for the
        // daemon (bounded) so the very first cover load succeeds.
        if (target.includes('.onion') && s.builtin_tor && !deps.embeddedTorSocks()) {
          try {
            await deps.whenEmbeddedTorReady(60_000);
          } catch {
            /* fall through to the configured SOCKS */
          }
        }
        const buf = await deps.getCover(target);
        return new Response(Uint8Array.from(buf), { headers: { 'Content-Type': detectImageMime(buf) } });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    }

    // Renderer requests pages as `manga://page/<galleryId>/<index>`, so the
    // gallery id lives in the first path segment when hostname is "page".
    const parsed = parseMangaPageUrl(request.url);
    if (!parsed) return new Response('Not found', { status: 404 });
    const gid = parsed.gid;
    const index = parsed.index;

    const zip = zipMeta.get(gid);
    if (zip) {
      if (!Number.isInteger(index) || index < 0 || index >= zip.entries.length) {
        return new Response('Not found', { status: 404 });
      }
      let file: string;
      try {
        file = await readZipEntry(zip.zipPath, zip.entries[index], ZIP_TMP);
      } catch {
        return new Response('Not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(file).toString());
    }

    const local = galleries.get(gid);
    if (local) {
      if (!Number.isInteger(index) || index < 0 || index >= local.pages.length) {
        return new Response('Not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(local.pages[index]).toString());
    }

    const info = getGalleryPages(gid);
    if (!info) return new Response('Not found', { status: 404 });
    if (!Number.isInteger(index) || index < 0 || index >= info.pageCount) {
      return new Response('Not found', { status: 404 });
    }
    try {
      const buf = await requestPage(gid, index, onlineHeaders.get(gid) ?? {}, { thumb: !!parsed.thumb });
      if (!buf) {
        logger.warn('[page-serve] no buffer', gid.slice(0, 8), index);
        return new Response('Not found', { status: 404 });
      }
      logger.debug('[page-serve] ok', gid.slice(0, 8), index, buf.length, 'bytes');
      return new Response(Uint8Array.from(buf), { headers: { 'Content-Type': detectImageMime(buf) } });
    } catch (e: any) {
      logger.warn('[page-serve] failed', gid.slice(0, 8), index, '—', e?.message ?? e);
      return new Response('Not found', { status: 404 });
    }
  });
}

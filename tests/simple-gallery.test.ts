import { describe, it, expect } from 'vitest';
import { createServer, type Server } from 'http';
import { fetchSimpleGallery } from '../src/main/services/simple-gallery';

function serve(html: string): Promise<{ port: number; server: Server }> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(html);
    });
    server.listen(0, () => resolve({ port: (server.address() as any).port, server }));
  });
}

describe('fetchSimpleGallery', () => {
  it('extracts content img tags skipping logos', async () => {
    const { port, server } = await serve(`
      <html><head><title>Test Manga</title></head><body>
        <img src="/logo.png">
        <img src="https://cdn.example.com/1.jpg">
        <img data-src="https://cdn.example.com/2.webp">
      </body></html>`);
    const g = await fetchSimpleGallery(`http://127.0.0.1:${port}/chapter/1`);
    expect(g.title).toBe('Test Manga');
    expect(g.pageUrls).toEqual(['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.webp']);
    server.close();
  });

  it('parses nhentai embedded reader JSON: always official i.nhentai.net CDN', async () => {
    // The old behavior mirrored the page's media_url (zrocdn etc.) which
    // serves low-res images — the Rust app fixed this by always rewriting to
    // i.nhentai.net. The t-codes map: p→png, g→gif, else webp.
    const html = `
      <html><body>
      <script>
        var reader = new N.reader({
          media_url: 'https://zrocdn.xyz/',
          gallery: { "media_id": "2438351",
            "images": { "pages": [{"t":"j"},{"t":"p"},{"t":"w"}] } }
        });
      </script>
      </body></html>`;
    const { port, server } = await serve(html);
    const g = await fetchSimpleGallery(`http://127.0.0.1:${port}/g/2438351/1/`);
    expect(g.pageUrls).toEqual([
      'https://i.nhentai.net/galleries/2438351/1.webp',
      'https://i.nhentai.net/galleries/2438351/2.png',
      'https://i.nhentai.net/galleries/2438351/3.webp',
    ]);
    server.close();
  });

  it('parses the current JSON.parse-wrapped nhentai reader (paths in entries)', async () => {
    // 2024+ svelte reader: the blob is JSON.parse("…") with escaped quotes
    // and every page entry carries a full "path".
    const galleryJson = JSON.stringify({
      media_id: '4053261',
      pages: [
        { number: 1, path: 'galleries/4053261/1.webp', width: 1280 },
        { number: 2, path: 'galleries/4053261/2.webp', width: 1280 },
      ],
    }).replace(/"/g, '\\"');
    // Simulate: JSON.parse("...") inside the page source
    const html = `<html><head><title>Test NHentai</title></head><body>
      <script>JSON.parse("${galleryJson}")</script>
      <img src="https://t2.nhentai.net/galleries/4053261/thumb.webp"></body></html>`;
    const { port, server } = await serve(html);
    const g = await fetchSimpleGallery(`http://127.0.0.1:${port}/g/4053261/1/`);
    expect(g.pageUrls).toEqual(['https://i.nhentai.net/galleries/4053261/1.webp', 'https://i.nhentai.net/galleries/4053261/2.webp']);
    server.close();
  });

  it('throws a clear error when no pages found', async () => {
    const { port, server } = await serve('<html><body>nothing</body></html>');
    await expect(fetchSimpleGallery(`http://127.0.0.1:${port}/x`)).rejects.toThrow(/Не удалось найти изображения/);
    server.close();
  });
});

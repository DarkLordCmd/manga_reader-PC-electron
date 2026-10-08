import { describe, it, expect, vi } from 'vitest';
import { GoogleDrive } from '../src/main/services/google-drive';

const auth = { getAccessToken: async () => 'TOKEN' };

describe('GoogleDrive', () => {
  it('upload creates when no file exists', async () => {
    const calls: string[] = [];
    const f = vi.fn(async (url: any, init: any) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url)}`);
      if (String(url).includes('/drive/v3/files?') && (init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify({ files: [] }), { status: 200 });
      }
      if (String(url).includes('/upload/drive/v3/files')) {
        return new Response(JSON.stringify({ id: 'NEW' }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const d = new GoogleDrive(auth, f);
    await d.upload('{"x":1}');
    expect(calls.some((c) => c.includes('POST') && c.includes('/upload/drive/v3/files'))).toBe(true);
  });

  it('download returns media text or null when absent', async () => {
    const f = vi.fn(async (url: any, init: any) => {
      if (String(url).includes('/drive/v3/files?')) return new Response(JSON.stringify({ files: [{ id: 'F1' }] }), { status: 200 });
      if (String(url).includes('/drive/v3/files/F1') && (init?.method ?? 'GET') === 'GET')
        return new Response('{"format":"manga-reader-sync"}', { status: 200 });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const d = new GoogleDrive(auth, f);
    expect(await d.download()).toContain('manga-reader-sync');
  });

  it('retries once on 401', async () => {
    let uploadCalls = 0;
    const tokens: string[] = [];
    const auth2 = {
      getAccessToken: async (): Promise<string> => {
        const t = `TOKEN${tokens.length}`;
        tokens.push(t);
        return t;
      },
    };
    const f = vi.fn(async (url: any, init: any) => {
      const s = String(url);
      if (s.includes('/drive/v3/files?') && !s.includes('/upload/') && (init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify({ files: [] }), { status: 200 });
      }
      if (s.includes('/upload/drive/v3/files')) {
        uploadCalls++;
        if (uploadCalls === 1) return new Response('unauth', { status: 401 });
        return new Response(JSON.stringify({ id: 'X' }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const d = new GoogleDrive(auth2, f);
    await d.upload('x'); // must not throw
    expect(uploadCalls).toBe(2);
    expect(tokens.length).toBeGreaterThanOrEqual(2);
  });
});

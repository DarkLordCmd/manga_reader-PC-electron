import { beforeEach, describe, expect, it, vi } from 'vitest';

const httpFetch = vi.fn();
vi.mock('../src/main/services/http', () => ({ httpFetch: (...args: unknown[]) => httpFetch(...args) }));

const challengeHtml = `<html><body><script>
  var targetUrl = decodeURIComponent("https%3A%2F%2Fcom-x.life%2F");
  var token = "abc";
  function sendResult() {}
</script></body></html>`;
const listingHtml = '<html><body><a href="/manga/x">ok</a></body></html>';

async function freshGate(): Promise<typeof import('../src/main/services/comx-gate')> {
  vi.resetModules();
  return await import('../src/main/services/comx-gate');
}

describe('Com-X fetch failures', () => {
  beforeEach(() => {
    httpFetch.mockReset();
  });

  it('rejects an upstream 5xx instead of returning an empty catalogue', async () => {
    const gate = await freshGate();
    httpFetch.mockResolvedValue({ status: 503, text: 'upstream unavailable', setCookies: [] });

    await expect(gate.comxFetchText('https://com-x.life/comix-read/')).rejects.toThrow('HTTP 503');
  });

  it('rejects a 5xx received during root PoW recovery', async () => {
    const gate = await freshGate();
    httpFetch.mockImplementation(async ({ url }: { url: string }) =>
      url === 'https://com-x.life/'
        ? { status: 502, text: 'bad gateway', setCookies: [] }
        : { status: 404, text: '<html>not found</html>', setCookies: [] },
    );

    await expect(gate.comxFetchText('https://com-x.life/comix-read/')).rejects.toThrow('HTTP 502');
  });

  it('rejects a 200 challenge that remains unresolved after PoW validation', async () => {
    const gate = await freshGate();
    httpFetch.mockImplementation(async ({ method }: { method?: string }) => ({
      status: 200,
      text: method === 'POST' ? 'ok' : challengeHtml,
      setCookies: method === 'POST' ? ['comx_cleared=1; Path=/'] : [],
    }));

    await expect(gate.comxFetchText('https://com-x.life/comix-read/')).rejects.toThrow(/challenge.*unresolved/i);
  });

  it('warms up root PoW after a target 404 even when the jar contains only auth cookies', async () => {
    const gate = await freshGate();
    gate.setComxUserCookies('sid=auth-only');
    let targetCalls = 0;
    let rootCalls = 0;
    httpFetch.mockImplementation(async ({ url }: { url: string }) => {
      if (url.endsWith('/_v')) {
        return { status: 200, text: 'ok', setCookies: ['comx_cleared=1; Path=/'] };
      }
      if (url === 'https://com-x.life/') {
        rootCalls += 1;
        return rootCalls === 1 ? { status: 200, text: challengeHtml, setCookies: [] } : { status: 200, text: listingHtml, setCookies: [] };
      }
      targetCalls += 1;
      return targetCalls === 1
        ? { status: 404, text: '<html>not found</html>', setCookies: [] }
        : { status: 200, text: listingHtml, setCookies: [] };
    });

    await expect(gate.comxFetchText('https://com-x.life/comix-read/')).resolves.toBe(listingHtml);
    expect(targetCalls).toBe(2);
  });

  it('still returns a challenge-free 200 catalogue', async () => {
    const gate = await freshGate();
    httpFetch.mockResolvedValue({ status: 200, text: listingHtml, setCookies: [] });

    await expect(gate.comxFetchText('https://com-x.life/comix-read/')).resolves.toBe(listingHtml);
  });
});

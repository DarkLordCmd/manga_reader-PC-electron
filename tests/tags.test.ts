import { describe, it, expect } from 'vitest';
import { createServer } from 'http';
import { fetchEhTagSuggest, fetchNhentaiTagSuggestions } from '../src/main/services/tags';

function serve(fn: (req: any, res: any) => void): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = createServer(fn);
    server.listen(0, () => resolve({ port: (server.address() as any).port, close: () => server.close() }));
  });
}

describe('fetchEhTagSuggest', () => {
  it('returns [] for short input', async () => {
    expect(await fetchEhTagSuggest('a')).toEqual([]);
  });
});

describe('fetchNhentaiTagSuggestions', () => {
  it('returns [] for empty input', async () => {
    expect(await fetchNhentaiTagSuggestions('')).toEqual([]);
  });
});

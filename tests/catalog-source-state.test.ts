import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CATALOG_SOURCE,
  isQuickSearchVisible,
  resolveCatalogSource,
  visibleCatalogSources,
  visibleQuickSearchesFor,
} from '../src/renderer/src/screens/catalog/catalog-state';
import { R34_SOURCES, SOURCES } from '../src/renderer/src/screens/catalog/constants';
import type { QuickSearch } from '../src/shared/quick-search';

const quickSearch = (id: string, source: string): QuickSearch => ({ id, name: id, source, query: 'x' });

describe('catalog source state', () => {
  it('falls back to Com-X for a removed saved source even when R34 is enabled', () => {
    expect(resolveCatalogSource('mangadex', true)).toBe(DEFAULT_CATALOG_SOURCE);
    expect(resolveCatalogSource('mangamello', true)).toBe(DEFAULT_CATALOG_SOURCE);
    expect(resolveCatalogSource('unknown-source', true)).toBe(DEFAULT_CATALOG_SOURCE);
  });

  it('falls back to Com-X for hidden or missing saved sources when R34 is disabled', () => {
    expect(resolveCatalogSource('hentailib', false)).toBe(DEFAULT_CATALOG_SOURCE);
    expect(resolveCatalogSource('exhentai', false)).toBe(DEFAULT_CATALOG_SOURCE);
    expect(resolveCatalogSource(null, false)).toBe(DEFAULT_CATALOG_SOURCE);
    expect(resolveCatalogSource('', false)).toBe(DEFAULT_CATALOG_SOURCE);
  });

  it('keeps known visible sources', () => {
    expect(resolveCatalogSource('comx', false)).toBe('comx');
    expect(resolveCatalogSource('mangalib', false)).toBe('mangalib');
    expect(resolveCatalogSource('hentailib', true)).toBe('hentailib');
  });

  it('never exposes removed or hidden sources in the controlled picker', () => {
    const safe = visibleCatalogSources(false).map((source) => source.key);
    expect(safe).toContain('comx');
    expect(safe).toContain('mangalib');
    expect(safe).not.toContain('hentailib');
    expect(safe).not.toContain('mangadex');
    expect(safe).not.toContain('mangamello');
    for (const source of R34_SOURCES) expect(safe).not.toContain(source);

    const all = visibleCatalogSources(true).map((source) => source.key);
    expect(all).toEqual(SOURCES.map((source) => source.key));
    expect(all).toContain('hentailib');
    expect(all).not.toContain('mangadex');
    expect(all).not.toContain('mangamello');
  });
});

describe('quick search source gating', () => {
  const searches = [
    quickSearch('comx', 'comx'),
    quickSearch('mangalib', 'mangalib'),
    quickSearch('r34', 'hentailib'),
    quickSearch('removed-dex', 'mangadex'),
    quickSearch('removed-mello', 'mangamello'),
  ];

  it('hides removed sources and R34 presets while privacy mode is off', () => {
    expect(visibleQuickSearchesFor(searches, false).map((search) => search.id)).toEqual(['comx', 'mangalib']);
    expect(isQuickSearchVisible(searches[2], false)).toBe(false);
    expect(isQuickSearchVisible(searches[3], false)).toBe(false);
    expect(isQuickSearchVisible(searches[4], false)).toBe(false);
  });

  it('keeps R34 presets but never removed sources when privacy mode is on', () => {
    expect(visibleQuickSearchesFor(searches, true).map((search) => search.id)).toEqual(['comx', 'mangalib', 'r34']);
    expect(isQuickSearchVisible(searches[2], true)).toBe(true);
    expect(isQuickSearchVisible(searches[3], true)).toBe(false);
    expect(isQuickSearchVisible(searches[4], true)).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { InMemorySeriesRepository } from '../src/main/services/series-repository';
import type { SeriesUpsert } from '../src/shared/library';

const up = (over: Partial<SeriesUpsert> = {}): SeriesUpsert => ({
  key: 'nh:1',
  seriesId: 'nh:1',
  url: 'https://nhentai.net/g/1/',
  title: 'A',
  coverUrl: null,
  source: 'NHentai',
  category: 'r34',
  currentPage: 1,
  totalPages: 10,
  chapterLabel: null,
  chapterIndex: null,
  chapterTotal: null,
  ...over,
});

describe('tombstones', () => {
  it('delete is soft: hidden from all/get, visible in allIncludingDeleted', () => {
    const r = new InMemorySeriesRepository();
    r.upsertHistory(up());
    r.delete('nh:1');
    expect(r.all()).toHaveLength(0);
    expect(r.get('nh:1')).toBeNull();
    expect(r.allIncludingDeleted()).toHaveLength(1);
    expect(r.getIncludingDeleted('nh:1')!.deletedAt).not.toBeNull();
  });

  it('upsertHistory resurrects a tombstoned row', () => {
    const r = new InMemorySeriesRepository();
    r.upsertHistory(up());
    r.delete('nh:1');
    r.upsertHistory(up({ currentPage: 3 }));
    expect(r.get('nh:1')).not.toBeNull();
    expect(r.get('nh:1')!.deletedAt).toBeNull();
    expect(r.get('nh:1')!.currentPage).toBe(3);
  });

  it('hardDelete removes physically', () => {
    const r = new InMemorySeriesRepository();
    r.upsertHistory(up());
    r.hardDelete('nh:1');
    expect(r.allIncludingDeleted()).toHaveLength(0);
  });

  it('clearHistory tombstones only status-null rows', () => {
    const r = new InMemorySeriesRepository();
    r.upsertHistory(up({ key: 'nh:1' }));
    r.upsertHistory(up({ key: 'nh:2' }));
    r.setStatus('nh:2', 'reading');
    r.clearHistory();
    expect(r.get('nh:1')).toBeNull();
    expect(
      r
        .allIncludingDeleted()
        .map((i) => i.key)
        .sort(),
    ).toEqual(['nh:1', 'nh:2']);
    expect(r.get('nh:2')).not.toBeNull();
  });

  it('importItems lets a newer tombstone win', () => {
    const r = new InMemorySeriesRepository();
    r.upsertHistory(up());
    const live = r.get('nh:1')!;
    const tomb = { ...live, deletedAt: Date.now() + 1000, updatedAt: live.updatedAt + 2000 };
    const res = r.importItems([tomb]);
    expect(res.updated).toBe(1);
    expect(r.get('nh:1')).toBeNull();
    expect(r.getIncludingDeleted('nh:1')!.deletedAt).not.toBeNull();
  });
});

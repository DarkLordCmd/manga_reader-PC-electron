import { describe, it, expect } from 'vitest';
import { senkuroLabelsAreR34 } from '../src/main/services/senkuro-r34-labels';

describe('Senkuro R34 labels', () => {
  it('uses hard sexual labels, not the age rating', () => {
    expect(senkuroLabelsAreR34([{ slug: 'hentai' }, { slug: 'romance' }])).toBe(true);
    expect(senkuroLabelsAreR34([{ slug: 'smut' }])).toBe(true);
    expect(senkuroLabelsAreR34(['hentai'])).toBe(true);
  });

  it('keeps violent EXPLICIT action/horror and soft erotica in Main', () => {
    expect(senkuroLabelsAreR34([{ slug: 'action' }, { slug: 'violence' }, { slug: 'horror' }])).toBe(false);
    expect(senkuroLabelsAreR34([{ slug: 'erotica' }, { slug: 'romance' }])).toBe(false);
    expect(senkuroLabelsAreR34([{ slug: 'ecchi' }, { slug: 'comedy' }])).toBe(false);
    expect(senkuroLabelsAreR34(undefined)).toBe(false);
    expect(senkuroLabelsAreR34([])).toBe(false);
  });
});

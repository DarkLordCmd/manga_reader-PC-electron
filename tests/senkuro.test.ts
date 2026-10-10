import { describe, it, expect } from 'vitest';
import { senkuroChapterNumber } from '../src/main/services/sources/senkuro';

describe('senkuroChapterNumber', () => {
  it('uses the string number the API actually sends', () => {
    expect(senkuroChapterNumber('1', '1')).toBe('1');
    expect(senkuroChapterNumber('42', null)).toBe('42');
    expect(senkuroChapterNumber(7, undefined)).toBe('7');
  });

  it('shows volume prefix when it differs from the chapter number', () => {
    expect(senkuroChapterNumber('5', '2')).toBe('2 / 5');
  });

  it('returns empty when there is no number', () => {
    expect(senkuroChapterNumber(null, '1')).toBe('');
    expect(senkuroChapterNumber(undefined, undefined)).toBe('');
  });
});

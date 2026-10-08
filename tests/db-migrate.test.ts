import { describe, it, expect } from 'vitest';
import { needsDeletedAtColumn, needsFavoritedAtColumn, needsKindColumn } from '../src/main/services/db-migrate';

describe('needsDeletedAtColumn', () => {
  it('true when column missing', () => {
    expect(needsDeletedAtColumn(1, ['key', 'url'])).toBe(true);
  });
  it('false when column present', () => {
    expect(needsDeletedAtColumn(1, ['key', 'deleted_at'])).toBe(false);
  });
});

describe('needsFavoritedAtColumn', () => {
  it('true at v2 without column, false when present', () => {
    expect(needsFavoritedAtColumn(2, ['key'])).toBe(true);
    expect(needsFavoritedAtColumn(2, ['key', 'favorited_at'])).toBe(false);
    expect(needsFavoritedAtColumn(3, ['key'])).toBe(false);
  });
});

describe('needsKindColumn', () => {
  it('true below v5 without column, false when present or already migrated', () => {
    expect(needsKindColumn(4, ['key', 'category'])).toBe(true);
    expect(needsKindColumn(4, ['key', 'kind'])).toBe(false);
    expect(needsKindColumn(5, ['key'])).toBe(false);
  });
});

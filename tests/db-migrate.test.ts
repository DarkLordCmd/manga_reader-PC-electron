import { describe, it, expect } from 'vitest'
import { needsDeletedAtColumn, needsFavoritedAtColumn } from '../src/main/services/db-migrate'

describe('needsDeletedAtColumn', () => {
  it('true when column missing', () => {
    expect(needsDeletedAtColumn(1, ['key', 'url'])).toBe(true)
  })
  it('false when column present', () => {
    expect(needsDeletedAtColumn(1, ['key', 'deleted_at'])).toBe(false)
  })
})

describe('needsFavoritedAtColumn', () => {
  it('true at v2 without column, false when present', () => {
    expect(needsFavoritedAtColumn(2, ['key'])).toBe(true)
    expect(needsFavoritedAtColumn(2, ['key', 'favorited_at'])).toBe(false)
    expect(needsFavoritedAtColumn(3, ['key'])).toBe(false)
  })
})

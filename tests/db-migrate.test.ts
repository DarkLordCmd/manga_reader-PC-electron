import { describe, it, expect } from 'vitest'
import { needsDeletedAtColumn } from '../src/main/services/db-migrate'

describe('needsDeletedAtColumn', () => {
  it('true when column missing', () => {
    expect(needsDeletedAtColumn(1, ['key', 'url'])).toBe(true)
  })
  it('false when column present', () => {
    expect(needsDeletedAtColumn(1, ['key', 'deleted_at'])).toBe(false)
  })
})

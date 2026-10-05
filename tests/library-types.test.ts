import { describe, it, expect } from 'vitest'
import { READING_STATUSES } from '../src/shared/library'
import { defaultSettings, parseSettings } from '../src/shared/settings'

describe('library types', () => {
  it('exposes the five statuses', () => {
    expect(READING_STATUSES).toEqual(['reading', 'planned', 'completed', 'on_hold', 'dropped'])
  })
})

describe('settings.library_auto_add', () => {
  it('defaults true and parses booleans', () => {
    expect(defaultSettings().library_auto_add).toBe(true)
    expect(parseSettings({ library_auto_add: false }).library_auto_add).toBe(false)
    expect(parseSettings({}).library_auto_add).toBe(true)
  })
})

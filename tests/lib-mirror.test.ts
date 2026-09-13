import { describe, it, expect } from 'vitest'
import { rewriteImglibHost, LIB_MIRRORS } from '../src/main/services/lib-mirror'
import { defaultSettings, parseSettings } from '../src/shared/settings'

describe('rewriteImglibHost', () => {
  it('rewrites img host when chosen is set', () => {
    expect(rewriteImglibHost('https://img33.imgslib.link/a/b.jpg', 'img45.imgslib.link')).toBe('https://img45.imgslib.link/a/b.jpg')
  })
  it('keeps url when no mirror chosen', () => {
    expect(rewriteImglibHost('https://img33.imgslib.link/a/b.jpg', null)).toBe('https://img33.imgslib.link/a/b.jpg')
  })
  it('leaves non-imgslib urls alone', () => {
    expect(rewriteImglibHost('https://example.com/x.jpg', 'img45.imgslib.link')).toBe('https://example.com/x.jpg')
  })
  it('exposes known mirrors', () => {
    expect(LIB_MIRRORS.length).toBeGreaterThanOrEqual(3)
  })
})

describe('settings: lib_image_server', () => {
  it('defaults null and parses', () => {
    expect(defaultSettings().lib_image_server).toBeNull()
    expect(parseSettings({ lib_image_server: 'img45.imgslib.link' }).lib_image_server).toBe('img45.imgslib.link')
    expect(parseSettings({}).lib_image_server).toBeNull()
  })
})

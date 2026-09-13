import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import { assertLayout, type LayoutChangeError } from '../src/main/services/layout-watcher'

const html = '<html><body><div class="media-shell">x</div></body></html>'
const expectedHash = createHash('sha256').update(html).digest('hex').slice(0, 8)

describe('assertLayout', () => {
  it('passes when any marker is present', () => {
    expect(() => assertLayout(['media-shell', 'nothing-else'], '<div class="media-shell">ok</div>', 'Manga-shi')).not.toThrow()
  })
  it('throws LayoutChangeError with hash when no marker found', () => {
    let err: LayoutChangeError | null = null
    try {
      assertLayout(['.media-shell', '.other-marker'], html, 'Manga-shi')
    } catch (e: any) {
      err = e
    }
    expect(err).not.toBeNull()
    expect(err!.code).toBe('layout-changed')
    expect(err!.pageHash).toBe(expectedHash)
    expect(err!.sourceName).toBe('Manga-shi')
    expect(err!.htmlHead).toBe(html.slice(0, 300))
    expect(err!.message).toContain('Manga-shi')
    expect(err!.message).toContain(expectedHash)
    expect(err!.message).toContain('Пришли разработчику')
  })
})

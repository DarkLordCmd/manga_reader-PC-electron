import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseArchiverPage } from '../src/main/services/eh-archive'

const html = readFileSync(join('tests', 'fixtures', 'eh-archiver.html'), 'utf-8')

describe('parseArchiverPage', () => {
  it('parses cost and options', () => {
    const r = parseArchiverPage(html)
    expect(r).not.toBeNull()
    expect(r!.costGp).toBe(100)
    expect(r!.options.map((o) => o.key)).toEqual(['org', 'res'])
    expect(r!.archiverUrl).toContain('archiver.php')
  })

  it('returns null for empty or limit page', () => {
    expect(parseArchiverPage('')).toBeNull()
    expect(parseArchiverPage('You have exceeded your usage limit')).toBeNull()
    expect(parseArchiverPage('<html><body>nothing</body></html>')).toBeNull()
  })
})

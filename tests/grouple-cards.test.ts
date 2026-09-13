import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseGroupleListing } from '../src/main/services/sources/grouple'

// Real mangapoisk card markup (server-rendered svelte card grid).
const cardHtml = `<html><body>
<div role="feed">
<div class="card shadow mb-4 w-36 snap-start"><a href="/manga/i-reincarnated-as-the-crazed-heir" title="Реинкарнация в безумного наследника"><div class="h-52 overflow-y-hidden min-w-[144px]"><img src="https://static2.mangapoisk.me/posters/7154/Xl81KWYWpRu7NJxb9enpKJga5DRaDoU6qk11hlmv_mini.jpg" width="280" height="400" class="rounded-container-token" alt="Реинкарнация в безумного наследника"></div> <h5 class="mt-2 ml-1 text-sm font-bold tracking-tight overflow-x-hidden whitespace-nowrap">Реинкарнация в безу...</h5></a> <div class="mt-3 text-sm flex items-center"><svg aria-label="clock-outline"></svg><a href="/manga/i-reincarnated-as-the-crazed-heir/chapter/1-167" class="text-surface-900-50-token">167 Глава</a></div></div>
</div></body></html>`

// Legacy grouple tile markup (readmanga/mintmanga list pages).
const tileHtml = `<html><body>
<div class="tiles row">
<a class="tile-link" href="https://readmanga.me/berserk-/"><img src="/img/cover1.jpg"><span class="text-center">Берсерк</span></a>
</div></body></html>`

describe('parseGroupleListing card strategy (mangapoisk markup)', () => {
  it('parses svelte-style cards with title attribute, cover and latest chapter', () => {
    const r = parseGroupleListing(cardHtml, 'https://mangapoisk.me')
    const mp = r.find((x) => x.url.includes('i-reincarnated-as-the-crazed-heir'))
    expect(mp).toBeDefined()
    expect(mp!.title).toBe('Реинкарнация в безумного наследника')
    expect(mp!.coverUrl).toContain('static2.mangapoisk.me/posters/7154/')
    expect(mp!.pages).toBe(167)
  })
  it('still parses legacy tiles (readmanga markup)', () => {
    const r = parseGroupleListing(tileHtml, 'https://readmanga.me')
    const berserk = r.find((x) => x.title === 'Берсерк')
    expect(berserk).toBeDefined()
    expect(berserk!.url).toBe('https://readmanga.me/berserk-/')

  })
})

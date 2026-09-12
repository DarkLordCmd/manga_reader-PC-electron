# Manga Reader Electron — Foundation + Local Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать каркас Electron-приложения (React+TS+Vite) с миграцией настроек, сервисом истории, локальным ридером (scroll/book) и упаковкой — первый работающий результат полного порта.

**Architecture:** Тонкий renderer, толстый main. Вся логика (настройки, история, файлы, галерея, сеть) живёт в main-процессе, renderer получает данные через типизированный IPC (`contextBridge`). Изображения страниц отдаются кастомным протоколом `manga://page/<galleryId>/<index>`.

**Tech Stack:** Electron, electron-vite, React 18, TypeScript, Vitest, electron-builder. Позже: cheerio, socks-proxy-agent.

## Global Constraints

- Проект: `E:\manga_reader-electron` (отдельная папка, Rust-проект не трогаем).
- Формат `settings.json` идентичен Rust-версии (см. спеку).
- Все строки UI/ошибок — как в текущем приложении (русский + английские лейблы кнопок).
- Кросс-платформенная сборка (win/mac/linux).
- Node ≥ 20, Electron фиксируем.
- Никакого Rust.
- Тесты — vitest; сеть в тестах только через локальный мок-сервер.
- Коммит после каждой задачи.

---

### Task 1: Каркас проекта

**Files:**
- Create: `E:\manga_reader-electron\package.json`
- Create: `E:\manga_reader-electron\electron.vite.config.ts`
- Create: `E:\manga_reader-electron\tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`
- Create: `E:\manga_reader-electron\vitest.config.ts`
- Create: `E:\manga_reader-electron\src\main\index.ts`
- Create: `E:\manga_reader-electron\src\preload\index.ts`
- Create: `E:\manga_reader-electron\src\renderer\index.html`, `src\renderer\src\main.tsx`, `src\renderer\src\App.tsx`
- Create: `E:\manga_reader-electron\.gitignore`, `.nvmrc`

**Interfaces:**
- Produces: рабочая команда `npm run dev` (окно Electron), `npm run build`, `npm test`.

- [ ] **Step 1: Инициализировать git и package.json**

```bash
git init
```

`package.json`:
```json
{
  "name": "manga-reader-electron",
  "version": "0.1.0",
  "description": "Manga Reader ported to Electron",
  "main": "./out/main/index.js",
  "author": "",
  "license": "MIT",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json",
    "dist": "electron-vite build && electron-builder"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "electron": "^33.2.0",
    "electron-builder": "^25.1.8",
    "electron-vite": "^2.3.0",
    "typescript": "^5.7.2",
    "vite": "^5.4.11",
    "vitest": "^2.1.8"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  }
}
```

- [ ] **Step 2: Конфиги**

`electron.vite.config.ts`:
```ts
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    plugins: [react()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  }
})
```

`tsconfig.json`:
```json
{ "files": [], "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.web.json" }] }
```

`tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"],
    "baseUrl": ".",
    "paths": { "@shared/*": ["src/shared/*"] }
  },
  "include": ["src/main/**/*", "src/preload/**/*", "src/shared/**/*", "electron.vite.config.ts"]
}
```

`tsconfig.web.json`:
```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": { "@shared/*": ["src/shared/*"] }
  },
  "include": ["src/renderer/**/*", "src/shared/**/*"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] }
})
```

`.gitignore`:
```
node_modules/
out/
dist/
*.log
.DS_Store
```

`.nvmrc`:
```
20
```

- [ ] **Step 3: Минимальный main/preload/renderer**

`src/main/index.ts`:
```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'path'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 480,
    minHeight: 360,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js') }
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

`src/preload/index.ts`:
```ts
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('api', {})
```

`src/renderer/index.html`:
```html
<!doctype html>
<html>
  <head><meta charset="UTF-8" /><title>Manga Reader</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

`src/renderer/src/main.tsx`:
```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
)
```

`src/renderer/src/App.tsx`:
```tsx
export default function App(): JSX.Element {
  return <div style={{ color: '#f1f5f9' }}>Manga Reader</div>
}
```

`src/renderer/src/styles.css`:
```css
:root { color-scheme: dark; }
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body { background: #000; color: #f1f5f9; font-family: system-ui, sans-serif; }
```

- [ ] **Step 4: Установить зависимости и проверить**

Run: `npm install`
Run: `npm run typecheck`
Expected: без ошибок.
Run: `npm test`
Expected: `No test files found` (пока нет тестов) — не падать с ошибкой конфигурации.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold electron-vite react ts project"
```

---

### Task 2: Общие типы и сервис настроек + миграция

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/shared/settings.ts`
- Create: `src/main/services/settings.ts`
- Create: `tests/settings.test.ts`

**Interfaces:**
- Produces:
  - `Settings` (интерфейс, идентичен Rust-полям), `ReadingMode`, `BookDirection`
  - `defaultSettings(): Settings`
  - `parseSettings(raw: unknown): Settings` — толерантный парсер с дефолтами
  - `SettingsService` с `get(): Settings`, `save(s: Settings): void`, `path: string`
  - `migrateIfNeeded(userDataDir: string): void` — копирует старый settings.json

- [ ] **Step 1: Написать падающий тест**

`tests/settings.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseSettings, defaultSettings } from '../src/shared/settings'

describe('parseSettings', () => {
  it('fills defaults for a missing object', () => {
    const s = parseSettings({})
    expect(s.reading_mode).toBe('Scroll')
    expect(s.width_scale).toBe(0.85)
    expect(s.pages_per_screen).toBe(2)
    expect(s.tor_socks_addr).toBe('127.0.0.1:9150')
    expect(s.show_thumbnails).toBe(true)
    expect(s.nhentai_show_page_counts).toBe(true)
    expect(s.show_r34_history).toBe(true)
  })

  it('preserves known fields and drops unknown ones', () => {
    const s = parseSettings({ width_scale: 0.5, bogus: 1 })
    expect(s.width_scale).toBe(0.5)
    expect((s as any).bogus).toBeUndefined()
  })

  it('parses history entries', () => {
    const s = parseSettings({
      viewing_history: [
        { url: 'u', series_id: 'sid', title: 't', cover_url: null, source: 'MangaDex',
          chapter_label: '1', chapter_index: 0, chapter_total: 5,
          current_page: 3, total_pages: 20, category: 'main', opened_at: 123 }
      ]
    })
    expect(s.viewing_history).toHaveLength(1)
    expect(s.viewing_history[0].current_page).toBe(3)
  })

  it('defaults empty sets/maps', () => {
    const s = parseSettings({})
    expect(s.tor_proxied_sites).toEqual([])
    expect(s.read_progress).toEqual({})
    expect(s.read_chapters).toEqual([])
    expect(s.eh_tag_bookmarks).toEqual([])
  })
})
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm test -- tests/settings.test.ts`
Expected: FAIL — модуль `../src/shared/settings` не найден.

- [ ] **Step 3: Реализовать типы и парсер**

`src/shared/types.ts`:
```ts
export type ReadingMode = 'Scroll' | 'Book'
export type BookDirection = 'Ltr' | 'Rtl'

export interface HistoryEntry {
  url: string
  series_id: string
  title: string
  cover_url: string | null
  source: string
  chapter_label: string | null
  chapter_index: number | null
  chapter_total: number | null
  current_page: number
  total_pages: number
  category: string
  opened_at: number
}
```

`src/shared/settings.ts`:
```ts
import type { BookDirection, HistoryEntry, ReadingMode } from './types'

export interface Settings {
  reading_mode: ReadingMode
  book_direction: BookDirection
  width_scale: number
  pages_per_screen: number
  show_thumbnails: boolean
  page_margin: number
  thumb_size: number
  last_folder: string | null
  read_progress: Record<string, [number, number]>
  tor_socks_addr: string
  tor_bridges: string
  exhentai_proxy_addr: string
  onion_cookies_raw: string
  nhentai_onion_cookies_raw: string
  nhentai_onion_base: string
  infinite_scroll: boolean
  tor_proxied_sites: string[]
  nhentai_show_page_counts: boolean
  viewing_history: HistoryEntry[]
  show_r34_history: boolean
  eh_tag_bookmarks: string[]
  read_chapters: string[]
}

export function defaultSettings(): Settings {
  return {
    reading_mode: 'Scroll', book_direction: 'Rtl', width_scale: 0.85,
    pages_per_screen: 2, show_thumbnails: true, page_margin: 12,
    thumb_size: 110, last_folder: null, read_progress: {},
    tor_socks_addr: '127.0.0.1:9150', tor_bridges: '', exhentai_proxy_addr: '',
    onion_cookies_raw: '', nhentai_onion_cookies_raw: '', nhentai_onion_base: '',
    infinite_scroll: false, tor_proxied_sites: [], nhentai_show_page_counts: true,
    viewing_history: [], show_r34_history: true, eh_tag_bookmarks: [], read_chapters: []
  }
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && isFinite(v) ? v : d)
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)
const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d)
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

export function parseSettings(raw: unknown): Settings {
  const d = defaultSettings()
  if (!raw || typeof raw !== 'object') return d
  const o = raw as Record<string, unknown>
  const history: HistoryEntry[] = Array.isArray(o.viewing_history)
    ? o.viewing_history.filter((e): e is HistoryEntry => !!e && typeof e === 'object')
    : []
  const progress: Record<string, [number, number]> = {}
  if (o.read_progress && typeof o.read_progress === 'object') {
    for (const [k, v] of Object.entries(o.read_progress as Record<string, unknown>)) {
      if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number') {
        progress[k] = [v[0], v[1]]
      }
    }
  }
  return {
    reading_mode: o.reading_mode === 'Book' ? 'Book' : 'Scroll',
    book_direction: o.book_direction === 'Ltr' ? 'Ltr' : 'Rtl',
    width_scale: num(o.width_scale, d.width_scale),
    pages_per_screen: num(o.pages_per_screen, d.pages_per_screen),
    show_thumbnails: bool(o.show_thumbnails, d.show_thumbnails),
    page_margin: num(o.page_margin, d.page_margin),
    thumb_size: num(o.thumb_size, d.thumb_size),
    last_folder: typeof o.last_folder === 'string' ? o.last_folder : null,
    read_progress: progress,
    tor_socks_addr: str(o.tor_socks_addr, d.tor_socks_addr),
    tor_bridges: str(o.tor_bridges, ''),
    exhentai_proxy_addr: str(o.exhentai_proxy_addr, ''),
    onion_cookies_raw: str(o.onion_cookies_raw, ''),
    nhentai_onion_cookies_raw: str(o.nhentai_onion_cookies_raw, ''),
    nhentai_onion_base: str(o.nhentai_onion_base, ''),
    infinite_scroll: bool(o.infinite_scroll, false),
    tor_proxied_sites: strArr(o.tor_proxied_sites),
    nhentai_show_page_counts: bool(o.nhentai_show_page_counts, true),
    viewing_history: history,
    show_r34_history: bool(o.show_r34_history, true),
    eh_tag_bookmarks: strArr(o.eh_tag_bookmarks),
    read_chapters: strArr(o.read_chapters)
  }
}
```

`src/main/services/settings.ts`:
```ts
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'fs'
import { join } from 'path'
import { defaultSettings, parseSettings, type Settings } from '@shared/settings'

const LEGACY_DIR = join(process.env.APPDATA ?? '', 'mangareader', 'manga_reader')

export function migrateIfNeeded(userDataDir: string): void {
  const dest = join(userDataDir, 'settings.json')
  if (existsSync(dest)) return
  const legacy = join(LEGACY_DIR, 'settings.json')
  if (!existsSync(legacy)) return
  mkdirSync(userDataDir, { recursive: true })
  copyFileSync(legacy, dest)
}

export class SettingsService {
  readonly path: string
  private current: Settings

  constructor(userDataDir: string) {
    migrateIfNeeded(userDataDir)
    this.path = join(userDataDir, 'settings.json')
    this.current = this.read()
  }

  private read(): Settings {
    if (!existsSync(this.path)) return defaultSettings()
    try {
      return parseSettings(JSON.parse(readFileSync(this.path, 'utf8')))
    } catch {
      return defaultSettings()
    }
  }

  get(): Settings { return this.current }

  save(s: Settings): void {
    this.current = s
    mkdirSync(join(this.path, '..'), { recursive: true })
    writeFileSync(this.path, JSON.stringify(s, null, 2), 'utf8')
  }
}
```

- [ ] **Step 4: Запустить тесты**

Run: `npm test -- tests/settings.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: settings schema, tolerant parser, legacy migration"
```

---

### Task 3: Сервис истории

**Files:**
- Create: `src/main/services/history.ts`
- Create: `tests/history.test.ts`

**Interfaces:**
- Consumes: `HistoryEntry` из `@shared/types`.
- Produces:
  - `HistoryUpdate` (url, series_id, title, cover_url, source, chapter_label, chapter_index, chapter_total, total_pages, category)
  - `HistoryManager` с `load(entries)`, `all()`, `mainEntries()`, `r34Entries()`, `addOrUpdate(u)`, `updateProgress(url, page, total)`, `clear()`, `toVec()`
  - `sourceLabelForUrl(url): string`

- [ ] **Step 1: Написать падающий тест**

`tests/history.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { HistoryManager } from '../src/main/services/history'

const u = (over: any = {}) => ({
  url: 'http://x/ch/1', series_id: 's1', title: 'Manga', cover_url: null,
  source: 'MangaDex', chapter_label: '1', chapter_index: 0, chapter_total: 10,
  total_pages: 20, category: 'main', ...over
})

describe('HistoryManager', () => {
  it('creates one card per series', () => {
    const h = new HistoryManager()
    h.addOrUpdate(u())
    h.addOrUpdate(u({ url: 'http://x/ch/2', chapter_index: 1 }))
    expect(h.all()).toHaveLength(1)
    expect(h.all()[0].chapter_index).toBe(1)
  })

  it('does not overwrite a further-read position with an earlier chapter', () => {
    const h = new HistoryManager()
    h.addOrUpdate(u({ chapter_index: 5 }))
    h.addOrUpdate(u({ url: 'http://x/ch/1', chapter_index: 1 }))
    expect(h.all()[0].chapter_index).toBe(5)
  })

  it('keeps saved page when reopening the same url', () => {
    const h = new HistoryManager()
    h.addOrUpdate(u())
    h.updateProgress('http://x/ch/1', 7, 20)
    h.addOrUpdate(u())
    expect(h.all()[0].current_page).toBe(7)
  })

  it('keeps an existing cover when update has none', () => {
    const h = new HistoryManager()
    h.addOrUpdate(u({ cover_url: 'http://c/1.jpg' }))
    h.addOrUpdate(u({ url: 'http://x/ch/2', chapter_index: 1, cover_url: null }))
    expect(h.all()[0].cover_url).toBe('http://c/1.jpg')
  })

  it('dedups by series on load and normalizes empty series_id', () => {
    const h = new HistoryManager()
    h.load([
      { ...u(), series_id: '', opened_at: 1 } as any,
      { ...u(), url: 'http://x/other', series_id: 's2', opened_at: 2 } as any
    ])
    expect(h.all()).toHaveLength(2)
    expect(h.all()[0].series_id).toBe('')
  })

  it('filters r34 vs main', () => {
    const h = new HistoryManager()
    h.addOrUpdate(u({ series_id: 'a', category: 'main' }))
    h.addOrUpdate(u({ series_id: 'b', category: 'r34', url: 'http://n/1' }))
    expect(h.mainEntries()).toHaveLength(1)
    expect(h.r34Entries()).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm test -- tests/history.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать**

`src/main/services/history.ts`:
```ts
import type { HistoryEntry } from '@shared/types'

export interface HistoryUpdate {
  url: string
  series_id: string
  title: string
  cover_url: string | null
  source: string
  chapter_label: string | null
  chapter_index: number | null
  chapter_total: number | null
  total_pages: number
  category: string
}

export function sourceLabelForUrl(url: string): string {
  const lower = url.toLowerCase()
  if (lower.startsWith('file://')) return 'Локальная папка'
  if (lower.includes('mangadex') || (!lower.startsWith('http') && url.length === 36)) return 'MangaDex'
  if (lower.includes('exhentai')) return 'ExHentai'
  if (lower.includes('e-hentai.org')) return 'E-Hentai'
  if (lower.includes('nhentai')) return 'NHentai'
  if (lower.includes('com-x.life')) return 'Com-X'
  if (lower.includes('senkuro.')) return 'Senkuro'
  if (lower.includes('manga-shi.')) return 'Manga-shi'
  if (lower.includes('remanga.')) return 'Remanga'
  if (lower.includes('mangalib.')) return 'Mangalib'
  return ''
}

export class HistoryManager {
  entries: HistoryEntry[] = []

  load(entries: HistoryEntry[]): void {
    const normalized = entries.map((e) => ({
      ...e,
      series_id: e.series_id || e.url
    }))
    normalized.sort((a, b) => b.opened_at - a.opened_at)
    const seen = new Set<string>()
    this.entries = normalized.filter((e) => (seen.has(e.series_id) ? false : (seen.add(e.series_id), true)))
  }

  all(): HistoryEntry[] { return this.entries }
  mainEntries(): HistoryEntry[] { return this.entries.filter((e) => e.category === 'main') }
  r34Entries(): HistoryEntry[] { return this.entries.filter((e) => e.category === 'r34') }
  toVec(): HistoryEntry[] { return this.entries.map((e) => ({ ...e })) }

  clear(): void { this.entries = [] }

  addOrUpdate(update: HistoryUpdate): void {
    const existing = this.entries.find((e) => e.series_id === update.series_id)
    if (existing) {
      if (existing.url === update.url) {
        const current_page = Math.max(existing.current_page, 1)
        const cover_url = update.cover_url ?? existing.cover_url
        this.entries = this.entries.filter((e) => e.series_id !== update.series_id)
        this.entries.unshift(this.newEntry({ ...update, cover_url }, current_page))
        return
      }
      if (update.chapter_index != null && existing.chapter_index != null && update.chapter_index < existing.chapter_index) {
        return
      }
      update = { ...update, cover_url: update.cover_url ?? existing.cover_url }
    }
    this.entries = this.entries.filter((e) => e.series_id !== update.series_id)
    this.entries.unshift(this.newEntry(update, 1))
  }

  updateProgress(url: string, currentPage: number, totalPages: number): void {
    const e = this.entries.find((x) => x.url === url)
    if (e) { e.current_page = currentPage; e.total_pages = totalPages; e.opened_at = Date.now() }
  }

  private newEntry(u: HistoryUpdate, current_page: number): HistoryEntry {
    return {
      url: u.url, series_id: u.series_id, title: u.title, cover_url: u.cover_url,
      source: u.source, chapter_label: u.chapter_label, chapter_index: u.chapter_index,
      chapter_total: u.chapter_total, current_page, total_pages: u.total_pages,
      category: u.category, opened_at: Date.now()
    }
  }
}
```

- [ ] **Step 4: Запустить тесты**

Run: `npm test -- tests/history.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: history manager with series dedup and resume guard"
```

---

### Task 4: Локальный ридер — галерея и natural sort

**Files:**
- Create: `src/main/services/natural-sort.ts`
- Create: `src/main/services/gallery.ts`
- Create: `tests/natural-sort.test.ts`
- Create: `tests/gallery.test.ts`

**Interfaces:**
- Produces:
  - `naturalCompare(a: string, b: string): number`
  - `Gallery` (локальная) с `id`, `title`, `pages: string[]`, `fromFolder(dir): Gallery | null`
  - `listPageFiles(dir): string[]` — только поддерживаемые расширения, natural sort, без рекурсии

- [ ] **Step 1: Падающие тесты**

`tests/natural-sort.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { naturalCompare } from '../src/main/services/natural-sort'

describe('naturalCompare', () => {
  it('orders numeric chunks numerically', () => {
    const files = ['page10.jpg', 'page2.jpg', 'page1.jpg']
    expect([...files].sort(naturalCompare)).toEqual(['page1.jpg', 'page2.jpg', 'page10.jpg'])
  })
  it('handles mixed alpha-numeric', () => {
    expect(naturalCompare('ch1_2', 'ch1_10')).toBeLessThan(0)
  })
})
```

`tests/gallery.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { listPageFiles, galleryFromFolder } from '../src/main/services/gallery'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mr-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('listPageFiles', () => {
  it('keeps supported image extensions and sorts naturally', () => {
    for (const f of ['a10.png', 'a2.png', 'a1.png', 'notes.txt', 'b.webp']) {
      writeFileSync(join(dir, f), 'x')
    }
    expect(listPageFiles(dir).map((p) => p.split(/[\\/]/).pop()))
      .toEqual(['a1.png', 'a2.png', 'a10.png', 'b.webp'])
  })
  it('ignores subdirectories', () => {
    expect(listPageFiles(dir)).toEqual([])
  })
})

describe('galleryFromFolder', () => {
  it('returns null for empty folder', () => { expect(galleryFromFolder(dir)).toBeNull() })
  it('uses folder name as title', () => {
    writeFileSync(join(dir, '1.jpg'), 'x')
    expect(galleryFromFolder(dir)!.title).toBe(dir.split(/[\\/]/).pop())
  })
})
```

- [ ] **Step 2: Запустить — падает**

Run: `npm test -- tests/natural-sort.test.ts tests/gallery.test.ts`
Expected: FAIL — модули не найдены.

- [ ] **Step 3: Реализовать**

`src/main/services/natural-sort.ts`:
```ts
function splitAlphaNumeric(s: string): string[] {
  const chunks: string[] = []
  let current = ''
  let currentIsDigit: boolean | null = null
  for (const ch of s) {
    const isDigit = ch >= '0' && ch <= '9'
    if (currentIsDigit === null || currentIsDigit === isDigit) {
      current += ch
    } else {
      if (current) chunks.push(current)
      current = ch
    }
    currentIsDigit = isDigit
  }
  if (current) chunks.push(current)
  return chunks
}

export function naturalCompare(a: string, b: string): number {
  const ac = splitAlphaNumeric(a)
  const bc = splitAlphaNumeric(b)
  const n = Math.min(ac.length, bc.length)
  for (let i = 0; i < n; i++) {
    const an = /^\d+$/.test(ac[i]) ? Number(ac[i]) : null
    const bn = /^\d+$/.test(bc[i]) ? Number(bc[i]) : null
    if (an !== null && bn !== null) {
      if (an !== bn) return an - bn
    } else if (ac[i] !== bc[i]) {
      return ac[i] < bc[i] ? -1 : 1
    }
  }
  return ac.length - bc.length
}
```

`src/main/services/gallery.ts`:
```ts
import { readdirSync, statSync } from 'fs'
import { join, basename } from 'path'
import { naturalCompare } from './natural-sort'

const SUPPORTED_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'])

export function listPageFiles(dir: string): string[] {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return [] }
  return entries
    .filter((name) => {
      const full = join(dir, name)
      try { if (!statSync(full).isFile()) return false } catch { return false }
      const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
      return SUPPORTED_EXTS.has(ext)
    })
    .map((name) => join(dir, name))
    .sort((a, b) => naturalCompare(basename(a), basename(b)))
}

export interface Gallery {
  id: string
  title: string
  pages: string[]
}

let nextId = 1

export function galleryFromFolder(dir: string): Gallery | null {
  const pages = listPageFiles(dir)
  if (pages.length === 0) return null
  return { id: `local-${nextId++}`, title: basename(dir) || 'Local', pages }
}
```

- [ ] **Step 4: Запустить тесты**

Run: `npm test -- tests/natural-sort.test.ts tests/gallery.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: local gallery listing with natural sort"
```

---

### Task 5: IPC-мост, протокол `manga://` и открытие папки

**Files:**
- Create: `src/shared/ipc.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Create: `src/renderer/src/env.d.ts`

**Interfaces:**
- Consumes: `SettingsService`, `HistoryManager`, `galleryFromFolder`.
- Produces:
  - `window.api` с `getSettings()`, `setSettings(s)`, `pickFolder()`, `openFolder(path)`, `getHistory()`, `recordProgress(url, page, total)`
  - Протокол `manga://page/<galleryId>/<index>` → локальный файл страницы
  - Событие `settings-changed` в renderer

- [ ] **Step 1: Определить каналы**

`src/shared/ipc.ts`:
```ts
import type { Settings } from './settings'
import type { HistoryEntry } from './types'

export interface OpenFolderResult {
  id: string
  title: string
  pageCount: number
  pages: string[]
}

export interface Api {
  getSettings(): Promise<Settings>
  setSettings(s: Settings): Promise<void>
  pickFolder(): Promise<OpenFolderResult | null>
  openFolder(path: string): Promise<OpenFolderResult | null>
  getHistory(): Promise<HistoryEntry[]>
  recordProgress(url: string, page: number, total: number): Promise<void>
}

export const CH = {
  getSettings: 'settings:get',
  setSettings: 'settings:set',
  pickFolder: 'folder:pick',
  openFolder: 'folder:open',
  getHistory: 'history:get',
  recordProgress: 'history:progress',
  settingsChanged: 'settings:changed'
} as const
```

- [ ] **Step 2: Реализовать main + протокол**

`src/main/index.ts` (полностью):
```ts
import { app, BrowserWindow, dialog, ipcMain, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { SettingsService } from './services/settings'
import { HistoryManager } from './services/history'
import { galleryFromFolder, type Gallery } from './services/gallery'
import { CH } from '@shared/ipc'

const galleries = new Map<string, Gallery>()

protocol.registerSchemesAsPrivileged([
  { scheme: 'manga', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

let settings: SettingsService
let history: HistoryManager

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 480, minHeight: 360,
    backgroundColor: '#000000', autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js') }
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  settings = new SettingsService(app.getPath('userData'))
  history = new HistoryManager()
  history.load(settings.get().viewing_history)

  protocol.handle('manga', (request) => {
    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean)
    const g = galleries.get(url.hostname)
    const index = Number(parts[0])
    if (!g || !Number.isInteger(index) || index < 0 || index >= g.pages.length) {
      return new Response('Not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(g.pages[index]).toString())
  })

  ipcMain.handle(CH.getSettings, () => settings.get())
  ipcMain.handle(CH.setSettings, (_e, s) => {
    settings.save(s)
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(CH.settingsChanged, s)
  })
  ipcMain.handle(CH.getHistory, () => history.toVec())
  ipcMain.handle(CH.recordProgress, (_e, url: string, page: number, total: number) => {
    history.updateProgress(url, page, total)
    settings.save({ ...settings.get(), viewing_history: history.toVec() })
  })
  ipcMain.handle(CH.pickFolder, async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (r.canceled || r.filePaths.length === 0) return null
    return openFolder(r.filePaths[0])
  })
  ipcMain.handle(CH.openFolder, (_e, path: string) => openFolder(path))

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

function openFolder(path: string): { id: string; title: string; pageCount: number; pages: string[] } | null {
  const g = galleryFromFolder(path)
  if (!g) return null
  galleries.set(g.id, g)
  const s = settings.get()
  settings.save({ ...s, last_folder: path })
  return { id: g.id, title: g.title, pageCount: g.pages.length, pages: g.pages }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

`src/preload/index.ts` (полностью):
```ts
import { contextBridge, ipcRenderer } from 'electron'
import { CH, type Api } from '@shared/ipc'

const api: Api = {
  getSettings: () => ipcRenderer.invoke(CH.getSettings),
  setSettings: (s) => ipcRenderer.invoke(CH.setSettings, s),
  pickFolder: () => ipcRenderer.invoke(CH.pickFolder),
  openFolder: (path) => ipcRenderer.invoke(CH.openFolder, path),
  getHistory: () => ipcRenderer.invoke(CH.getHistory),
  recordProgress: (url, page, total) => ipcRenderer.invoke(CH.recordProgress, url, page, total)
}

contextBridge.exposeInMainWorld('api', api)
```

`src/renderer/src/env.d.ts`:
```ts
/// <reference types="vite/client" />
import type { Api } from '@shared/ipc'
declare global {
  interface Window { api: Api }
}
export {}
```

- [ ] **Step 3: Проверить typecheck и сборку**

Run: `npm run typecheck`
Expected: без ошибок.
Run: `npm run build`
Expected: `out/main`, `out/preload`, `out/renderer` созданы.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: ipc bridge, manga:// protocol, folder open"
```

---

### Task 6: UI-каркас (сайдбар, топбар, экраны)

**Files:**
- Create: `src/renderer/src/state/store.tsx`
- Create: `src/renderer/src/components/Sidebar.tsx`
- Create: `src/renderer/src/components/TopBar.tsx`
- Create: `src/renderer/src/screens/Reader.tsx`, `Catalog.tsx`, `History.tsx`, `Settings.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: `window.api`.
- Produces: навигация между Reader/Catalog/History/Settings, тёмная тема с оранжевым акцентом `#f97316`, слоты экранов.

- [ ] **Step 1: Глобальное состояние**

`src/renderer/src/state/store.tsx`:
```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Settings } from '@shared/settings'
import { defaultSettings } from '@shared/settings'

type Screen = 'Reader' | 'Catalog' | 'History' | 'Settings'

interface Store {
  screen: Screen
  setScreen: (s: Screen) => void
  settings: Settings
  setSettings: (s: Settings) => void
}

const Ctx = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const [screen, setScreen] = useState<Screen>('Reader')
  const [settings, setSettingsState] = useState<Settings>(defaultSettings())

  useEffect(() => {
    window.api.getSettings().then(setSettingsState)
  }, [])

  const setSettings = (s: Settings): void => {
    setSettingsState(s)
    window.api.setSettings(s)
  }

  return <Ctx.Provider value={{ screen, setScreen, settings, setSettings }}>{children}</Ctx.Provider>
}

export function useStore(): Store {
  const v = useContext(Ctx)
  if (!v) throw new Error('useStore outside provider')
  return v
}
```

- [ ] **Step 2: Сайдбар и топбар**

`src/renderer/src/components/Sidebar.tsx`:
```tsx
import { useStore } from '../state/store'

const ITEMS: { key: 'Reader' | 'Catalog' | 'History' | 'Settings'; icon: string; label: string }[] = [
  { key: 'Reader', icon: '\u25B6', label: 'Reader' },
  { key: 'Catalog', icon: '\u2630', label: 'Catalog' },
  { key: 'History', icon: '\u{1F4DC}', label: 'History' },
  { key: 'Settings', icon: '\u2699', label: 'Settings' }
]

export default function Sidebar(): JSX.Element {
  const { screen, setScreen } = useStore()
  return (
    <nav className="sidebar">
      {ITEMS.map((it) => (
        <button
          key={it.key}
          title={it.label}
          className={`nav-btn${screen === it.key ? ' active' : ''}`}
          onClick={() => setScreen(it.key)}
        >
          {it.icon}
        </button>
      ))}
    </nav>
  )
}
```

`src/renderer/src/components/TopBar.tsx`:
```tsx
import { useStore } from '../state/store'

export default function TopBar(): JSX.Element {
  const { screen } = useStore()
  return <header className="topbar">{screen}</header>
}
```

- [ ] **Step 3: Экраны-заглушки + App**

`src/renderer/src/screens/Catalog.tsx`:
```tsx
export default function Catalog(): JSX.Element { return <div className="screen">Catalog</div> }
```
`src/renderer/src/screens/History.tsx`:
```tsx
export default function History(): JSX.Element { return <div className="screen">История просмотра</div> }
```
`src/renderer/src/screens/Settings.tsx`:
```tsx
export default function Settings(): JSX.Element { return <div className="screen">Settings</div> }
```
`src/renderer/src/screens/Reader.tsx` — пока заглушка, наполняется в Task 7:
```tsx
export default function Reader(): JSX.Element { return <div className="screen">Reader</div> }
```

`src/renderer/src/App.tsx`:
```tsx
import { StoreProvider, useStore } from './state/store'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import Reader from './screens/Reader'
import Catalog from './screens/Catalog'
import History from './screens/History'
import Settings from './screens/Settings'

function Shell(): JSX.Element {
  const { screen } = useStore()
  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <TopBar />
        {screen === 'Reader' && <Reader />}
        {screen === 'Catalog' && <Catalog />}
        {screen === 'History' && <History />}
        {screen === 'Settings' && <Settings />}
      </div>
    </div>
  )
}

export default function App(): JSX.Element {
  return <StoreProvider><Shell /></StoreProvider>
}
```

- [ ] **Step 4: Стили**

`src/renderer/src/styles.css`:
```css
:root {
  color-scheme: dark;
  --bg: #000; --panel: #0a0a16; --border: #2d2d4e;
  --text: #f1f5f9; --muted: #94a3b8; --dim: #64748b; --accent: #f97316;
}
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body { background: var(--bg); color: var(--text); font-family: system-ui, sans-serif; font-size: 13px; }
.app { display: flex; height: 100%; }
.sidebar { width: 48px; background: #000; border-right: 1px solid var(--border); display: flex; flex-direction: column; align-items: center; padding: 8px 4px; gap: 12px; }
.nav-btn { width: 40px; height: 40px; font-size: 18px; color: var(--muted); background: transparent; border: 2px solid transparent; border-radius: 4px; cursor: pointer; }
.nav-btn.active { color: #fff; background: #2d2d4e; border-color: var(--accent); }
.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.topbar { padding: 8px 12px; border-bottom: 1px solid var(--border); font-weight: 600; }
.screen { flex: 1; overflow: auto; padding: 12px; }
```

- [ ] **Step 5: Проверить dev-запуск**

Run: `npm run typecheck`
Expected: без ошибок.
Run: `npm run dev` (проверить визуально: сайдбар переключает экраны; затем закрыть).
Expected: окно с рабочей навигацией.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: renderer shell with sidebar navigation"
```

---

### Task 7: Ридер — Scroll и Book (локальные папки)

**Files:**
- Create: `src/renderer/src/screens/Reader.tsx`
- Create: `src/renderer/src/components/ScrollView.tsx`
- Create: `src/renderer/src/components/BookView.tsx`
- Create: `src/renderer/src/hooks/useGallery.ts`
- Create: `src/renderer/src/hooks/useHotkeys.ts`

**Interfaces:**
- Consumes: `window.api.pickFolder/openFolder`, `settings`.
- Produces: открытие локальной папки, отрисовка страниц через `manga://page/<id>/<index>`, переключение режимов, счётчик страниц, jump-to-page, горячие клавиши.

- [ ] **Step 1: Хук галереи**

`src/renderer/src/hooks/useGallery.ts`:
```ts
import { useCallback, useState } from 'react'
import type { OpenFolderResult } from '@shared/ipc'

export function useGallery(): {
  gallery: OpenFolderResult | null
  openFolder: () => Promise<void>
  openPath: (p: string) => Promise<void>
} {
  const [gallery, setGallery] = useState<OpenFolderResult | null>(null)
  const openFolder = useCallback(async () => {
    const g = await window.api.pickFolder()
    if (g) setGallery(g)
  }, [])
  const openPath = useCallback(async (p: string) => {
    const g = await window.api.openFolder(p)
    if (g) setGallery(g)
  }, [])
  return { gallery, openFolder, openPath }
}
```

- [ ] **Step 2: Хук горячих клавиш**

`src/renderer/src/hooks/useHotkeys.ts`:
```ts
import { useEffect } from 'react'

export interface HotkeyHandlers {
  onPrev: () => void
  onNext: () => void
  onToggleThumbs: () => void
  onToggleMode: () => void
  onToggleHelp: () => void
}

export function useHotkeys(h: HotkeyHandlers): void {
  useEffect(() => {
    const fn = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      switch (e.key) {
        case 'ArrowLeft': case 'a': case 'A': h.onPrev(); break
        case 'ArrowRight': case 'd': case 'D': h.onNext(); break
        case 'ArrowUp': case 'w': case 'W': h.onPrev(); break
        case 'ArrowDown': case 's': case 'S': h.onNext(); break
        case 't': case 'T': h.onToggleThumbs(); break
        case 'm': case 'M': h.onToggleMode(); break
        case '?': h.onToggleHelp(); break
      }
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [h])
}
```

- [ ] **Step 3: ScrollView (виртуализация по IntersectionObserver)**

`src/renderer/src/components/ScrollView.tsx`:
```tsx
import { useEffect, useRef } from 'react'

interface Props {
  galleryId: string
  pages: string[]
  widthScale: number
  currentIndex: number
  jumpTo: number | null
  onVisible: (index: number) => void
  onJumpDone: () => void
}

export default function ScrollView({ galleryId, pages, widthScale, currentIndex, jumpTo, onVisible, onJumpDone }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting && en.intersectionRatio > 0.5) {
            onVisible(Number((en.target as HTMLElement).dataset.index))
          }
        }
      },
      { root: container, threshold: [0.5] }
    )
    itemRefs.current.forEach((el) => el && observer.observe(el))
    return () => observer.disconnect()
  }, [pages.length, onVisible])

  useEffect(() => {
    if (jumpTo == null) return
    itemRefs.current[jumpTo]?.scrollIntoView({ block: 'start' })
    onJumpDone()
  }, [jumpTo, onJumpDone])

  return (
    <div className="scroll-view" ref={containerRef}>
      {pages.map((_, i) => (
        <div
          key={i}
          data-index={i}
          ref={(el) => { itemRefs.current[i] = el }}
          className={`scroll-item${i === currentIndex ? ' current' : ''}`}
        >
          <img src={`manga://page/${galleryId}/${i}`} style={{ width: `${widthScale * 100}%` }} alt={`page ${i + 1}`} />
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: BookView**

`src/renderer/src/components/BookView.tsx`:
```tsx
interface Props {
  galleryId: string
  pageCount: number
  currentIndex: number
  pagesPerScreen: number
  direction: 'Ltr' | 'Rtl'
  onPrev: () => void
  onNext: () => void
}

export default function BookView({ galleryId, pageCount, currentIndex, pagesPerScreen, direction, onPrev, onNext }: Props): JSX.Element {
  const start = Math.min(currentIndex, Math.max(0, pageCount - 1))
  const indices = Array.from({ length: Math.min(pagesPerScreen, pageCount - start) }, (_, k) => start + k)
  const ordered = direction === 'Rtl' ? [...indices].reverse() : indices

  return (
    <div className="book-view">
      <div className="book-zone left" onClick={onPrev} />
      <div className="book-pages">
        {ordered.map((i) => (
          <img key={i} src={`manga://page/${galleryId}/${i}`} alt={`page ${i + 1}`} />
        ))}
      </div>
      <div className="book-zone right" onClick={onNext} />
    </div>
  )
}
```

- [ ] **Step 5: Reader**

`src/renderer/src/screens/Reader.tsx`:
```tsx
import { useCallback, useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { useGallery } from '../hooks/useGallery'
import { useHotkeys } from '../hooks/useHotkeys'
import ScrollView from '../components/ScrollView'
import BookView from '../components/BookView'

export default function Reader(): JSX.Element {
  const { settings, setSettings } = useStore()
  const { gallery, openFolder } = useGallery()
  const [currentIndex, setCurrentIndex] = useState(0)
  const [jumpTo, setJumpTo] = useState<number | null>(null)
  const [jumpText, setJumpText] = useState('')
  const [showHelp, setShowHelp] = useState(false)

  const perScreen = Math.max(1, settings.pages_per_screen)
  const pageCount = gallery?.pageCount ?? 0

  const goNext = useCallback(() => {
    setCurrentIndex((i) => Math.min(i + perScreen, Math.max(0, pageCount - 1)))
  }, [perScreen, pageCount])
  const goPrev = useCallback(() => {
    setCurrentIndex((i) => Math.max(0, i - perScreen))
  }, [perScreen])

  useHotkeys({
    onPrev: goPrev,
    onNext: goNext,
    onToggleThumbs: () => setSettings({ ...settings, show_thumbnails: !settings.show_thumbnails }),
    onToggleMode: () => setSettings({ ...settings, reading_mode: settings.reading_mode === 'Scroll' ? 'Book' : 'Scroll' }),
    onToggleHelp: () => setShowHelp((v) => !v)
  })

  const onVisible = useCallback((i: number) => setCurrentIndex(i), [])
  const onJumpDone = useCallback(() => setJumpTo(null), [])

  const jump = useMemo(() => (): void => {
    const n = parseInt(jumpText, 10)
    if (!isNaN(n)) setJumpTo(Math.min(Math.max(0, n - 1), Math.max(0, pageCount - 1)))
  }, [jumpText, pageCount])

  return (
    <div className="reader">
      <div className="reader-toolbar">
        <button onClick={openFolder}>Open</button>
        <span className="reader-title">{gallery?.title ?? 'Нет галереи'}</span>
        <select
          value={settings.reading_mode}
          onChange={(e) => setSettings({ ...settings, reading_mode: e.target.value as 'Scroll' | 'Book' })}
        >
          <option value="Scroll">Scroll</option>
          <option value="Book">Book</option>
        </select>
        <div className="spacer" />
        <span className="muted">Pg {pageCount === 0 ? 0 : currentIndex + 1}/{pageCount}</span>
        <input value={jumpText} onChange={(e) => setJumpText(e.target.value)} placeholder="#" style={{ width: 44 }} />
        <button onClick={jump}>Go</button>
      </div>

      {!gallery && <div className="screen">Открой папку кнопкой Open</div>}

      {gallery && settings.reading_mode === 'Scroll' && (
        <ScrollView
          galleryId={gallery.id}
          pages={gallery.pages}
          widthScale={settings.width_scale}
          currentIndex={currentIndex}
          jumpTo={jumpTo}
          onVisible={onVisible}
          onJumpDone={onJumpDone}
        />
      )}

      {gallery && settings.reading_mode === 'Book' && (
        <BookView
          galleryId={gallery.id}
          pageCount={pageCount}
          currentIndex={currentIndex}
          pagesPerScreen={perScreen}
          direction={settings.book_direction}
          onPrev={goPrev}
          onNext={goNext}
        />
      )}

      {showHelp && (
        <div className="overlay" onClick={() => setShowHelp(false)}>
          <div className="overlay-card">
            <h3>Keyboard Shortcuts</h3>
            <ul>
              <li>← / A — Previous page</li>
              <li>→ / D — Next page</li>
              <li>↑ / W — Previous screen</li>
              <li>↓ / S — Next screen</li>
              <li>T — Toggle thumbnails</li>
              <li>M — Toggle reading mode</li>
              <li>? — Toggle this help</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Стили ридера**

Добавить в `src/renderer/src/styles.css`:
```css
.reader { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.reader-toolbar { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-bottom: 1px solid var(--border); }
.reader-title { font-weight: 600; }
.spacer { flex: 1; }
.muted { color: var(--muted); }
.scroll-view { flex: 1; overflow-y: auto; display: flex; flex-direction: column; align-items: center; }
.scroll-item { width: 100%; display: flex; justify-content: center; }
.scroll-item img { display: block; max-width: 100%; }
.book-view { flex: 1; display: flex; min-height: 0; }
.book-pages { flex: 1; display: flex; justify-content: center; align-items: center; gap: 2px; min-width: 0; }
.book-pages img { max-height: 100%; max-width: 50%; object-fit: contain; }
.book-zone { width: 15%; cursor: pointer; }
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; }
.overlay-card { background: #080812; border: 1px solid var(--border); border-radius: 8px; padding: 20px 24px; }
```

- [ ] **Step 7: Проверка**

Run: `npm run typecheck`
Expected: без ошибок.
Run: `npm run dev` — открыть папку с картинками, проверить Scroll/Book, стрелки, jump-to-page, ?.
Expected: страницы видны, навигация работает.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: local folder reader with scroll and book modes"
```

---

### Task 8: Тумбнейл-панель

**Files:**
- Create: `src/renderer/src/components/ThumbnailPanel.tsx`
- Modify: `src/renderer/src/screens/Reader.tsx`
- Modify: `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: `gallery`, `currentIndex`, `settings.thumb_size`, `settings.show_thumbnails`.
- Produces: панель миниатюр слева от страниц, следует за текущей, клик прыгает.

- [ ] **Step 1: Компонент**

`src/renderer/src/components/ThumbnailPanel.tsx`:
```tsx
import { useEffect, useRef } from 'react'

interface Props {
  galleryId: string
  pageCount: number
  currentIndex: number
  thumbSize: number
  onSelect: (index: number) => void
}

export default function ThumbnailPanel({ galleryId, pageCount, currentIndex, thumbSize, onSelect }: Props): JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  useEffect(() => {
    refs.current[currentIndex]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [currentIndex])

  return (
    <div className="thumb-panel">
      {Array.from({ length: pageCount }, (_, i) => (
        <button
          key={i}
          ref={(el) => { refs.current[i] = el }}
          className={`thumb${i === currentIndex ? ' current' : ''}`}
          onClick={() => onSelect(i)}
          style={{ width: thumbSize }}
        >
          <img src={`manga://page/${galleryId}/${i}`} alt={`${i + 1}`} style={{ width: thumbSize }} />
          <span>{i + 1}</span>
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Встроить в Reader**

В `src/renderer/src/screens/Reader.tsx`: импортировать `ThumbnailPanel`; в разметке, перед областью страниц, добавить:
```tsx
{gallery && settings.show_thumbnails && (
  <div className="reader-body">
    <ThumbnailPanel
      galleryId={gallery.id}
      pageCount={pageCount}
      currentIndex={currentIndex}
      thumbSize={settings.thumb_size}
      onSelect={(i) => { setCurrentIndex(i); setJumpTo(i) }}
    />
    <div className="reader-content">
      {/* сюда перенести ScrollView / BookView */}
    </div>
  </div>
)}
```
(если `show_thumbnails` выключен — рендерить страницы без обёртки; вынести общий фрагмент страниц в переменную `pagesView`).

- [ ] **Step 3: Стили**

```css
.reader-body { flex: 1; display: flex; min-height: 0; }
.reader-content { flex: 1; display: flex; min-height: 0; min-width: 0; }
.thumb-panel { width: 140px; overflow-y: auto; border-right: 1px solid var(--border); padding: 6px; display: flex; flex-direction: column; gap: 6px; align-items: center; }
.thumb { background: transparent; border: 2px solid transparent; border-radius: 4px; padding: 2px; cursor: pointer; color: var(--muted); }
.thumb.current { border-color: #22c55e; }
.thumb img { display: block; border-radius: 3px; }
```

- [ ] **Step 4: Проверка и коммит**

Run: `npm run typecheck`
Expected: без ошибок.
Run: `npm run dev` — проверить панель, клик, следование.
```bash
git add -A
git commit -m "feat: thumbnail panel for local reader"
```

---

### Task 9: Упаковка (electron-builder)

**Files:**
- Create: `E:\manga_reader-electron\electron-builder.yml`
- Modify: `package.json` (build config/метаданные)

**Interfaces:**
- Produces: `npm run dist` создаёт установщики.

- [ ] **Step 1: Конфиг**

`electron-builder.yml`:
```yaml
appId: dev.mangareader.electron
productName: Manga Reader
directories:
  output: dist
  buildResources: build
files:
  - out/**
  - package.json
win:
  target:
    - nsis
    - portable
mac:
  target: dmg
  category: public.app-category.entertainment
linux:
  target:
    - AppImage
    - deb
  category: Graphics
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```

- [ ] **Step 2: Проверить сборку**

Run: `npm run dist`
Expected: в `dist/` появляется установщик текущей ОС.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: electron-builder packaging config"
```

---

## Self-Review

- **Spec coverage (фазы 1–2):** каркас ✓, настройки+миграция ✓, история ✓, локальный ридер scroll/book ✓, тумбнейлы ✓, упаковка ✓. Онлайн-источники, каталог, Tor/куки, веб-логин, автодополнение тегов — отдельные планы (фазы 3–7).
- **Placeholders:** нет TODO/TBD; код приведён для каждого шага.
- **Type consistency:** `Gallery` (`id/title/pages`) в gallery.ts совпадает с `OpenFolderResult`; `Api` в `@shared/ipc` совпадает с реализацией preload и вызовами в renderer; `Settings` единый для всех слоёв; `manga://page/<id>/<index>` согласован в main-обработчике и обоих вью.
- **Известное ограничение:** `manga://` в этом плане отдаёт только локальные файлы; онлайн-страницы добавятся в фазе 3 через тот же протокол (в памяти).

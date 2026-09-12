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
  enable_domain_fronting: boolean
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
    enable_domain_fronting: false,
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
    enable_domain_fronting: bool(o.enable_domain_fronting, false),
    viewing_history: history,
    show_r34_history: bool(o.show_r34_history, true),
    eh_tag_bookmarks: strArr(o.eh_tag_bookmarks),
    read_chapters: strArr(o.read_chapters)
  }
}
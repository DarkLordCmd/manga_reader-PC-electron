import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  httpFetch: vi.fn(),
  fetchHtmlViaBrowser: vi.fn()
}))

vi.mock('../src/main/services/http', () => mocks)

vi.mock('../src/main/services/browser-fetch', async () => {
  const antibot = await vi.importActual<typeof import('../src/main/services/anti-bot')>(
    '../src/main/services/anti-bot'
  )
  return {
    detectsAntiBot: antibot.detectsAntiBot,
    fetchHtmlViaBrowser: mocks.fetchHtmlViaBrowser
  }
})

import { fetchHtmlSmart } from '../src/main/services/fetch-html'

describe('fetchHtmlSmart', () => {
  beforeEach(() => {
    mocks.httpFetch.mockReset()
    mocks.fetchHtmlViaBrowser.mockReset()
  })

  it('returns http result when healthy', async () => {
    mocks.httpFetch.mockResolvedValue({
      status: 200,
      text: '<html><body><div class="media-shell">cat</div></body></html>'
    })
    const html = await fetchHtmlSmart('https://x/', { useBrowser: false })
    expect(html).toContain('media-shell')
    expect(mocks.fetchHtmlViaBrowser).not.toHaveBeenCalled()
  })

  it('falls back to browser on cloudflare challenge', async () => {
    mocks.httpFetch.mockResolvedValue({ status: 403, text: 'Just a moment...' })
    mocks.fetchHtmlViaBrowser.mockResolvedValue('<html><body class="fixed">ok</body></html>')
    const html = await fetchHtmlSmart('https://x/')
    expect(html).toContain('class="fixed"')
    expect(mocks.fetchHtmlViaBrowser).toHaveBeenCalledWith('https://x/', { proxy: undefined, timeoutMs: undefined })
  })

  it('throws when anti-bot detected and browser fallback disabled', async () => {
    mocks.httpFetch.mockResolvedValue({ status: 503, text: 'Checking your browser' })
    await expect(fetchHtmlSmart('https://x/', { useBrowser: false }))
      .rejects.toThrow('анти-бот блокирует запрос')
  })
})

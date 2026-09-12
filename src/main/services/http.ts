export async function httpGetJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'manga_reader/0.1', Accept: 'application/json', ...headers },
      signal: controller.signal
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

export async function httpGetText(url: string, headers: Record<string, string> = {}, timeoutMs = 20_000): Promise<{ status: number; text: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'manga_reader/0.1', ...headers },
      signal: controller.signal
    })
    return { status: res.status, text: await res.text() }
  } finally {
    clearTimeout(timer)
  }
}
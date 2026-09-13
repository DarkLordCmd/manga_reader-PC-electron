/** Pure anti-bot gate: flags challenge walls and rate limits. */
export function detectsAntiBot(status: number, html: string): boolean {
  if (status === 403 || status === 429 || status === 503) return true
  const lower = html.slice(0, 4000).toLowerCase()
  return [
    'just a moment',
    'checking your browser',
    'cf-mitigated: challenge',
    'attention required',
    'cloudflare ray id'
  ].some((marker) => lower.includes(marker))
}

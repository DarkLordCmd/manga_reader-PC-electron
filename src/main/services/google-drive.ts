import type { GoogleAuth } from './google-auth'

export const SYNC_FILE_NAME = 'manga-reader-sync.json'
const FILES_API = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files'

type FetchLike = typeof fetch

export class GoogleDrive {
  constructor(
    private auth: Pick<GoogleAuth, 'getAccessToken'>,
    private fetchImpl: FetchLike = fetch
  ) {}

  private async req(url: string, init: RequestInit): Promise<Response> {
    const token = await this.auth.getAccessToken()
    const headers = { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` }
    let res = await this.fetchImpl(url, { ...init, headers })
    if (res.status === 401) {
      const t2 = await this.auth.getAccessToken()
      res = await this.fetchImpl(url, { ...init, headers: { ...headers, Authorization: `Bearer ${t2}` } })
    }
    return res
  }

  async findSyncFile(): Promise<string | null> {
    const q = encodeURIComponent(`name='${SYNC_FILE_NAME}'`)
    const res = await this.req(`${FILES_API}?spaces=appDataFolder&q=${q}&fields=files(id,name)`, { method: 'GET' })
    if (!res.ok) throw new Error(`Drive list не удался (HTTP ${res.status})`)
    const j = await res.json() as { files?: { id: string }[] }
    return j.files?.[0]?.id ?? null
  }

  async download(): Promise<string | null> {
    const id = await this.findSyncFile()
    if (!id) return null
    const res = await this.req(`${FILES_API}/${id}?alt=media`, { method: 'GET' })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`Drive download не удался (HTTP ${res.status})`)
    return await res.text()
  }

  async upload(content: string): Promise<void> {
    const id = await this.findSyncFile()
    const boundary = 'mangareadersync'
    const meta = id ? { name: SYNC_FILE_NAME } : { name: SYNC_FILE_NAME, parents: ['appDataFolder'] }
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--`
    const url = id ? `${UPLOAD_API}/${id}?uploadType=multipart` : `${UPLOAD_API}?uploadType=multipart`
    const res = await this.req(url, {
      method: id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    })
    if (!res.ok) throw new Error(`Drive upload не удался (HTTP ${res.status})`)
  }
}

import type { SeriesRepository } from './series-repository'
import { parseSettings, type Settings } from '@shared/settings'
import type { SyncState } from '@shared/sync'
import {
  buildSyncPayload, mergeSyncPayload, parseSyncPayload, applySyncSettings,
  extractSyncSettings
} from './sync-payload'

interface DriveLike {
  download(): Promise<string | null>
  upload(content: string): Promise<void>
}

export interface SyncDeps {
  repo: SeriesRepository
  getSettings: () => Settings
  saveSettings: (s: Settings) => void
  getSettingsUpdatedAt: () => number
  drive: DriveLike
  authStatus: () => { authed: boolean; email: string | null }
  onChanged: (s: SyncState) => void
}

const DEBOUNCE_MS = 10_000

export class SyncService {
  private state: SyncState
  private inFlight: Promise<SyncState> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private settingsUpdatedAt: number

  constructor(private deps: SyncDeps) {
    this.settingsUpdatedAt = deps.getSettingsUpdatedAt()
    this.state = { state: 'idle', lastSyncAt: null, email: deps.authStatus().email, lastError: null }
  }

  getState(): SyncState { return { ...this.state } }

  markSettingsChanged(): void { this.settingsUpdatedAt = Date.now() }

  scheduleSync(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.timer = null; void this.syncNow() }, DEBOUNCE_MS)
  }

  async syncNow(): Promise<SyncState> {
    if (this.inFlight) return this.inFlight
    this.set({ state: 'syncing', lastError: null })
    this.inFlight = (async () => {
      try {
        const remoteText = await this.deps.drive.download()
        const local = buildSyncPayload(this.deps.repo.allIncludingDeleted(), this.deps.getSettings(), this.settingsUpdatedAt)
        const merged = remoteText ? mergeSyncPayload(local, parseSyncPayload(remoteText)) : local
        this.deps.repo.importItems(merged.series)
        if (merged.settingsUpdatedAt >= this.settingsUpdatedAt) {
          this.deps.saveSettings(parseSettings(applySyncSettings(this.deps.getSettings(), merged.settings)))
          this.settingsUpdatedAt = merged.settingsUpdatedAt
        }
        await this.deps.drive.upload(JSON.stringify(merged))
        this.set({ state: 'idle', lastSyncAt: Date.now(), email: this.deps.authStatus().email, lastError: null })
      } catch (e: any) {
        this.set({ state: 'error', lastError: e?.message ?? String(e) })
      } finally {
        this.inFlight = null
      }
      return this.getState()
    })()
    return this.inFlight
  }

  private set(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch }
    this.deps.onChanged(this.getState())
  }
}

export function isPortableSettingsChanged(a: Settings, b: Settings): boolean {
  return JSON.stringify(extractSyncSettings(a)) !== JSON.stringify(extractSyncSettings(b))
}

import { describe, it, expect, vi } from 'vitest'
import { SyncService } from '../src/main/services/sync'
import { InMemorySeriesRepository } from '../src/main/services/series-repository'
import { buildSyncPayload } from '../src/main/services/sync-payload'
import { defaultSettings } from '../src/shared/settings'

function make(remoteText: string | null) {
  const repo = new InMemorySeriesRepository()
  let settings = defaultSettings()
  let stamp = 1
  const uploaded: string[] = []
  const drive = {
    download: async () => remoteText,
    upload: async (c: string) => { uploaded.push(c) }
  }
  const svc = new SyncService({
    repo,
    getSettings: () => settings,
    saveSettings: (s) => { settings = s },
    getSettingsUpdatedAt: () => stamp,
    setSettingsUpdatedAt: (t) => { stamp = t },
    isEnabled: () => true,
    onImported: () => {},
    drive: drive as any,
    authStatus: () => ({ authed: true, email: 'a@b.c' }),
    onChanged: () => {}
  })
  return { svc, repo, uploaded, getSettings: () => settings, getStamp: () => stamp }
}

describe('SyncService.syncNow', () => {
  it('merges remote into local and uploads merged', async () => {
    const remote = buildSyncPayload(
      [{ key: 'r1', seriesId: 'r1', url: 'u1', title: 'R', coverUrl: null, source: 'S', category: 'main', currentPage: 1, totalPages: 0, chapterLabel: null, chapterIndex: null, chapterTotal: null, status: 'planned', note: '', rating: null, tags: [], openedAt: 1, createdAt: 1, updatedAt: 2, deletedAt: null, favoritedAt: null }],
      { ...defaultSettings(), width_scale: 0.7 }, 100
    )
    const { svc, repo, uploaded, getSettings } = make(JSON.stringify(remote))
    const st = await svc.syncNow()
    expect(st.state).toBe('idle')
    expect(repo.get('r1')).not.toBeNull()
    expect(getSettings().width_scale).toBe(0.7)
    expect(uploaded).toHaveLength(1)
  })

  it('uploads local when remote is empty', async () => {
    const { svc, uploaded } = make(null)
    await svc.syncNow()
    expect(uploaded).toHaveLength(1)
  })

  it('sets error state on drive failure', async () => {
    const repo = new InMemorySeriesRepository()
    const svc = new SyncService({
      repo, getSettings: defaultSettings, saveSettings: () => {}, getSettingsUpdatedAt: () => 0,
      setSettingsUpdatedAt: () => {}, isEnabled: () => true, onImported: () => {},
      drive: { download: async () => { throw new Error('boom') }, upload: async () => {} } as any,
      authStatus: () => ({ authed: true, email: 'a@b.c' }), onChanged: () => {}
    })
    const st = await svc.syncNow()
    expect(st.state).toBe('error')
    expect(st.lastError).toContain('boom')
  })

  it('markSettingsChanged bumps the stamp so an older remote snapshot cannot overwrite a fresh local setting', async () => {
    const remote = buildSyncPayload([], { ...defaultSettings(), width_scale: 0.7 }, 100)
    const { svc, getSettings, getStamp } = make(JSON.stringify(remote))
    const localWidth = getSettings().width_scale
    svc.markSettingsChanged()
    const fresh = getStamp()
    expect(fresh).toBeGreaterThan(100)
    await svc.syncNow()
    expect(getSettings().width_scale).toBe(localWidth)
    expect(getStamp()).toBe(fresh)
  })

  it('scheduleSync is a no-op when isEnabled() is false', async () => {
    vi.useFakeTimers()
    try {
      let downloads = 0
      const svc = new SyncService({
        repo: new InMemorySeriesRepository(),
        getSettings: defaultSettings, saveSettings: () => {},
        getSettingsUpdatedAt: () => 0, setSettingsUpdatedAt: () => {},
        isEnabled: () => false, onImported: () => {},
        drive: { download: async () => { downloads++; return null }, upload: async () => {} } as any,
        authStatus: () => ({ authed: true, email: 'a@b.c' }), onChanged: () => {}
      })
      svc.scheduleSync()
      vi.advanceTimersByTime(30_000)
      await Promise.resolve()
      expect(downloads).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

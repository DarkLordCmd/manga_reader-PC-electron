import { describe, it, expect } from 'vitest'
import { SyncService } from '../src/main/services/sync'
import { InMemorySeriesRepository } from '../src/main/services/series-repository'
import { buildSyncPayload } from '../src/main/services/sync-payload'
import { defaultSettings } from '../src/shared/settings'

function make(remoteText: string | null) {
  const repo = new InMemorySeriesRepository()
  let settings = defaultSettings()
  const uploaded: string[] = []
  const drive = {
    download: async () => remoteText,
    upload: async (c: string) => { uploaded.push(c) }
  }
  const svc = new SyncService({
    repo,
    getSettings: () => settings,
    saveSettings: (s) => { settings = s },
    getSettingsUpdatedAt: () => 1,
    drive: drive as any,
    authStatus: () => ({ authed: true, email: 'a@b.c' }),
    onChanged: () => {}
  })
  return { svc, repo, uploaded, getSettings: () => settings }
}

describe('SyncService.syncNow', () => {
  it('merges remote into local and uploads merged', async () => {
    const remote = buildSyncPayload(
      [{ key: 'r1', seriesId: 'r1', url: 'u1', title: 'R', coverUrl: null, source: 'S', category: 'main', currentPage: 1, totalPages: 0, chapterLabel: null, chapterIndex: null, chapterTotal: null, status: 'planned', note: '', rating: null, tags: [], openedAt: 1, createdAt: 1, updatedAt: 2, deletedAt: null }],
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
      drive: { download: async () => { throw new Error('boom') }, upload: async () => {} } as any,
      authStatus: () => ({ authed: true, email: 'a@b.c' }), onChanged: () => {}
    })
    const st = await svc.syncNow()
    expect(st.state).toBe('error')
    expect(st.lastError).toContain('boom')
  })
})

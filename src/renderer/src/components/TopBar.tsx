import { useEffect, useState } from 'react'
import type { EhLimitState } from '@shared/ipc'
import { useStore } from '../state/store'

export default function TopBar(): JSX.Element {
  const { screen } = useStore()
  const [limit, setLimit] = useState<EhLimitState | null>(null)
  const [, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    window.api.ehLimitsState().then((s) => { if (alive) setLimit(s) }).catch(() => {})
    const off = window.api.onEhLimitsChanged((s) => setLimit(s))
    return () => { alive = false; off() }
  }, [])

  const blocked = limit?.blocked ?? false
  useEffect(() => {
    if (!blocked) return
    const iv = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(iv)
  }, [blocked])

  const remainingSec = limit && limit.until > Date.now() ? Math.ceil((limit.until - Date.now()) / 1000) : 0

  return (
    <header className="topbar">
      {screen}
      {blocked && (
        <div className="eh-limit-banner">
          Лимит E-Hentai ({limit!.kind}) — сброс через {remainingSec} c
        </div>
      )}
    </header>
  )
}

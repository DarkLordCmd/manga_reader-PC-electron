import { useState } from 'react'

export default function LockScreen({ onUnlock }: { onUnlock: () => void }): JSX.Element {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [locked, setLocked] = useState(false)

  const tryPin = async (): Promise<void> => {
    if (locked) return
    const ok = await window.api.pinVerifyPin(pin)
    if (ok) { onUnlock(); return }
    const r = await window.api.pinFailedAttempt()
    if (r.locked) {
      setLocked(true)
      setTimeout(() => setLocked(false), r.retryAfterSec * 1000)
      setError('')
      setPin('')
      return
    }
    setError('Неверный PIN')
    setPin('')
  }

  return (
    <div className="lock-screen">
      <div className="lock-card">
        <h3>PIN</h3>
        <input
          type="password" inputMode="numeric" autoFocus
          value={pin} onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void tryPin() }}
          disabled={locked}
          maxLength={8}
        />
        {error && <div className="lock-error">{error}</div>}
        {locked && <div className="lock-error">Слишком много попыток — подожди 30 c</div>}
        <button disabled={locked} onClick={() => void tryPin()}>Unlock</button>
      </div>
    </div>
  )
}

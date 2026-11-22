import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from '../lib/errors';

/** "30 c" / "5 мин" — the lockout escalates to 5 min and 1 h, so a hard-coded
 * "30 c" told the user to wait thirty seconds when the real wait was an hour. */
function formatWait(sec: number): string {
  if (sec >= 60) {
    const m = Math.ceil(sec / 60);
    return `${m} мин`;
  }
  return `${sec} c`;
}

export default function LockScreen({ onUnlock }: { onUnlock: () => void }): JSX.Element {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retryIn, setRetryIn] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // The lockout is persisted in pin-lock.json and survives a restart. Without
  // this the screen started "unlocked", rejected the CORRECT pin and claimed
  // "Неверный PIN" — with no hint that the real wait was up to an hour.
  useEffect(() => {
    let alive = true;
    window.api
      .pinFailedAttempt()
      .then((r) => {
        if (alive && r.locked) setRetryIn(Math.max(1, r.retryAfterSec));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (retryIn <= 0) return;
    const t = setTimeout(() => setRetryIn((n) => Math.max(0, n - 1)), 1000);
    return () => clearTimeout(t);
  }, [retryIn]);

  // Give the field focus back after the countdown: autoFocus only runs on mount,
  // so after a lockout the user had to click the input before typing.
  useEffect(() => {
    if (retryIn === 0) inputRef.current?.focus();
  }, [retryIn]);

  const locked = retryIn > 0;

  const tryPin = useCallback(async () => {
    // In-flight guard: a double Enter used to count two failed attempts.
    if (busy || locked || pin.length === 0) return;
    setBusy(true);
    setError('');
    try {
      const ok = await window.api.pinVerifyPin(pin);
      if (ok) {
        onUnlock();
        return;
      }
      const r = await window.api.pinFailedAttempt();
      if (r.locked) setRetryIn(Math.max(1, r.retryAfterSec));
      else setError('Неверный PIN');
      setPin('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }, [busy, locked, pin, onUnlock]);

  return (
    <div className="lock-screen">
      <div className="lock-card">
        <h3>PIN</h3>
        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void tryPin();
          }}
          disabled={locked}
          maxLength={8}
        />
        {error && <div className="lock-error">{error}</div>}
        {locked && <div className="lock-error">Слишком много попыток — подожди {formatWait(retryIn)}</div>}
        <button disabled={locked || busy} onClick={() => void tryPin()}>
          {busy ? '…' : 'Unlock'}
        </button>
      </div>
    </div>
  );
}

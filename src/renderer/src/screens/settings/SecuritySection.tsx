import { errorText } from '../../lib/errors';
import { useEffect, useState } from 'react';
import Section, { Row } from './Section';

export default function SecuritySection(): JSX.Element {
  const [pinHas, setPinHas] = useState(false);
  const [pinCurrent, setPinCurrent] = useState('');
  const [pinNew, setPinNew] = useState('');
  const [pinMsg, setPinMsg] = useState<string | null>(null);

  useEffect(() => {
    window.api
      .pinHasPin()
      .then(setPinHas)
      .catch(() => setPinHas(false));
  }, []);

  /** Re-read the authoritative state after any failure: the old flow removed
   * the current PIN BEFORE trying to install the new one, so an invalid new PIN
   * left the app without a lock while the badge still said "включена". */
  const refreshHasPin = async (): Promise<void> => {
    try {
      setPinHas(await window.api.pinHasPin());
    } catch {
      /* keep the current state */
    }
  };

  const setNewPin = async (): Promise<void> => {
    setPinMsg(null);
    try {
      // The backend accepts only 6-8 digits (PinService.PIN_RE). The UI used to
      // allow 4-8, remove the old PIN, and then fail on setPin.
      if (!/^\d{6,8}$/.test(pinNew)) {
        setPinMsg('PIN должен быть 6–8 цифр');
        return;
      }
      if (pinHas) {
        if (!pinCurrent.trim()) {
          setPinMsg('Введи текущий PIN');
          return;
        }
        const ok = await window.api.pinVerifyPin(pinCurrent);
        if (!ok) {
          setPinMsg('Неверный текущий PIN');
          return;
        }
      }
      // setPin overwrites pin.json atomically — no delete-then-create window,
      // and the main process re-checks the current PIN itself.
      await window.api.pinSetPin(pinNew, pinHas ? pinCurrent : undefined);
      setPinHas(true);
      setPinMsg('PIN установлен');
      setPinCurrent('');
      setPinNew('');
    } catch (e: any) {
      setPinMsg(`Ошибка: ${errorText(e)}`);
      await refreshHasPin();
    }
  };

  const removePin = async (): Promise<void> => {
    setPinMsg(null);
    if (!pinCurrent.trim()) {
      setPinMsg('Введи текущий PIN');
      return;
    }
    const ok = await window.api.pinRemovePin(pinCurrent);
    if (ok) {
      setPinHas(false);
      setPinMsg('PIN удалён');
      setPinCurrent('');
    } else {
      setPinMsg('Неверный текущий PIN');
      await refreshHasPin();
    }
  };

  return (
    <Section title="Безопасность" desc="PIN запрашивается при запуске приложения.">
      <Row label="PIN-блокировка">
        <span className={`set-badge${pinHas ? ' on' : ''}`}>{pinHas ? 'включена' : 'не установлена'}</span>
      </Row>
      {pinHas && (
        <Row label="Текущий PIN">
          <input
            className="text-input narrow"
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={pinCurrent}
            onChange={(e) => setPinCurrent(e.target.value)}
          />
        </Row>
      )}
      <Row label={pinHas ? 'Новый PIN' : 'PIN'} note="6–8 цифр (цифры)">
        <input
          className="text-input narrow"
          type="password"
          inputMode="numeric"
          maxLength={8}
          value={pinNew}
          onChange={(e) => setPinNew(e.target.value)}
        />
        <button className="set-primary" onClick={() => void setNewPin()}>
          Установить
        </button>
        {pinHas && (
          <button className="set-danger" onClick={() => void removePin()}>
            Удалить PIN
          </button>
        )}
      </Row>
      {pinMsg && (
        <Row stack>
          <span className="set-note">{pinMsg}</span>
        </Row>
      )}
    </Section>
  );
}

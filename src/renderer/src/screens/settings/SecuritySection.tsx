import { useEffect, useState } from 'react';
import Section, { Row } from './Section';

export default function SecuritySection(): JSX.Element {
  const [pinHas, setPinHas] = useState(false);
  const [pinCurrent, setPinCurrent] = useState('');
  const [pinNew, setPinNew] = useState('');
  const [pinMsg, setPinMsg] = useState<string | null>(null);

  useEffect(() => {
    window.api.pinHasPin().then(setPinHas);
  }, []);

  const setNewPin = async (): Promise<void> => {
    setPinMsg(null);
    try {
      if (!/^\d{4,8}$/.test(pinNew)) {
        setPinMsg('PIN должен быть 4–8 цифр');
        return;
      }
      if (pinHas) {
        if (!/^\d{4,8}$/.test(pinCurrent)) {
          setPinMsg('Введи текущий PIN (4–8 цифр)');
          return;
        }
        const removed = await window.api.pinRemovePin(pinCurrent);
        if (!removed) {
          setPinMsg('Неверный текущий PIN');
          return;
        }
      }
      await window.api.pinSetPin(pinNew);
      setPinHas(true);
      setPinMsg('PIN установлен');
      setPinCurrent('');
      setPinNew('');
    } catch (e: any) {
      setPinMsg(`Ошибка: ${e?.message ?? e}`);
    }
  };

  const removePin = async (): Promise<void> => {
    setPinMsg(null);
    if (!/^\d{4,8}$/.test(pinCurrent)) {
      setPinMsg('Введи текущий PIN (4–8 цифр)');
      return;
    }
    const ok = await window.api.pinRemovePin(pinCurrent);
    if (ok) {
      setPinHas(false);
      setPinMsg('PIN удалён');
      setPinCurrent('');
    } else {
      setPinMsg('Неверный текущий PIN');
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
      <Row label={pinHas ? 'Новый PIN' : 'PIN'} note="4–8 цифр">
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

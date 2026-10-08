import { useEffect, useState } from 'react';
import Section from './Section';

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
    <Section title="Security">
      <div className="row">
        <label>PIN-блокировка приложения:</label>
        <span className="muted">{pinHas ? 'включена' : 'не установлен'}</span>
      </div>
      {pinHas && (
        <div className="row">
          <label>Текущий PIN:</label>
          <input
            className="text-input"
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={pinCurrent}
            onChange={(e) => setPinCurrent(e.target.value)}
          />
        </div>
      )}
      <div className="row">
        <label>Новый PIN (4–8 цифр):</label>
        <input
          className="text-input"
          type="password"
          inputMode="numeric"
          maxLength={8}
          value={pinNew}
          onChange={(e) => setPinNew(e.target.value)}
        />
        <button onClick={() => void setNewPin()}>Установить</button>
        {pinHas && <button onClick={() => void removePin()}>Удалить PIN</button>}
      </div>
      {pinMsg && <div className="row muted">{pinMsg}</div>}
    </Section>
  );
}

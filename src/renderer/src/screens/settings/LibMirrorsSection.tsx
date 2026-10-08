import { useState } from 'react';
import Section from './Section';
import type { LibMirrorStatus } from '@shared/ipc';
import type { SettingsCommon } from './useSettings';

const LIB_MIRRORS = ['img33.imgslib.link', 'img34.imgslib.link', 'img45.imgslib.link'];

export default function LibMirrorsSection({ settings, upd }: SettingsCommon): JSX.Element {
  const [libMirrorResults, setLibMirrorResults] = useState<LibMirrorStatus[] | null>(null);
  const [libMirrorMsg, setLibMirrorMsg] = useState<string | null>(null);

  return (
    <Section title="Lib зеркала">
      <div className="row">
        <label>Сервер изображений Lib:</label>
        <select
          value={settings.lib_image_server ?? ''}
          onChange={(e) => {
            upd({ lib_image_server: e.target.value || null });
            setLibMirrorMsg(null);
          }}
        >
          <option value="">Авто (как есть)</option>
          {LIB_MIRRORS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      <div className="row">
        <button
          onClick={async () => {
            setLibMirrorMsg('Проверяю зеркала…');
            try {
              setLibMirrorResults(await window.api.libMirrorsCheck());
            } finally {
              setLibMirrorMsg(null);
            }
          }}
        >
          Проверить зеркала
        </button>
      </div>
      {libMirrorResults && (
        <div className="check-list">
          {libMirrorResults.map((r) => (
            <div key={r.host} className={`check-result ${r.ok ? 'ok' : 'bad'}`}>
              {r.ok ? `✓ ${r.host} (${r.ms} мс)` : `✗ ${r.host} — ${r.error}`}
            </div>
          ))}
        </div>
      )}
      {libMirrorResults && (
        <div className="row">
          <button
            onClick={() => {
              const best = libMirrorResults.filter((r) => r.ok).sort((a, b) => a.ms - b.ms)[0];
              if (!best) {
                setLibMirrorMsg('Ни одно зеркало недоступно');
                return;
              }
              upd({ lib_image_server: best.host });
              setLibMirrorMsg(`Применено зеркало: ${best.host}`);
            }}
          >
            Применить лучший
          </button>
        </div>
      )}
      {libMirrorMsg && <div className="row muted">{libMirrorMsg}</div>}
    </Section>
  );
}

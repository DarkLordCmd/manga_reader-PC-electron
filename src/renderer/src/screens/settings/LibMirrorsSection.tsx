import { useState } from 'react';
import { errorText } from '../../lib/errors';
import Section, { Row } from './Section';
import type { LibMirrorStatus } from '@shared/ipc';
import type { SettingsCommon } from './useSettings';

const LIB_MIRRORS = ['img33.imgslib.link', 'img34.imgslib.link', 'img45.imgslib.link'];

export default function LibMirrorsSection({ settings, upd }: SettingsCommon): JSX.Element {
  const [libMirrorResults, setLibMirrorResults] = useState<LibMirrorStatus[] | null>(null);
  const [libMirrorMsg, setLibMirrorMsg] = useState<string | null>(null);

  return (
    <Section title="Зеркала Lib" desc="Сервер, с которого читалка берёт изображения Lib.">
      <Row label="Сервер изображений">
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
      </Row>
      <Row label="Доступность">
        <button
          onClick={async () => {
            setLibMirrorMsg('Проверяю зеркала…');
            try {
              setLibMirrorResults(await window.api.libMirrorsCheck());
              setLibMirrorMsg(null);
            } catch (e) {
              setLibMirrorMsg(`Ошибка проверки зеркал: ${errorText(e)}`);
            }
          }}
        >
          Проверить зеркала
        </button>
        {libMirrorResults && (
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
        )}
      </Row>
      {libMirrorResults && (
        <Row stack>
          <div className="check-list">
            {libMirrorResults.map((r) => (
              <div key={r.host} className={`check-result ${r.ok ? 'ok' : 'bad'}`}>
                {r.ok ? `✓ ${r.host} (${r.ms} мс)` : `✗ ${r.host} — ${r.error}`}
              </div>
            ))}
          </div>
        </Row>
      )}
      {libMirrorMsg && (
        <Row stack>
          <span className="set-note">{libMirrorMsg}</span>
        </Row>
      )}
    </Section>
  );
}

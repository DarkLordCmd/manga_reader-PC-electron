import { errorText } from '../../lib/errors';
import Section, { Row } from './Section';
import Toggle from '../../components/Toggle';
import type { SyncState } from '@shared/sync';
import type { GoogleState, SettingsCommon } from './useSettings';

interface Props extends SettingsCommon {
  google: GoogleState;
  setGoogle: (g: GoogleState) => void;
  syncState: SyncState;
  syncMsg: string | null;
  setSyncMsg: (m: string | null) => void;
}

export default function SyncSection({ settings, upd, google, setGoogle, syncState, syncMsg, setSyncMsg }: Props): JSX.Element {
  return (
    <Section title="Синхронизация (Google Drive)" desc="Библиотека и прогресс чтения в вашей папке Google Drive.">
      {!google.authed ? (
        <>
          <Row label="Аккаунт Google">
            <button
              className="set-primary"
              disabled={google.configured === false}
              onClick={async () => {
                setSyncMsg('Открываю окно входа Google…');
                try {
                  const r = await window.api.googleLogin();
                  setGoogle(r);
                  setSyncMsg('Вход выполнен');
                } catch (e: any) {
                  setSyncMsg(`Ошибка: ${errorText(e)}`);
                }
              }}
            >
              Войти через Google
            </button>
          </Row>
          {google.configured === false && (
            <Row stack>
              <span className="set-note">Google-вход отключён: GOOGLE_CLIENT_SECRET не задан при сборке.</span>
            </Row>
          )}
        </>
      ) : (
        <>
          <Row label="Аккаунт">
            <span className="set-value">{google.email || '—'}</span>
          </Row>
          <Row label="Последняя синхронизация">
            <span className="set-value">{syncState.lastSyncAt ? new Date(syncState.lastSyncAt).toLocaleString() : 'ещё не было'}</span>
          </Row>
          <Row label="Синхронизация">
            <Toggle checked={settings.sync_enabled} onChange={(v) => upd({ sync_enabled: v })} />
          </Row>
          <Row label="Авто-синхронизация">
            <Toggle checked={settings.sync_auto} onChange={(v) => upd({ sync_auto: v })} />
          </Row>
          <Row label="Действия">
            <button
              className="set-primary"
              disabled={syncState.state === 'syncing'}
              onClick={async () => {
                setSyncMsg('Синхронизирую…');
                try {
                  // syncNow resolves with the final state even on failure (the
                  // service catches its own errors), so "Готово" used to appear
                  // after a failed sync.
                  const st = await window.api.syncNow();
                  setSyncMsg(st.state === 'error' ? `Ошибка: ${st.lastError ?? 'не удалось синхронизировать'}` : 'Готово');
                } catch (e: any) {
                  setSyncMsg(`Ошибка: ${errorText(e)}`);
                }
              }}
            >
              {syncState.state === 'syncing' ? 'Синхронизация…' : 'Синхронизировать сейчас'}
            </button>
            <button
              className="set-danger"
              onClick={async () => {
                await window.api.googleLogout();
                setGoogle({ authed: false, email: null });
                setSyncMsg('Вы вышли из Google');
              }}
            >
              Выйти
            </button>
          </Row>
        </>
      )}
      {/* Only meaningful while an account is connected: after logout the stale
          "Не выполнен вход в Google" error was shown forever. */}
      {google.authed && syncState.lastError && (
        <Row stack>
          <span className="set-note">Ошибка синка: {syncState.lastError}</span>
        </Row>
      )}
      {syncMsg && (
        <Row stack>
          <span className="set-note">{syncMsg}</span>
        </Row>
      )}
    </Section>
  );
}

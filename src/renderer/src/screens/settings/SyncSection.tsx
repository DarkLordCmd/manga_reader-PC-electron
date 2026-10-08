import Section from './Section';
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
    <Section title="Синхронизация (Google Drive)">
      {!google.authed ? (
        <>
          <div className="row">
            <button
              disabled={google.configured === false}
              onClick={async () => {
                setSyncMsg('Открываю окно входа Google…');
                try {
                  const r = await window.api.googleLogin();
                  setGoogle(r);
                  setSyncMsg('Вход выполнен');
                } catch (e: any) {
                  setSyncMsg(`Ошибка: ${e?.message ?? e}`);
                }
              }}
            >
              Войти через Google
            </button>
          </div>
          {google.configured === false && (
            <div className="row muted">Google-вход отключён: GOOGLE_CLIENT_SECRET не задан при сборке.</div>
          )}
          <div className="row muted">Синхронизирует библиотеку и прогресс через вашу папку Google Drive.</div>
        </>
      ) : (
        <>
          <div className="row">
            <label>Аккаунт:</label>
            <span className="muted">{google.email || '—'}</span>
          </div>
          <div className="row">
            <label>Последняя синхронизация:</label>
            <span className="muted">{syncState.lastSyncAt ? new Date(syncState.lastSyncAt).toLocaleString() : 'ещё не было'}</span>
          </div>
          <div className="row">
            <Toggle checked={settings.sync_enabled} onChange={(v) => upd({ sync_enabled: v })}>
              Включить синхронизацию
            </Toggle>
          </div>
          <div className="row">
            <Toggle checked={settings.sync_auto} onChange={(v) => upd({ sync_auto: v })}>
              Авто-синхронизация
            </Toggle>
          </div>
          <div className="row">
            <button
              disabled={syncState.state === 'syncing'}
              onClick={async () => {
                setSyncMsg('Синхронизирую…');
                try {
                  await window.api.syncNow();
                  setSyncMsg('Готово');
                } catch (e: any) {
                  setSyncMsg(`Ошибка: ${e?.message ?? e}`);
                }
              }}
            >
              {syncState.state === 'syncing' ? 'Синхронизация…' : 'Синхронизировать сейчас'}
            </button>
            <button
              onClick={async () => {
                await window.api.googleLogout();
                setGoogle({ authed: false, email: null });
                setSyncMsg('Вы вышли из Google');
              }}
            >
              Выйти
            </button>
          </div>
        </>
      )}
      {syncState.lastError && <div className="row muted">Ошибка синка: {syncState.lastError}</div>}
      {syncMsg && <div className="row muted">{syncMsg}</div>}
    </Section>
  );
}

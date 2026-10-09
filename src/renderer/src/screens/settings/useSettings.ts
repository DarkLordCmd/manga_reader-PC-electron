import { useEffect, useState } from 'react';
import { useStore } from '../../state/store';
import type { Settings } from '@shared/settings';
import type { SyncState } from '@shared/sync';

export interface GoogleState {
  authed: boolean;
  email: string | null;
  configured?: boolean;
}

export interface SettingsCommon {
  settings: Settings;
  upd: (patch: Partial<Settings>) => void;
}

export function useSettings(): {
  settings: Settings;
  upd: (patch: Partial<Settings>) => void;
  google: GoogleState;
  setGoogle: (g: GoogleState) => void;
  syncState: SyncState;
  syncMsg: string | null;
  setSyncMsg: (m: string | null) => void;
} {
  const { settings, setSettings } = useStore();
  const [google, setGoogle] = useState<GoogleState>({ authed: false, email: null });
  const [syncState, setSyncState] = useState<SyncState>({
    state: 'idle',
    lastSyncAt: null,
    email: null,
    lastError: null,
  });
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  useEffect(() => {
    window.api.googleAuthStatus().then(setGoogle);
    window.api.syncGetState().then(setSyncState);
    return window.api.onSyncChanged(setSyncState);
  }, []);

  const upd = (patch: Partial<Settings>): void => setSettings({ ...settings, ...patch });

  return { settings, upd, google, setGoogle, syncState, syncMsg, setSyncMsg };
}

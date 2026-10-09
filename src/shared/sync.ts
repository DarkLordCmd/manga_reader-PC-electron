export interface SyncState {
  state: 'idle' | 'syncing' | 'error';
  lastSyncAt: number | null;
  email: string | null;
  lastError: string | null;
}

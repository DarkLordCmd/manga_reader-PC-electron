import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DownloadTask } from '@shared/downloads';

export type ChapterDownloadState = 'idle' | 'busy' | 'done' | 'error';

/** Tracks which chapters already sit in the download queue and exposes a
 * one-click "download this chapter" action. The queue lives in the main
 * process, so the state comes from `downloadsList` and is refreshed on every
 * `downloads:changed` broadcast. */
export function useChapterDownloads(): {
  stateOf: (url: string) => ChapterDownloadState;
  download: (url: string) => Promise<void>;
} {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  // Failures of the ADD call itself (IPC error); task failures are read from
  // the task list so they survive remounts and disappear once resumed.
  const [addFailed, setAddFailed] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      void window.api
        .downloadsList()
        .then((list) => {
          if (!cancelled) setTasks(list);
        })
        .catch(() => {});
    };
    load();
    // Use the broadcast payload instead of re-requesting the whole list: every
    // progress tick caused a second full downloadsList() round-trip and a
    // duplicate state update.
    const off = window.api.onDownloadsChanged((list) => setTasks(list));
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const byUrl = useMemo(() => {
    const m = new Map<string, DownloadTask>();
    for (const t of tasks) m.set(t.sourceUrl, t);
    return m;
  }, [tasks]);

  const download = useCallback(
    async (url: string): Promise<void> => {
      setBusy((prev) => new Set(prev).add(url));
      try {
        const existing = byUrl.get(url);
        if (existing?.state === 'error') {
          // Retry the SAME task: downloadsAdd would create a duplicate row for
          // an errored sourceUrl (the manager only dedups non-error tasks).
          await window.api.downloadsResume(existing.id);
        } else {
          await window.api.downloadsAdd(url);
        }
        setAddFailed((prev) => {
          if (!prev.has(url)) return prev;
          const next = new Set(prev);
          next.delete(url);
          return next;
        });
      } catch {
        setAddFailed((prev) => new Set(prev).add(url));
      } finally {
        setBusy((prev) => {
          const next = new Set(prev);
          next.delete(url);
          return next;
        });
      }
    },
    [byUrl],
  );

  const stateOf = useCallback(
    (url: string): ChapterDownloadState => {
      if (busy.has(url)) return 'busy';
      const task = byUrl.get(url);
      // A failed task is NOT "already downloaded": the old code put every task
      // URL into `queued`, so a crashed chapter showed the green ✓ forever.
      if (addFailed.has(url) || task?.state === 'error') return 'error';
      return task ? 'done' : 'idle';
    },
    [busy, addFailed, byUrl],
  );

  return { stateOf, download };
}

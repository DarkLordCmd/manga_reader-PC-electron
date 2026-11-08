import { useCallback, useEffect, useState } from 'react';

export type ChapterDownloadState = 'idle' | 'busy' | 'done' | 'error';

/** Tracks which chapters already sit in the download queue and exposes a
 * one-click "download this chapter" action. The queue lives in the main
 * process, so the state comes from `downloadsList` and is refreshed on every
 * `downloads:changed` broadcast. */
export function useChapterDownloads(): {
  stateOf: (url: string) => ChapterDownloadState;
  download: (url: string) => Promise<void>;
} {
  const [queued, setQueued] = useState<ReadonlySet<string>>(() => new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      void window.api.downloadsList().then((tasks) => {
        if (!cancelled) setQueued(new Set(tasks.map((t) => t.sourceUrl)));
      });
    };
    load();
    const off = window.api.onDownloadsChanged(() => load());
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const download = useCallback(async (url: string): Promise<void> => {
    setBusy((prev) => new Set(prev).add(url));
    try {
      await window.api.downloadsAdd(url);
      // `null` means the URL is already in the queue, which is still "done".
      setQueued((prev) => new Set(prev).add(url));
      setFailed((prev) => {
        if (!prev.has(url)) return prev;
        const next = new Set(prev);
        next.delete(url);
        return next;
      });
    } catch {
      setFailed((prev) => new Set(prev).add(url));
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(url);
        return next;
      });
    }
  }, []);

  const stateOf = useCallback(
    (url: string): ChapterDownloadState =>
      busy.has(url) ? 'busy' : failed.has(url) ? 'error' : queued.has(url) ? 'done' : 'idle',
    [busy, failed, queued],
  );

  return { stateOf, download };
}

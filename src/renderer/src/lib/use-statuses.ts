import { useEffect, useState } from 'react';
import type { ReadingStatus } from '@shared/library';
import { toStatusMap } from './status-map';

/** Reading-status lookup for screens whose cards are not LibraryItem rows
 * (History, Popular). Refreshes when the library changes. */
export function useReadingStatuses(): Record<string, ReadingStatus> {
  const [statuses, setStatuses] = useState<Record<string, ReadingStatus>>({});
  useEffect(() => {
    const refresh = (): void => {
      void window.api
        .libraryList({ status: 'all', includeR34: true })
        .then((items) => setStatuses(toStatusMap(items)))
        .catch(() => {
          /* badges are cosmetic — keep the previous map */
        });
    };
    refresh();
    return window.api.onLibraryChanged(refresh);
  }, []);
  return statuses;
}

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { thumbWindow } from '../screens/reader/thumbWindow';

interface Props {
  galleryId: string;
  pageCount: number;
  currentIndex: number;
  thumbSize: number;
  onSelect: (index: number) => void;
}

const WINDOW_HALF = 40;
// Approximate row height (image + padding + gap). Thumb heights are variable —
// drift only affects the placeholder spacers, not the current-button snapping.
const ROW = (thumbSize: number): number => thumbSize * 1.4 + 14;

/** Thumbnail with the same retry behaviour as a reader page. Before this a
 * transient 404 (Tor still bootstrapping, E-Hentai limit) left an empty frame
 * forever while the same page loaded fine in the main view. */
function ThumbImg({ galleryId, index }: { galleryId: string; index: number }): JSX.Element {
  const [attempt, setAttempt] = useState(0);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current != null) clearTimeout(timer.current);
    },
    [],
  );
  if (attempt > 4) return <div className="thumb-img-error" aria-hidden="true" />;
  return (
    <img
      key={attempt}
      src={`manga://page/${galleryId}/${index}?thumb=1${attempt ? `&r=${attempt}` : ''}`}
      alt={`${index + 1}`}
      loading="lazy"
      decoding="async"
      onError={() => {
        if (timer.current != null) clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setAttempt((a) => a + 1), 900);
      }}
    />
  );
}

/** Memoized thumb row: the panel re-renders on every reader page change, and
 * rebuilding ~80 rows + image components each time added a visible hitch to
 * scrolling. Only the two rows whose `current` flag changes actually re-render. */
const ThumbButton = memo(function ThumbButton({
  galleryId,
  index,
  isCurrent,
  thumbSize,
  onSelect,
  registerRef,
}: {
  galleryId: string;
  index: number;
  isCurrent: boolean;
  thumbSize: number;
  onSelect: (index: number) => void;
  registerRef: (index: number, el: HTMLButtonElement | null) => void;
}): JSX.Element {
  return (
    <button
      ref={(el) => registerRef(index, el)}
      className={`thumb${isCurrent ? ' current' : ''}`}
      onClick={() => onSelect(index)}
      style={{ width: thumbSize }}
    >
      <ThumbImg galleryId={galleryId} index={index} />
      <span>{index + 1}</span>
    </button>
  );
});

export default function ThumbnailPanel({ galleryId, pageCount, currentIndex, thumbSize, onSelect }: Props): JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState(0);
  // Stable identities for the memoized rows: an inline arrow for onSelect/refs
  // changes every render and would defeat the memo above.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const select = useCallback((i: number) => onSelectRef.current(i), []);
  const registerRef = useCallback((i: number, el: HTMLButtonElement | null) => {
    if (el) refs.current[i] = el;
    else delete refs.current[i];
  }, []);
  const clampIdx = Math.min(Math.max(0, currentIndex), Math.max(0, pageCount - 1));
  const clampIdxRef = useRef(clampIdx);
  clampIdxRef.current = clampIdx;
  const row = ROW(thumbSize);
  const w = thumbWindow(anchor, pageCount, WINDOW_HALF, row);

  // Scroll ONLY the thumb panel (not the reader body) so the current thumb is
  // centered vertically. Reads the CURRENT reader index via a ref so late
  // event handlers (image loads, settle timers) can never target a stale page.
  const center = (behavior: ScrollBehavior): void => {
    const panel = panelRef.current;
    const idx = clampIdxRef.current;
    const el = refs.current[idx];
    if (!panel || !el) return;
    const panelRect = panel.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const targetTop = Math.max(0, panel.scrollTop + (rect.top - panelRect.top) - (panel.clientHeight - rect.height) / 2);
    if (Math.abs(panel.scrollTop - targetTop) > 20) panel.scrollTo({ top: targetTop, behavior });
  };

  // Gallery (re)load: thumbnail images are not laid out yet, so a one-shot
  // recenter would no-op and the panel would keep the previous chapter's scroll
  // offset. Reset to the top, then one-shot retries (no persistent load
  // listener — that would fight manual scrolling and stale-closure yanks).
  useEffect(() => {
    const panel = panelRef.current;
    panel?.scrollTo({ top: 0, behavior: 'auto' });
    const timers = [120, 600, 1500].map((ms) => setTimeout(() => center('auto'), ms));
    return () => {
      for (const t of timers) clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galleryId, pageCount]);

  // Follow the reader index: move the window so the current thumb is rendered,
  // then recenter after the re-render (rAF) so the element exists.
  useEffect(() => {
    // nchor is the center of the virtual window. Subtracting the half\n    // window here too made the window end exactly at the current page, so\n    // the thumbnails below it (and after scrolling) were never rendered.\n    setAnchor(Math.max(0, clampIdx));
    const raf = requestAnimationFrame(() => center('auto'));
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, galleryId, pageCount]);

  // Drag the scrollbar: shift the virtual window to follow, but never yank the
  // panel back to the reader's current page. Only re-renders when the window
  // actually needs to move.
  const onScroll = (): void => {
    const panel = panelRef.current;
    if (!panel) return;
    const near = Math.floor(panel.scrollTop / row) + 1;
    if (near < w.from || near > w.to) setAnchor(Math.max(0, near));
  };

  const items: number[] = [];
  for (let i = w.from; i <= w.to && i >= 0; i++) items.push(i);

  return (
    <div className="thumb-panel" ref={panelRef} onScroll={onScroll}>
      {w.topPad > 0 && <div aria-hidden style={{ flex: '0 0 auto', height: w.topPad }} />}
      {items.map((i) => (
        <ThumbButton
          key={i}
          galleryId={galleryId}
          index={i}
          isCurrent={i === currentIndex}
          thumbSize={thumbSize}
          onSelect={select}
          registerRef={registerRef}
        />
      ))}
      {w.bottomPad > 0 && <div aria-hidden style={{ flex: '0 0 auto', height: w.bottomPad }} />}
    </div>
  );
}

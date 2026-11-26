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
  // Scroll events caused by our own centering must not be mistaken for the
  // user dragging the thumbnail scrollbar. Without this guard the initial
  // programmatic scroll to the saved page is read as "near page 1" and the
  // window jumps back to the top.
  const programmaticScroll = useRef(false);
  const programmaticTimer = useRef<number | null>(null);
  // Layout changes (top spacer, image heights) can emit scroll events while
  // the panel is being positioned for a restored page. Those are not user
  // scrolls and must not reset the virtual window to page 1.
  const suppressScroll = useRef(true);
  const suppressTimer = useRef<number | null>(null);
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
    if (Math.abs(panel.scrollTop - targetTop) > 20) {
      programmaticScroll.current = true;
      if (programmaticTimer.current != null) clearTimeout(programmaticTimer.current);
      programmaticTimer.current = window.setTimeout(() => {
        programmaticScroll.current = false;
        programmaticTimer.current = null;
      }, 600);
      panel.scrollTo({ top: targetTop, behavior });
    }
  };

  // Gallery (re)load: thumbnail images are not laid out yet, so a one-shot
  // recenter would no-op. Retry only a few times; there is no persistent load
  // listener that would fight manual scrolling.
  useEffect(() => {
    const timers = [120, 600, 1500].map((ms) => setTimeout(() => center('auto'), ms));
    return () => {
      for (const t of timers) clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galleryId, pageCount]);

  // Follow the reader index: move the window so the current thumb is rendered,
  // then recenter after the re-render (rAF) so the element exists.
  useEffect(() => {
    // `anchor` is the center of the virtual window. Subtracting the half
    // window here too made the window end exactly at the current page, so
    // thumbnails below it (and after scrolling) were never rendered.
    setAnchor(Math.max(0, clampIdx));
    suppressScroll.current = true;
    if (suppressTimer.current != null) clearTimeout(suppressTimer.current);
    suppressTimer.current = window.setTimeout(() => {
      suppressScroll.current = false;
      suppressTimer.current = null;
    }, 1000);
    const raf = requestAnimationFrame(() => center('auto'));
    const timers = [80, 300, 900].map((ms) => setTimeout(() => center('auto'), ms));
    return () => {
      cancelAnimationFrame(raf);
      for (const t of timers) clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, galleryId, pageCount]);

  // Drag the scrollbar: shift the virtual window to follow, but never yank the
  // panel back to the reader's current page. Only re-renders when the window
  // actually needs to move.
  const onScroll = (): void => {
    if (programmaticScroll.current || suppressScroll.current) return;
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

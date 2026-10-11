import { useEffect, useRef, useState } from 'react';
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

export default function ThumbnailPanel({ galleryId, pageCount, currentIndex, thumbSize, onSelect }: Props): JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const lastIndex = useRef<number | null>(null);
  const [anchor, setAnchor] = useState(0);
  const clampIdx = Math.min(Math.max(0, currentIndex), Math.max(0, pageCount - 1));
  const row = ROW(thumbSize);
  const w = thumbWindow(anchor, pageCount, WINDOW_HALF, row);

  // Scroll ONLY the thumb panel (not the reader body) so the current thumb is
  // centered vertically. Uses panel coordinates, so the scrollbar maps to the
  // real content regardless of the virtual spacers.
  const center = (behavior: ScrollBehavior): void => {
    const panel = panelRef.current;
    const el = refs.current[clampIdx];
    if (!panel || !el) return;
    lastIndex.current = clampIdx;
    const panelRect = panel.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const targetTop = Math.max(0, panel.scrollTop + (rect.top - panelRect.top) - (panel.clientHeight - rect.height) / 2);
    if (Math.abs(panel.scrollTop - targetTop) > 20) panel.scrollTo({ top: targetTop, behavior });
  };

  // Gallery (re)load: thumbnail images are not laid out yet, so a one-shot
  // recenter would no-op and the panel would keep the previous chapter's scroll
  // offset. Reset to the top and retry a few times while heights settle.
  useEffect(() => {
    lastIndex.current = null;
    setAnchor(Math.max(0, clampIdx - WINDOW_HALF));
    const panel = panelRef.current;
    panel?.scrollTo({ top: 0, behavior: 'auto' });
    const t1 = setTimeout(() => center('auto'), 120);
    const t2 = setTimeout(() => center('auto'), 600);
    const onLoad = (): void => center('auto');
    panel?.addEventListener('load', onLoad, true);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      panel?.removeEventListener('load', onLoad, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galleryId, pageCount]);

  // Follow the reader index: move the window so the current thumb is rendered,
  // then recenter after the re-render (rAF) so the element exists.
  useEffect(() => {
    setAnchor(Math.max(0, clampIdx - WINDOW_HALF));
    const raf = requestAnimationFrame(() => center('auto'));
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, galleryId, pageCount]);

  // Keep the "current" marker consistent with the reader while browsing.
  useEffect(() => {
    if (refs.current[clampIdx]) lastIndex.current = clampIdx;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampIdx, w.from]);

  // Drag the scrollbar: shift the virtual window to follow, but never yank the
  // panel back to the reader's current page. Only re-renders when the window
  // actually needs to move.
  const onScroll = (): void => {
    const panel = panelRef.current;
    if (!panel) return;
    const near = Math.floor(panel.scrollTop / row) + 1;
    if (near < w.from || near > w.to) setAnchor(Math.max(0, near - WINDOW_HALF));
  };

  const items: number[] = [];
  for (let i = w.from; i <= w.to && i >= 0; i++) items.push(i);

  return (
    <div className="thumb-panel" ref={panelRef} onScroll={onScroll}>
      {w.topPad > 0 && <div aria-hidden style={{ flex: '0 0 auto', height: w.topPad }} />}
      {items.map((i) => (
        <button
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className={`thumb${i === currentIndex ? ' current' : ''}`}
          onClick={() => onSelect(i)}
          style={{ width: thumbSize }}
        >
          <img src={`manga://page/${galleryId}/${i}`} alt={`${i + 1}`} loading="lazy" decoding="async" style={{ width: thumbSize }} />
          <span>{i + 1}</span>
        </button>
      ))}
      {w.bottomPad > 0 && <div aria-hidden style={{ flex: '0 0 auto', height: w.bottomPad }} />}
    </div>
  );
}

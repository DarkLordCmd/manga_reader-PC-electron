import { useEffect, useRef } from 'react';
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
  const clampIdx = Math.min(Math.max(0, currentIndex), Math.max(0, pageCount - 1));

  // Scroll ONLY the thumb panel (not the reader body) so the current thumb is
  // centered vertically. Using panel.scrollTo keeps other scroll ancestors
  // untouched, unlike scrollIntoView.
  const center = (behavior: ScrollBehavior): void => {
    const panel = panelRef.current;
    const el = refs.current[clampIdx];
    lastIndex.current = clampIdx;
    if (!panel || !el) return;
    const panelRect = panel.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const targetTop = panel.scrollTop + (rect.top - panelRect.top) - (panel.clientHeight - rect.height) / 2;
    const clamped = Math.max(0, targetTop);
    if (Math.abs(panel.scrollTop - clamped) > 40) panel.scrollTo({ top: clamped, behavior });
  };

  // Gallery (re)load: thumbnail images are not laid out yet, so a one-shot
  // recenter would no-op and the panel would keep the previous chapter's scroll
  // offset (the bottom). Reset to the top and retry a few times while the
  // thumbs grow their real heights.
  useEffect(() => {
    lastIndex.current = null;
    const panel = panelRef.current;
    panel?.scrollTo({ top: 0, behavior: 'auto' });
    const t1 = setTimeout(() => center('auto'), 120);
    const t2 = setTimeout(() => center('auto'), 600);
    const onImageLoad = (): void => center('auto');
    panel?.addEventListener('load', onImageLoad, true);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      panel?.removeEventListener('load', onImageLoad, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galleryId, pageCount]);

  // Live tracking: single-step scrolling follows smoothly, multi-page jumps
  // (thumbnail click, slider, chapter open with saved position) land instantly.
  useEffect(() => {
    const bigStep = lastIndex.current == null || Math.abs(clampIdx - lastIndex.current) > 2;
    center(bigStep ? 'auto' : 'smooth');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, galleryId, pageCount]);

  const w = thumbWindow(currentIndex, pageCount, WINDOW_HALF, ROW(thumbSize));
  const items: number[] = [];
  for (let i = w.from; i <= w.to && i >= 0; i++) items.push(i);

  return (
    <div className="thumb-panel" ref={panelRef}>
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

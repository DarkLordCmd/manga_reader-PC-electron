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
  const lastIndex = useRef<number | null>(null);
  useEffect(() => {
    const el = refs.current[Math.min(currentIndex, pageCount - 1)];
    if (!el) return;
    // Gallery (re)load / multi-page jumps land instantly on the target;
    // single-step scrolling follows smoothly.
    const bigStep = lastIndex.current == null || Math.abs(currentIndex - lastIndex.current) > 2;
    el.scrollIntoView({ block: 'center', behavior: bigStep ? 'auto' : 'smooth' });
    lastIndex.current = currentIndex;
  }, [currentIndex, galleryId, pageCount]);

  const w = thumbWindow(currentIndex, pageCount, WINDOW_HALF, ROW(thumbSize));
  const items: number[] = [];
  for (let i = w.from; i <= w.to && i >= 0; i++) items.push(i);

  return (
    <div className="thumb-panel">
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

import { useEffect, useRef } from 'react';

interface Props {
  galleryId: string;
  pageCount: number;
  currentIndex: number;
  thumbSize: number;
  onSelect: (index: number) => void;
}

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

  return (
    <div className="thumb-panel">
      {Array.from({ length: pageCount }, (_, i) => (
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
    </div>
  );
}

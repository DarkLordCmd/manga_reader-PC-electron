import { useRef } from 'react';
import PageImg from './PageImg';
import { spreadStart, spreadIndices } from '../screens/reader/viewMath';

interface Props {
  galleryId: string;
  pageCount: number;
  currentIndex: number;
  pagesPerScreen: number;
  direction: 'Ltr' | 'Rtl';
  onPrev: () => void;
  onNext: () => void;
}

/** Paged reader: tap zones, swipe, first-page-alone pairing (JHenTai-style
 * double-column spread where page 1 is shown alone so pairs stay coherent).
 *
 * Taps and swipes are both resolved from the pointer events on the container
 * — the browser then (re)fires a `click` on whichever child sat under the
 * cursor, so navigation must NOT live on onClick handlers, or a swipe that
 * ends over a tap-zone would advance twice. */
export default function BookView({ galleryId, pageCount, currentIndex, pagesPerScreen, direction, onPrev, onNext }: Props): JSX.Element {
  const press = useRef<{ x: number; y: number } | null>(null);

  const start = spreadStart(currentIndex, pageCount, pagesPerScreen);
  const indices = spreadIndices(start, pageCount, pagesPerScreen);
  const ordered = direction === 'Rtl' ? [...indices].reverse() : indices;
  const single = ordered.length === 1;

  const onPointerDown = (e: React.PointerEvent): void => {
    press.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent): void => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    // Swipe: horizontal movement beats tap and any vertical drift.
    if (Math.abs(dx) >= 60 && Math.abs(dx) >= Math.abs(dy)) {
      // LTR: swipe left = next; RTL: swipe left = prev (reverse reading).
      if ((direction === 'Rtl') === dx > 0) onNext();
      else onPrev();
      return;
    }
    // Tap: navigate by the zone the press started in (bottom 15% edge strips).
    const rect = e.currentTarget.getBoundingClientRect();
    const left = p.x < rect.left + rect.width * 0.15;
    const right = p.x > rect.right - rect.width * 0.15;
    if (left) (direction === 'Rtl' ? onNext : onPrev)();
    else if (right) (direction === 'Rtl' ? onPrev : onNext)();
  };

  return (
    <div className="book-view" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
      <div className="book-zone left" />
      <div className="book-pages">
        {ordered.map((i) => (
          <PageImg key={i} galleryId={galleryId} index={i} style={single ? { maxWidth: '100%' } : undefined} />
        ))}
      </div>
      <div className="book-zone right" />
    </div>
  );
}

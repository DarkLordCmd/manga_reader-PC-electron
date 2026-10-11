import { useEffect, useRef } from 'react';
import PageImg from './PageImg';

interface Props {
  galleryId: string;
  pageCount: number;
  widthScale: number;
  currentIndex: number;
  jumpTo: { index: number; offset: number } | null;
  webtoon?: boolean;
  onVisible: (index: number) => void;
  onVisiblePos?: (index: number, offsetPx: number) => void;
  onJumpDone: () => void;
}

/** Vertical continuous reader. Off-screen pages are virtualized by the
 * browser itself (content-visibility: auto) — images far from the viewport
 * are not rendered and not fetched, while the layout stays scrollable through
 * placeholder heights. */
export default function ScrollView({
  galleryId,
  pageCount,
  widthScale,
  currentIndex,
  jumpTo,
  webtoon,
  onVisible,
  onVisiblePos,
  onJumpDone,
}: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const jumpSettleRef = useRef<number | null>(null);
  const visibleRef = useRef<number | null>(null);

  // Report the vertical offset INSIDE the current (visible) webtoon page so
  // the reader can persist "mid-page" positions for tall strips.
  const reportPos = (): void => {
    const c = containerRef.current;
    if (!c || !onVisiblePos) return;
    const idx = visibleRef.current;
    if (idx == null) return;
    const item = itemRefs.current[idx];
    if (!item) return;
    const off = Math.max(0, Math.min(c.scrollTop - item.offsetTop, Math.max(0, item.clientHeight - 1)));
    onVisiblePos(idx, off);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          // Webtoon pages are often TALLER than the viewport, so `ratio > 0.5`
          // would never be reached and the page counter would stick. Treat any
          // page with a meaningful visible sliver as the current one.
          if (!en.isIntersecting || en.intersectionRatio <= 0.05) continue;
          const index = Number((en.target as HTMLElement).dataset.index);
          // During the settle window right after a programmatic jump the
          // observer still reports pre-scroll geometry — discard those so a
          // restored gallery cannot snap its highlight back to page 1.
          if (jumpSettleRef.current != null && Date.now() <= jumpSettleRef.current + 700) continue;
          visibleRef.current = index;
          onVisible(index);
        }
      },
      { root: container, threshold: [0.05] },
    );
    itemRefs.current.forEach((el) => el && observer.observe(el));
    const onScroll = (): void => reportPos();
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      container.removeEventListener('scroll', onScroll);
    };
  }, [pageCount, onVisible, onVisiblePos]);

  useEffect(() => {
    if (jumpTo == null) return;
    jumpSettleRef.current = Date.now();
    // NOTE: never call onJumpDone() here — clearing the jumpTo state would
    // re-run this effect and the cleanup would kill the hold instantly.
    const flush = (): void => {
      jumpSettleRef.current = Date.now();
      const target = itemRefs.current[jumpTo.index];
      const c = containerRef.current;
      if (!target || !c) return;
      // Restored webtoons may re-enter mid-page: land at offset within the
      // item, not only at its top.
      const want = target.offsetTop + (jumpTo.offset ?? 0);
      if (Math.abs(want - c.scrollTop) > 40) c.scrollTo({ top: want });
    };
    let n = 0;
    let cancel: () => void = () => {};
    const align = setInterval(() => {
      if (n++ >= 240) {
        cancel();
        return;
      } // 60 s safety cap, then user owns the scroll
      flush();
      if (import.meta.env.DEV && n <= 20)
        console.log('[debug] align', n, 'want=', itemRefs.current[jumpTo.index]?.offsetTop, 'cur=', containerRef.current?.scrollTop);
    }, 250);
    cancel = (): void => {
      clearInterval(align);
      window.removeEventListener('wheel', cancel);
      window.removeEventListener('touchmove', cancel);
    };
    window.addEventListener('wheel', cancel, { passive: true });
    window.addEventListener('touchmove', cancel, { passive: true });
    return cancel;
  }, [jumpTo]);

  return (
    <div className={`scroll-view${webtoon ? ' webtoon' : ''}`} ref={containerRef}>
      {Array.from({ length: pageCount }, (_, i) => (
        <div
          key={i}
          data-index={i}
          ref={(el) => {
            itemRefs.current[i] = el;
          }}
          className={`scroll-item${i === currentIndex ? ' current' : ''}`}
        >
          <PageImg galleryId={galleryId} index={i} style={{ width: `${Math.min(100, Math.round(widthScale * 100))}%` }} />
        </div>
      ))}
    </div>
  );
}

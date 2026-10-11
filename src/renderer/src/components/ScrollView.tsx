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
  // Guard window started ONCE when a jump begins (not refreshed by each align
  // tick) — otherwise the observer is blocked for as long as alignment runs.
  const jumpStartRef = useRef<number>(Date.now());

  // Content coordinate of an item: how far it sits from the top of the scroll
  // container's CONTENT, independent of any positioned ancestor (offsetParent)
  // or content-visibility placeholder sizing. `container.scrollTop + rect.top -
  // containerRect.top` cancels the current scroll, so it is stable.
  const itemContentTop = (idx: number): number => {
    const c = containerRef.current;
    const el = itemRefs.current[idx];
    if (!c || !el) return 0;
    return c.scrollTop + el.getBoundingClientRect().top - c.getBoundingClientRect().top;
  };

  // Report the vertical offset INSIDE the current (visible) webtoon page so
  // the reader can persist "mid-page" positions for tall strips. Self-sufficient:
  // the dominant visible page is derived from live DOM geometry (cached), NOT
  // from the observer's async visibleRef — so the offset captures on any scroll
  // regardless of observer scheduling.
  const lastSeenRef = useRef<number | null>(null);
  const visiblePageIndex = (): number => {
    const c = containerRef.current;
    if (!c) return -1;
    const vTop = c.getBoundingClientRect().top;
    const vBot = vTop + c.clientHeight;
    const cached = lastSeenRef.current;
    const ce = cached != null ? itemRefs.current[cached] : null;
    if (ce && cached != null) {
      const r = ce.getBoundingClientRect();
      if (r.height > 0 && r.top < vBot && r.bottom > vTop) return cached;
    }
    let best = -1;
    let bestRatio = 0;
    for (let i = 0; i < itemRefs.current.length; i++) {
      const el = itemRefs.current[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom <= vTop || r.top >= vBot) continue;
      const vis = Math.min(r.bottom, vBot) - Math.max(r.top, vTop);
      const ratio = Math.max(0, vis) / Math.max(1, r.height);
      if (ratio > bestRatio) {
        bestRatio = ratio;
        best = i;
      }
    }
    lastSeenRef.current = best;
    return best;
  };

  const reportPos = (): void => {
    const c = containerRef.current;
    if (!c || !onVisiblePos) return;
    const idx = visiblePageIndex();
    if (idx < 0) return;
    const off = Math.max(0, c.scrollTop - itemContentTop(idx));
    onVisiblePos(idx, off);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // A freshly mounted gallery starts at the top: suppress the observer's
    // initial "page 1 is visible" report until the restore jump (if any) lands.
    jumpStartRef.current = Date.now();
    const observer = new IntersectionObserver(
      (entries) => {
        // Very tall webtoon pages fill the viewport only partially, so their
        // intersectionRatio can stay far below 0.05 forever — a fixed threshold
        // would never call them "visible" and both the page counter and the
        // mid-page offset get stuck. Pick the intersecting page with the
        // LARGEST ratio instead (the one that dominates the screen).
        let best: { ratio: number; index: number } | null = null;
        for (const en of entries) {
          if (!en.isIntersecting || en.intersectionRatio <= 0) continue;
          // During the settle window right after a programmatic jump the
          // observer still reports pre-scroll geometry — discard those so a
          // restored gallery cannot snap its highlight back to page 1.
          if (Date.now() <= jumpStartRef.current + 700) continue;
          const index = Number((en.target as HTMLElement).dataset.index);
          if (!best || en.intersectionRatio > best.ratio) best = { ratio: en.intersectionRatio, index };
        }
        if (best) {
          onVisible(best.index);
          // Capture the in-page offset on page transitions too (not only on
          // scroll events) — some environments suppress scroll events, and this
          // keeps the reader's current page + offset an atomic observation.
          const c = containerRef.current;
          if (c && onVisiblePos) onVisiblePos(best.index, Math.max(0, c.scrollTop - itemContentTop(best.index)));
        }
      },
      { root: container, threshold: [0] },
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
    jumpStartRef.current = Date.now();
    // NOTE: never call onJumpDone() here — clearing the jumpTo state would
    // re-run this effect and the cleanup would kill the hold instantly.
    const flush = (): void => {
      const target = itemRefs.current[jumpTo.index];
      const c = containerRef.current;
      if (!target || !c) return;
      // Restored webtoons may re-enter mid-page: land at offset within the
      // item, not only at its top. Same content-coordinate basis as reportPos.
      const want = itemContentTop(jumpTo.index) + (jumpTo.offset ?? 0);
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

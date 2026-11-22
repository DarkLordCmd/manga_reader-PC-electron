import { memo, useCallback, useEffect, useReducer, useRef, useState } from 'react';
import PageImg from './PageImg';
import { dominantVisiblePage, type PageInterval } from '../screens/reader/viewMath';
import { getImageDims, probeImageDims, subscribeImageDims } from '../screens/reader/image-dims';

/** One page row. Memoized: the reader re-renders on every page change, and
 * without this the whole chapter (hundreds of rows + images) re-rendered on
 * each scroll tick — that is what made continuous scrolling stutter. */
const ScrollItem = memo(function ScrollItem({
  galleryId,
  index,
  widthScale,
  isCurrent,
  intrinsicSize,
  eager,
  setRef,
}: {
  galleryId: string;
  index: number;
  widthScale: number;
  isCurrent: boolean;
  intrinsicSize: number;
  eager: boolean;
  setRef: (index: number, el: HTMLDivElement | null) => void;
}): JSX.Element {
  return (
    <div
      data-index={index}
      ref={(el) => setRef(index, el)}
      className={`scroll-item${isCurrent ? ' current' : ''}`}
      // Reserve the page's height structurally. The old approach relied on
      // content-visibility's intrinsic size only, which applies to SKIPPED
      // elements: a rendered-but-not-loaded page had zero height, so nothing
      // reserved its space, the document collapsed, and the browser's lazy-load
      // heuristic never considered the image close enough to start. min-height
      // fixes the layout and lets lazy loading work; for pages whose real
      // dimensions are known it equals the final height exactly (no jump).
      style={{ minHeight: intrinsicSize, containIntrinsicSize: `${intrinsicSize}px` }}
    >
      <PageImg
        galleryId={galleryId}
        index={index}
        eager={eager}
        style={{ width: `${Math.min(100, Math.round(widthScale * 100))}%` }}
      />
    </div>
  );
});

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
  /** Fired when the user scrolls themselves (not a programmatic align/reset):
   * the reader uses it to arm end-of-chapter auto-advance. */
  onUserScroll?: () => void;
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
  onUserScroll,
}: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const setItemRef = useCallback((index: number, el: HTMLDivElement | null) => {
    if (el) itemRefs.current[index] = el;
    else delete itemRefs.current[index];
  }, []);
  // Column width drives the placeholder height for not-yet-loaded pages.
  const [columnWidth, setColumnWidth] = useState(0);
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    setColumnWidth(c.clientWidth);
    const ro = new ResizeObserver(() => setColumnWidth(c.clientWidth));
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  // Re-render when a page's real dimensions become known (see image-dims).
  const [, bumpDims] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribeImageDims(bumpDims), []);

  // Look ahead for page sizes: known dimensions give an exact placeholder, so
  // the layout never changes when the image appears. Requests are background
  // priority (`thumb=1`) and hit the same page cache the reader uses anyway.
  useEffect(() => {
    if (!pageCount) return;
    const from = Math.max(0, currentIndex - 2);
    const to = Math.min(pageCount - 1, currentIndex + 10);
    for (let i = from; i <= to; i++) probeImageDims(galleryId, i);
  }, [galleryId, currentIndex, pageCount]);

  const boxPct = Math.max(1, Math.min(100, Math.round(widthScale * 100)));
  const boxWidthPx = (columnWidth * boxPct) / 100;
  // 1.45 ≈ a typical portrait manga page; unknown webtoon strips fall back to a
  // taller guess. Known pages use their exact ratio instead.
  const estimatePx = Math.max(200, Math.round(boxWidthPx * (webtoon ? 3 : 1.45)));
  const intrinsicFor = (index: number): number => {
    const d = getImageDims(galleryId, index);
    if (d) return Math.max(1, Math.round((boxWidthPx * d.h) / d.w));
    return estimatePx;
  };
  // Guard window started ONCE when a jump begins (not refreshed by each align
  // tick) — otherwise the observer is blocked for as long as alignment runs.
  const jumpStartRef = useRef<number>(Date.now());
  /** Until this timestamp, scroll events are our own programmatic alignment —
   * they must not be reported as user scrolling. */
  const progUntilRef = useRef(0);

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

  // Page the reader is actually looking at: the one covering the largest part
  // of the viewport (see dominantVisiblePage). Scanning is limited to the
  // neighbourhood of the last known page (a full scan of 300 rects on every
  // scroll tick would thrash layout) with a full fallback after a jump.
  const lastSeenRef = useRef<number | null>(null);
  const visiblePageIndex = (): number => {
    const c = containerRef.current;
    if (!c) return -1;
    const vTop = c.getBoundingClientRect().top;
    const vBot = vTop + c.clientHeight;
    const all = itemRefs.current;
    const rectOf = (i: number): PageInterval | null => {
      const el = all[i];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.height > 0 ? { top: r.top, bottom: r.bottom } : null;
    };
    const scan = (indexes: number[]): { index: number; pos: number } => {
      const rects: PageInterval[] = [];
      const map: number[] = [];
      for (const i of indexes) {
        const r = rectOf(i);
        if (!r) continue;
        map.push(i);
        rects.push(r);
      }
      const pos = dominantVisiblePage(rects, vTop, vBot);
      return { index: pos >= 0 ? map[pos] : -1, pos };
    };
    const cached = lastSeenRef.current;
    let found = { index: -1, pos: -1 };
    if (cached != null) {
      const near: number[] = [];
      for (let d = -2; d <= 2; d++) {
        const i = cached + d;
        if (i >= 0 && i < all.length) near.push(i);
      }
      found = scan(near);
    }
    if (found.index < 0) found = scan(all.map((_el, i) => i));
    lastSeenRef.current = found.index >= 0 ? found.index : null;
    return found.index;
  };

  const reportPos = (): number => {
    const c = containerRef.current;
    if (!c) return -1;
    const idx = visiblePageIndex();
    if (idx < 0 || !onVisiblePos) return idx;
    const off = Math.max(0, c.scrollTop - itemContentTop(idx));
    onVisiblePos(idx, off);
    return idx;
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // A freshly mounted gallery starts at the top: suppress the observer's
    // initial "page 1 is visible" report until the restore jump (if any) lands.
    jumpStartRef.current = Date.now();
    const observer = new IntersectionObserver(
      (entries) => {
        // The observer is only a trigger: entries contain CHANGED targets, not
        // everything on screen, so "the biggest ratio among them" can easily be
        // the previous page's remaining sliver. The dominant page is computed
        // from live geometry instead (same rule as the scroll handler).
        if (!entries.some((en) => en.isIntersecting && en.intersectionRatio > 0)) return;
        // During the settle window right after a programmatic jump the
        // observer still reports pre-scroll geometry — discard those so a
        // restored gallery cannot snap its highlight back to page 1.
        if (Date.now() <= jumpStartRef.current + 700) return;
        const idx = reportPos();
        if (idx >= 0) onVisible(idx);
      },
      { root: container, threshold: [0] },
    );
    itemRefs.current.forEach((el) => el && observer.observe(el));
    // Coalesce to one measurement per animation frame: a 120 Hz trackpad fired
    // 5-7 layout reads per event (and a full O(n) scan on a miss).
    let raf = 0;
    const onScroll = (): void => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        reportPos();
        // Programmatic alignment/reset scrolls are not user scrolling.
        if (Date.now() > progUntilRef.current) onUserScroll?.();
      });
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      container.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [pageCount, onVisible, onVisiblePos, onUserScroll]);

  // The scroll container survives a gallery change (same element, new pages),
  // so its scrollTop does too. Without this reset, opening the next chapter —
  // in particular the automatic advance at the end of a chapter — left the
  // viewport at the OLD chapter's bottom: the observer immediately reported the
  // last page, progress was flushed for a page never shown, and auto-advance
  // fired again, cascading through several chapters at once.
  useEffect(() => {
    jumpStartRef.current = Date.now();
    progUntilRef.current = Date.now() + 300;
    containerRef.current?.scrollTo({ top: 0 });
  }, [galleryId]);

  useEffect(() => {
    if (jumpTo == null) return;
    jumpStartRef.current = Date.now();
    let n = 0;
    let stable = 0;
    let done = false;
    const want = (): number => itemContentTop(jumpTo.index) + (jumpTo.offset ?? 0);
    const flush = (): void => {
      const c = containerRef.current;
      if (!c || !itemRefs.current[jumpTo.index]) return;
      // Restored webtoons may re-enter mid-page: land at offset within the
      // item, not only at its top. Same content-coordinate basis as reportPos.
      progUntilRef.current = Date.now() + 300;
      if (Math.abs(want() - c.scrollTop) > 40) c.scrollTo({ top: want() });
    };
    const finish = (): void => {
      if (done) return;
      done = true;
      clearInterval(align);
      window.removeEventListener('wheel', finish);
      window.removeEventListener('touchmove', finish);
      window.removeEventListener('keydown', finish);
      window.removeEventListener('pointerdown', finish);
      // One-shot jump: without clearing it, remounting ScrollView (mode switch)
      // re-applied an old jump and dragged the reader back to that page.
      onJumpDone();
    };
    const align = setInterval(() => {
      if (n++ >= 240) {
        finish();
        return;
      }
      flush();
      const c = containerRef.current;
      if (c && Math.abs(want() - c.scrollTop) <= 40) {
        if (++stable >= 2) finish();
      } else {
        stable = 0;
      }
    }, 250);
    // Any real interaction (wheel, touch, keyboard paging, scrollbar drag)
    // takes over from the align loop immediately instead of bouncing back.
    // A scroll event that we did not cause also counts: dragging the scrollbar
    // does not deliver pointer events to the page, so the loop used to fight it.
    const c = containerRef.current;
    const onDetachedScroll = (): void => {
      if (Date.now() > progUntilRef.current) finish();
    };
    c?.addEventListener('scroll', onDetachedScroll, { passive: true });
    window.addEventListener('wheel', finish, { passive: true });
    window.addEventListener('touchmove', finish, { passive: true });
    window.addEventListener('keydown', finish);
    window.addEventListener('pointerdown', finish);
    return () => {
      clearInterval(align);
      c?.removeEventListener('scroll', onDetachedScroll);
      window.removeEventListener('wheel', finish);
      window.removeEventListener('touchmove', finish);
      window.removeEventListener('keydown', finish);
      window.removeEventListener('pointerdown', finish);
    };
  }, [jumpTo, onJumpDone]);

  return (
    <div className={`scroll-view${webtoon ? ' webtoon' : ''}`} ref={containerRef}>
      {Array.from({ length: pageCount }, (_, i) => (
        <ScrollItem
          key={i}
          galleryId={galleryId}
          index={i}
          widthScale={widthScale}
          isCurrent={i === currentIndex}
          intrinsicSize={intrinsicFor(i)}
          eager={Math.abs(i - currentIndex) <= 2}
          setRef={setItemRef}
        />
      ))}
    </div>
  );
}

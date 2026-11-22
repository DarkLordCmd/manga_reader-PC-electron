import { useEffect, useRef, useState } from 'react';
import { recordImageDims } from '../screens/reader/image-dims';

interface Props {
  galleryId: string;
  index: number;
  className?: string;
  style?: React.CSSProperties;
  alt?: string;
  /** Load immediately instead of `lazy`. The page the user is looking at must
   * never depend on the browser's lazy-load heuristic (which needs a laid-out
   * box — before the image loads that box had zero height, so lazy images just
   * never started, leaving the reader blank until a re-assign). */
  eager?: boolean;
}

/** manga://page image with automatic retry: the protocol handler answers 404
 * for transient failures (network hiccup, rate limit) — remount with a fresh
 * cache-buster instead of leaving a broken picture. */
export default function PageImg({ galleryId, index, className, style, alt, eager }: Props): JSX.Element {
  const [attempt, setAttempt] = useState(0);
  const retryTimer = useRef<number | null>(null);

  useEffect(() => {
    setAttempt(0);
    // A pending retry from the previous page/gallery must not fire after the
    // remount reset — otherwise it steals an attempt from the new page.
    return () => {
      if (retryTimer.current != null) {
        clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
    };
  }, [galleryId, index]);

  if (attempt > 5) {
    return (
      <div className={`page-error${className ? ` ${className}` : ''}`} style={style}>
        <div>стр. {index + 1}</div>
        <button onClick={() => setAttempt(0)}>↻ повторить</button>
      </div>
    );
  }

  return (
    <img
      className={className}
      style={style}
      alt={alt ?? `page ${index + 1}`}
      key={attempt}
      data-index={index}
      // Lazy loading is what keeps the page queue sane: the scroll view renders
      // every page of the chapter, and without it the browser requested ALL of
      // them at once — 123 full images through Tor, ordered by whatever the
      // queue did with them. The visible window is loaded eagerly instead: lazy
      // loading cannot start while the page box has no height yet.
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      src={`manga://page/${galleryId}/${index}${attempt ? `?retry=${attempt}` : ''}`}
      onLoad={(e) => {
        // Remember the real size: the scroll view reserves exactly this height
        // for the page from now on (no 12 000 px jump when a webtoon strip loads).
        const img = e.currentTarget;
        recordImageDims(galleryId, index, img.naturalWidth, img.naturalHeight);
      }}
      onError={() => {
        // 404 on a transient failure: brief pause, then remount to retry —
        // nothing above the render tree re-triggers on its own.
        if (retryTimer.current != null) clearTimeout(retryTimer.current);
        retryTimer.current = window.setTimeout(() => setAttempt((a) => a + 1), 800);
      }}
    />
  );
}

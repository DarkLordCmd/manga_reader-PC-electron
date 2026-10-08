import { useEffect, useState } from 'react';

interface Props {
  galleryId: string;
  index: number;
  className?: string;
  style?: React.CSSProperties;
  alt?: string;
}

/** manga://page image with automatic retry: the protocol handler answers 404
 * for transient failures (network hiccup, rate limit) — remount with a fresh
 * cache-buster instead of leaving a broken picture. */
export default function PageImg({ galleryId, index, className, style, alt }: Props): JSX.Element {
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setAttempt(0);
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
      src={`manga://page/${galleryId}/${index}${attempt ? `?retry=${attempt}` : ''}`}
      onError={() => {
        // 404 on a transient failure: brief pause, then remount to retry —
        // nothing above the render tree re-triggers on its own.
        setTimeout(() => setAttempt((a) => a + 1), 800);
      }}
    />
  );
}

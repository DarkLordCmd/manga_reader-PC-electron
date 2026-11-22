import { useEffect, useRef, useState } from 'react';

interface Props {
  url: string | null | undefined;
  alt?: string;
  className?: string;
}

/** Cover image with retry. Onion covers requested before the bundled Tor is
 * ready fail once; remounting with a cache-buster lets a later attempt succeed
 * instead of leaving a permanently broken <img>. */
export default function CoverImg({ url, alt, className }: Props): JSX.Element {
  const [attempt, setAttempt] = useState(0);
  const retryTimer = useRef<number | null>(null);

  useEffect(() => {
    setAttempt(0);
    // A pending retry raised by the PREVIOUS cover must not fire after the url
    // changed (it would burn an attempt on the new cover, re-requesting it with
    // a needless cache-buster) and must not setState after unmount.
    return () => {
      if (retryTimer.current != null) {
        clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
    };
  }, [url]);

  if (!url) return <div className="cover-placeholder" />;
  // Three attempts instead of six * up to 90 s: a dead H@H host used to be
  // retried for minutes per cover, which stalled the whole grid (the browser
  // allows only ~6 cover connections at a time). The main process now answers
  // recent failures instantly and retries get shorter/more predictable.
  if (attempt > 2) return <div className="cover-placeholder" />;

  const src = `manga://cover/${encodeURIComponent(url)}${attempt ? `?r=${attempt}` : ''}`;
  return (
    <img
      key={attempt}
      className={className}
      src={src}
      alt={alt ?? ''}
      loading="lazy"
      onError={() => {
        if (retryTimer.current != null) clearTimeout(retryTimer.current);
        retryTimer.current = window.setTimeout(() => setAttempt((a) => a + 1), 1000 * (attempt + 1));
      }}
    />
  );
}

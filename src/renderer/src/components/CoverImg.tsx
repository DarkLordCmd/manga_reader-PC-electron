import { useEffect, useState } from 'react';

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

  useEffect(() => {
    setAttempt(0);
  }, [url]);

  if (!url) return <div className="cover-placeholder" />;
  if (attempt > 5) return <div className="cover-placeholder" />;

  const src = `manga://cover/${encodeURIComponent(url)}${attempt ? `?r=${attempt}` : ''}`;
  return (
    <img
      key={attempt}
      className={className}
      src={src}
      alt={alt ?? ''}
      loading="lazy"
      onError={() => setTimeout(() => setAttempt((a) => a + 1), 1000 * (attempt + 1))}
    />
  );
}

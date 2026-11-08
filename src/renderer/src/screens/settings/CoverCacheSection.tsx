import { useCallback, useEffect, useState } from 'react';
import Section, { Row } from './Section';
import type { SettingsCommon } from './useSettings';

export default function CoverCacheSection({ settings, upd }: SettingsCommon): JSX.Element {
  const [cacheInfo, setCacheInfo] = useState<{ files: number; bytes: number; maxBytes: number } | null>(null);
  const [cacheMb, setCacheMb] = useState(String(settings.cover_cache_mb));

  const refreshCacheInfo = useCallback(() => {
    void window.api
      .coverCacheInfo()
      .then(setCacheInfo)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshCacheInfo();
  }, [refreshCacheInfo]);
  useEffect(() => {
    setCacheMb(String(settings.cover_cache_mb));
  }, [settings.cover_cache_mb]);

  const clearCoverCache = async (): Promise<void> => {
    if (!window.confirm('Очистить кэш обложек? Обложки будут загружены заново.')) return;
    await window.api.coverCacheClear();
    refreshCacheInfo();
  };

  return (
    <Section title="Кэш обложек">
      <Row label="Максимальный размер">
        <input
          className="text-input narrow"
          type="number"
          min={16}
          max={8192}
          step={16}
          value={cacheMb}
          onChange={(e) => setCacheMb(e.target.value)}
          onBlur={() => {
            const n = Math.round(Number(cacheMb));
            const v = Number.isFinite(n) ? Math.max(16, Math.min(8192, n)) : 256;
            setCacheMb(String(v));
            if (v !== settings.cover_cache_mb) upd({ cover_cache_mb: v });
          }}
        />
        <span className="set-value">МБ</span>
      </Row>
      <Row
        label="Занято"
        note={cacheInfo ? `${(cacheInfo.bytes / 1048576).toFixed(1)} МБ · ${cacheInfo.files} файлов` : '—'}
      >
        <button onClick={() => void clearCoverCache()}>Очистить кэш</button>
      </Row>
    </Section>
  );
}

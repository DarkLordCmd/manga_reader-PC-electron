import { useState } from 'react';
import Section from './Section';
import type { CustomDnsStatus } from '@shared/ipc';
import type { SettingsCommon } from './useSettings';

// Display copy of the well-known blocker-circumvention DNS servers (main keeps
// its own copy in services/custom-dns.ts — node-only module).
const KNOWN_DNS_SERVERS: { name: string; server: string }[] = [
  { name: 'ComssDNS', server: '83.220.169.155' },
  { name: 'XboxDNS', server: '111.88.96.50' },
  { name: 'XboxDNS v2', server: '87.228.47.200' },
  { name: 'XboxDNS old', server: '176.99.11.77' },
  { name: 'MalwDNS', server: '84.21.189.133' },
];

export default function CustomDnsSection({ settings, upd }: SettingsCommon): JSX.Element {
  const [dnsResults, setDnsResults] = useState<CustomDnsStatus[] | null>(null);
  const [dnsMsg, setDnsMsg] = useState<string | null>(null);

  return (
    <Section title="DNS обхода блокировок">
      <div className="row">
        <label>DNS серверы:</label>
        <input
          style={{ flex: 1, minWidth: 220 }}
          value={settings.custom_dns ?? ''}
          placeholder="IPv4 или DoH-URL (https://…), через пробел/запятую"
          onChange={(e) => {
            upd({ custom_dns: e.target.value || null });
            setDnsResults(null);
          }}
        />
      </div>
      <div className="row">
        <button
          onClick={() => {
            upd({ custom_dns: KNOWN_DNS_SERVERS.map((k) => k.server).join(', ') });
            setDnsResults(null);
          }}
        >
          Вставить популярные
        </button>
        <button
          onClick={() => {
            upd({ custom_dns: 'https://dns.comss.ru/dns-query, https://cloudflare-dns.com/dns-query, https://dns.google/resolve' });
            setDnsResults(null);
          }}
        >
          DoH (зашифрованный)
        </button>
        <button
          disabled={!(settings.custom_dns ?? '').trim()}
          onClick={async () => {
            setDnsMsg('Проверяю DNS…');
            try {
              setDnsResults(await window.api.customDnsCheck());
            } finally {
              setDnsMsg(null);
            }
          }}
        >
          Проверить DNS
        </button>
      </div>
      {dnsResults && (
        <div className="check-list">
          {dnsResults.map((r) => (
            <div key={r.server} className={`check-result ${r.ok ? 'ok' : 'bad'}`}>
              {r.ok ? `✓ ${r.server} → ${r.ip} (${r.ms} мс)` : `✗ ${r.server} — не отвечает`}
            </div>
          ))}
        </div>
      )}
      {dnsMsg && <div className="row muted">{dnsMsg}</div>}
    </Section>
  );
}

import { useState } from 'react';
import { errorText } from '../../lib/errors';
import Section, { Row } from './Section';
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
    <Section title="DNS обхода блокировок" desc="Свои DNS-серверы или DoH-адреса вместо системных.">
      <Row label="DNS серверы" stack note="IPv4 или DoH-URL, через запятую или пробел.">
        <input
          className="text-input wide"
          value={settings.custom_dns ?? ''}
          placeholder="IPv4 или DoH-URL (https://…)"
          onChange={(e) => {
            upd({ custom_dns: e.target.value || null });
            setDnsResults(null);
          }}
        />
      </Row>
      <Row label="Пресеты">
        <button
          onClick={() => {
            upd({ custom_dns: KNOWN_DNS_SERVERS.map((k) => k.server).join(', ') });
            setDnsResults(null);
          }}
        >
          Популярные
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
          className="set-primary"
          disabled={!(settings.custom_dns ?? '').trim()}
          onClick={async () => {
            setDnsMsg('Проверяю DNS…');
            try {
              setDnsResults(await window.api.customDnsCheck());
              setDnsMsg(null);
            } catch (e) {
              setDnsMsg(`Ошибка проверки DNS: ${errorText(e)}`);
            }
          }}
        >
          Проверить DNS
        </button>
      </Row>
      {dnsResults && (
        <Row stack>
          <div className="check-list">
            {dnsResults.map((r) => (
              <div key={r.server} className={`check-result ${r.ok ? 'ok' : 'bad'}`}>
                {r.ok ? `✓ ${r.server} → ${r.ip} (${r.ms} мс)` : `✗ ${r.server} — не отвечает`}
              </div>
            ))}
          </div>
        </Row>
      )}
      {dnsMsg && (
        <Row stack>
          <span className="set-note">{dnsMsg}</span>
        </Row>
      )}
    </Section>
  );
}

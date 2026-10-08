import Section from './Section';
import Toggle from '../../components/Toggle';
import type { SettingsCommon } from './useSettings';

export default function PrivacySection({ settings, upd }: SettingsCommon): JSX.Element {
  return (
    <Section title="🔒 Приватность">
      <div className="row">
        <Toggle checked={settings.show_r34_history} onChange={(v) => upd({ show_r34_history: v })}>
          Показывать контент R34 (источники каталога, «Популярное», вкладки R34)
        </Toggle>
      </div>
    </Section>
  );
}

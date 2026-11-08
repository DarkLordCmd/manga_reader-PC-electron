import Section, { Row } from './Section';
import Toggle from '../../components/Toggle';
import type { SettingsCommon } from './useSettings';

export default function PrivacySection({ settings, upd }: SettingsCommon): JSX.Element {
  return (
    <Section title="Приватность">
      <Row
        label="Контент R34"
        note="Источники каталога, «Популярное» и вкладки R34 в истории, библиотеке и избранном."
      >
        <Toggle checked={settings.show_r34_history} onChange={(v) => upd({ show_r34_history: v })} />
      </Row>
    </Section>
  );
}

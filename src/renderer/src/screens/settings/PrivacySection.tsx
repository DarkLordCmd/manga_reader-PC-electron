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
        <Toggle ariaLabel="Контент R34" checked={settings.show_r34_history} onChange={(v) => upd({ show_r34_history: v })} />
      </Row>
      <Row
        label="Размывать 18+ обложки"
        note="Показывать обложки 18+ работ (каталог, библиотека, история, подсказки) размытыми. Сами изображения и чтение не меняются."
      >
        <Toggle ariaLabel="Размывать 18+ обложки" checked={settings.blur_adult_covers} onChange={(v) => upd({ blur_adult_covers: v })} />
      </Row>
    </Section>
  );
}

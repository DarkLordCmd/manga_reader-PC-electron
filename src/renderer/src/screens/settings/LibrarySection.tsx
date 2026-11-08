import Section, { Row } from './Section';
import Toggle from '../../components/Toggle';
import type { SettingsCommon } from './useSettings';

export default function LibrarySection({ settings, upd }: SettingsCommon): JSX.Element {
  return (
    <Section title="Библиотека">
      <Row label="Авто-добавление" note="Добавлять открытые галереи в библиотеку автоматически.">
        <Toggle checked={settings.library_auto_add} onChange={(v) => upd({ library_auto_add: v })} />
      </Row>
    </Section>
  );
}

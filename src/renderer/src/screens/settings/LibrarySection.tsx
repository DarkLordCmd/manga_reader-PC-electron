import Section from './Section';
import Toggle from '../../components/Toggle';
import type { SettingsCommon } from './useSettings';

export default function LibrarySection({ settings, upd }: SettingsCommon): JSX.Element {
  return (
    <Section title="Библиотека">
      <div className="row">
        <Toggle checked={settings.library_auto_add} onChange={(v) => upd({ library_auto_add: v })}>
          Авто-добавлять открытые галереи в библиотеку
        </Toggle>
      </div>
    </Section>
  );
}

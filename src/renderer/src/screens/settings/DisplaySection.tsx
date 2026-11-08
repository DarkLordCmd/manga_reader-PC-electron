import Section, { Row } from './Section';
import Toggle from '../../components/Toggle';
import type { SettingsCommon } from './useSettings';

export default function DisplaySection({ settings, upd }: SettingsCommon): JSX.Element {
  return (
    <Section title="Отображение">
      <Row label="Миниатюры в читалке">
        <Toggle checked={settings.show_thumbnails} onChange={(v) => upd({ show_thumbnails: v })} />
      </Row>
      <Row label="Размер миниатюр">
        <input
          type="range"
          min={60}
          max={200}
          step={5}
          value={settings.thumb_size}
          onChange={(e) => upd({ thumb_size: Number(e.target.value) })}
        />
        <span className="set-value">{settings.thumb_size} px</span>
      </Row>
    </Section>
  );
}

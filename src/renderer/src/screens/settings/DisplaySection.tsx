import Section from './Section';
import Toggle from '../../components/Toggle';
import type { SettingsCommon } from './useSettings';

export default function DisplaySection({ settings, upd }: SettingsCommon): JSX.Element {
  return (
    <Section title="Display">
      <div className="row">
        <Toggle checked={settings.show_thumbnails} onChange={(v) => upd({ show_thumbnails: v })}>
          Show thumbnails
        </Toggle>
      </div>
      <div className="row">
        <label>Thumbnail size: {settings.thumb_size}</label>
        <input
          type="range"
          min={60}
          max={200}
          step={5}
          value={settings.thumb_size}
          onChange={(e) => upd({ thumb_size: Number(e.target.value) })}
        />
      </div>
    </Section>
  );
}

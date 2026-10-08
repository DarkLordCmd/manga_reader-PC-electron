import Section from './Section';
import type { SettingsCommon } from './useSettings';

export default function ReadingSection({ settings, upd }: SettingsCommon): JSX.Element {
  return (
    <Section title="Reading">
      <div className="row">
        <label>Mode:</label>
        <select value={settings.reading_mode} onChange={(e) => upd({ reading_mode: e.target.value as 'Scroll' | 'Book' })}>
          <option value="Scroll">Scroll</option>
          <option value="Book">Book</option>
        </select>
      </div>
      {settings.reading_mode === 'Book' && (
        <>
          <div className="row">
            <label>Direction:</label>
            <select value={settings.book_direction} onChange={(e) => upd({ book_direction: e.target.value as 'Ltr' | 'Rtl' })}>
              <option value="Rtl">RTL (manga)</option>
              <option value="Ltr">LTR</option>
            </select>
          </div>
          <div className="row">
            <label>Pages per screen: {settings.pages_per_screen}</label>
            <input
              type="range"
              min={1}
              max={2}
              step={1}
              value={settings.pages_per_screen}
              onChange={(e) => upd({ pages_per_screen: Number(e.target.value) })}
            />
          </div>
          <div className="row">
            <label>Page margin: {settings.page_margin}</label>
            <input
              type="range"
              min={0}
              max={30}
              step={1}
              value={settings.page_margin}
              onChange={(e) => upd({ page_margin: Number(e.target.value) })}
            />
          </div>
        </>
      )}
      {settings.reading_mode === 'Scroll' && (
        <div className="row">
          <label>Width scale: {settings.width_scale.toFixed(2)}</label>
          <input
            type="range"
            min={0.3}
            max={1}
            step={0.01}
            value={settings.width_scale}
            onChange={(e) => upd({ width_scale: Number(e.target.value) })}
          />
        </div>
      )}
    </Section>
  );
}

import Section, { Row } from './Section';
import type { SettingsCommon } from './useSettings';

export default function ReadingSection({ settings, upd }: SettingsCommon): JSX.Element {
  return (
    <Section title="Чтение">
      <Row label="Режим">
        <select value={settings.reading_mode} onChange={(e) => upd({ reading_mode: e.target.value as 'Scroll' | 'Book' })}>
          <option value="Scroll">Лента</option>
          <option value="Book">Книга</option>
        </select>
      </Row>
      {settings.reading_mode === 'Book' && (
        <>
          <Row label="Направление">
            <select value={settings.book_direction} onChange={(e) => upd({ book_direction: e.target.value as 'Ltr' | 'Rtl' })}>
              <option value="Rtl">Справа налево (манга)</option>
              <option value="Ltr">Слева направо</option>
            </select>
          </Row>
          <Row label="Страниц на экран">
            <input
              type="range"
              min={1}
              max={2}
              step={1}
              value={settings.pages_per_screen}
              onChange={(e) => upd({ pages_per_screen: Number(e.target.value) })}
            />
            <span className="set-value">{settings.pages_per_screen}</span>
          </Row>
          <Row label="Поля страницы">
            <input
              type="range"
              min={0}
              max={30}
              step={1}
              value={settings.page_margin}
              onChange={(e) => upd({ page_margin: Number(e.target.value) })}
            />
            <span className="set-value">{settings.page_margin} px</span>
          </Row>
        </>
      )}
      {settings.reading_mode === 'Scroll' && (
        <Row label="Ширина страницы">
          <input
            type="range"
            min={0.3}
            max={1}
            step={0.01}
            value={settings.width_scale}
            onChange={(e) => upd({ width_scale: Number(e.target.value) })}
          />
          <span className="set-value">{Math.round(settings.width_scale * 100)}%</span>
        </Row>
      )}
    </Section>
  );
}

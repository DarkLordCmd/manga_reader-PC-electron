import Section, { Row } from './Section';
import Toggle from '../../components/Toggle';
import type { SettingsCommon } from './useSettings';

export default function CatalogSection({ settings, upd }: SettingsCommon): JSX.Element {
  return (
    <Section title="Каталог">
      <Row label="Бесконечная прокрутка">
        <Toggle ariaLabel="Бесконечная прокрутка" checked={settings.infinite_scroll} onChange={(v) => upd({ infinite_scroll: v })} />
      </Row>
      <Row label="Количество страниц NHentai" note="Показывать число страниц на карточках в каталоге NHentai.">
        <Toggle
          ariaLabel="Количество страниц NHentai"
          checked={settings.nhentai_show_page_counts}
          onChange={(v) => upd({ nhentai_show_page_counts: v })}
        />
      </Row>
    </Section>
  );
}

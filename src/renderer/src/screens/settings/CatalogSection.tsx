import Section from './Section';
import Toggle from '../../components/Toggle';
import type { SettingsCommon } from './useSettings';

export default function CatalogSection({ settings, upd }: SettingsCommon): JSX.Element {
  return (
    <Section title="Каталог">
      <div className="row">
        <Toggle checked={settings.infinite_scroll} onChange={(v) => upd({ infinite_scroll: v })}>
          Бесконечная прокрутка каталога
        </Toggle>
      </div>
      <div className="row">
        <Toggle checked={settings.nhentai_show_page_counts} onChange={(v) => upd({ nhentai_show_page_counts: v })}>
          Показывать количество страниц в каталоге NHentai
        </Toggle>
      </div>
    </Section>
  );
}

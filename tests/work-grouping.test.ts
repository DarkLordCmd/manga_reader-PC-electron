import { describe, it, expect } from 'vitest';
import { displayWorkTitle, groupLikelyWorks, likelySameWork, workSlugTokens } from '../src/shared/work-title';

const facultyRemanga = {
  url: 'https://remanga.org/manga/hero-high-school-dungeon-attack-department_/',
  title: 'Факультет зачистки подземелий',
};
const facultySenkuro = {
  url: 'https://senkuro.me/manga/warrior-high-school-dungeon-raid-department/',
  title: 'Академия воинов: Факультет рейдов на подземелья',
};

describe('cross-source work grouping', () => {
  it('matches different Russian titles by similar source slugs', () => {
    expect(likelySameWork(facultyRemanga, facultySenkuro)).toBe(true);
  });

  it('matches a title with a slash subtitle', () => {
    expect(
      likelySameWork(
        { url: 'https://mangalib.me/1--legendary-mechanic', title: 'Легендарный механик' },
        { url: 'https://remanga.org/manga/legendary-mechanic/', title: 'Легендарный механик / Chao Shi Legendary Mechanic' },
      ),
    ).toBe(true);
  });

  it('ignores malformed percent-encoding instead of aborting library grouping', () => {
    expect(workSlugTokens('https://remanga.org/manga/bad%slug/')).toEqual([]);
    expect(
      likelySameWork(
        { url: 'https://remanga.org/manga/bad%slug/', title: 'Работа с повреждённым slug' },
        { url: 'https://senkuro.me/manga/other-title/', title: 'Другая работа' },
      ),
    ).toBe(false);
  });

  it('does not merge unrelated works', () => {
    expect(
      likelySameWork(facultyRemanga, {
        url: 'https://senkuro.me/manga/mercenary-enrollment/',
        title: 'Прирождённый наёмник',
      }),
    ).toBe(false);
  });

  it('does not merge different untitled works by their placeholder title', () => {
    expect(
      likelySameWork(
        { url: 'https://remanga.org/manga/first-title/', title: 'Без названия' },
        { url: 'https://senkuro.me/manga/second-title/', title: 'Без названия' },
      ),
    ).toBe(false);
  });

  it('groups transitive duplicates into one card', () => {
    const groups = groupLikelyWorks([
      facultyRemanga,
      facultySenkuro,
      { url: 'https://remanga.org/manga/other-title/', title: 'Другое произведение' },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(2);
  });
});

describe('displayWorkTitle', () => {
  it('drops source suffixes and romanization', () => {
    expect(displayWorkTitle('Легендарный механик / Chao shen jixie shi читать мангу онлайн')).toBe('Легендарный механик');
    expect(displayWorkTitle('Обычное название')).toBe('Обычное название');
  });
});
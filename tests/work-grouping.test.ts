import { describe, it, expect } from 'vitest';
import { groupLikelyWorks, likelySameWork } from '../src/shared/work-title';

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

  it('does not merge unrelated works', () => {
    expect(
      likelySameWork(facultyRemanga, {
        url: 'https://senkuro.me/manga/mercenary-enrollment/',
        title: 'Прирождённый наёмник',
      }),
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

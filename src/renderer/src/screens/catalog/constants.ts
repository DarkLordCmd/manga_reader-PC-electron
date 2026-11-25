export const SOURCES: { key: string; label: string }[] = [
  { key: 'mangadex', label: 'MangaDex' },
  { key: 'exhentai', label: 'ExHentai' },
  { key: 'exhentai_onion', label: 'ExHentai (onion)' },
  { key: 'ehentai', label: 'E-Hentai' },
  { key: 'nhentai', label: 'NHentai' },
  { key: 'nhentai_onion', label: 'NHentai (onion)' },
  { key: 'comx', label: 'Com-X' },
  { key: 'senkuro', label: 'Senkuro' },
  { key: 'mangashi', label: 'Manga-shi' },
  { key: 'remanga', label: 'Remanga' },
  { key: 'mangalib', label: 'Mangalib' },
  { key: 'readmanga', label: 'Readmanga' },
  { key: 'mintmanga', label: 'Mintmanga' },
  { key: 'mangapoisk', label: 'Mangapoisk' },
  { key: 'mangamello', label: 'MangaMello' },
];

/** Sources hidden when the "show R34" privacy setting is off. */
export const R34_SOURCES = ['exhentai', 'exhentai_onion', 'ehentai', 'nhentai', 'nhentai_onion'];

export const SORTS: { key: string; label: string }[] = [
  { key: 'relevance', label: 'По релевантности' },
  { key: 'rating', label: 'По рейтингу' },
  { key: 'latestUploadedChapter', label: 'Последние' },
  { key: 'followedCount', label: 'По подпискам' },
];

export const MS_SORTS: [string, string][] = [
  ['', 'По умолчанию'],
  ['added', 'По дате добавления'],
  ['updated', 'По обновлению глав'],
  ['rating', 'По рейтингу'],
  ['popular', 'По популярности'],
  ['chapters', 'По количеству глав'],
  ['year', 'По году выпуска'],
];
export const MS_STATUS: [string, string][] = [
  ['', 'Все'],
  ['ONGOING', 'Онгоинг'],
  ['COMPLETED', 'Завершён'],
  ['HIATUS', 'Хиатус'],
];
export const MS_TYPES: [string, string][] = [
  ['', 'Все'],
  ['MANGA', 'Манга'],
  ['MANHWA', 'Манхва'],
  ['MANHUA', 'Маньхуа'],
  ['WESTERN', 'Западный комикс'],
  ['RUMANGA', 'Руманга'],
];
export const MS_PRESETS: [string, string][] = [
  ['new', 'Новинки с главами'],
  ['completed', 'Завершённые'],
  ['popular', 'Популярное сейчас'],
  ['for_you', 'Для вас'],
];

export const MS_YEARS: [string, string][] = [
  ['', 'Все годы'],
  ['2031', '2031'], ['2026', '2026'], ['2025', '2025'], ['2024', '2024'], ['2023', '2023'],
  ['2022', '2022'], ['2021', '2021'], ['2020', '2020'], ['2019', '2019'], ['2018', '2018'],
  ['2017', '2017'], ['2016', '2016'], ['2015', '2015'], ['2014', '2014'], ['2013', '2013'],
  ['2012', '2012'], ['2011', '2011'], ['2010', '2010'], ['2005', '2005'], ['2002', '2002'],
  ['1999', '1999'], ['1998', '1998'], ['1997', '1997'], ['1989', '1989'], ['1977', '1977'],
];

export const MS_BOOKMARK_STATUSES: [string, string][] = [
  ['READING', 'Читаю'],
  ['PLANNED', 'В планах'],
  ['DROPPED', 'Брошено'],
  ['COMPLETED', 'Прочитано'],
];

export const MS_AGES: [string, string][] = [
  ['', 'Все'],
  ['sfw', 'Без 18+'],
  ['adult', 'Только 18+'],
];

export const RM_ORDERING: [string, string][] = [
  ['views', 'По умолчанию (просмотры)'],
  ['-rating', 'По рейтингу ▼'],
  ['rating', 'По рейтингу ▲'],
  ['-views', 'По просмотрам ▼'],
  ['-id', 'По добавлению ▼'],
  ['id', 'По добавлению ▲'],
];
export const RM_STATUS: [string, string][] = [
  ['', 'Все'],
  ['1', 'Завершён'],
  ['2', 'Продолжается'],
  ['3', 'Заморожен'],
];
export const RM_TYPES: [string, string][] = [
  ['', 'Все'],
  ['1', 'Манга'],
  ['2', 'Манхва'],
  ['3', 'Маньхуа'],
  ['4', 'Западный комикс'],
  ['7', 'Другое'],
];

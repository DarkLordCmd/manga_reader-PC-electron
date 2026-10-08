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

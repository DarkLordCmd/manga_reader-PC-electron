export type ReadingStatus = 'reading' | 'planned' | 'completed' | 'on_hold' | 'dropped';

export const READING_STATUSES: ReadingStatus[] = ['reading', 'planned', 'completed', 'on_hold', 'dropped'];

export interface LibraryItem {
  key: string;
  seriesId: string;
  url: string;
  title: string;
  coverUrl: string | null;
  source: string;
  category: string;
  kind?: string | null;
  currentPage: number;
  totalPages: number;
  chapterLabel: string | null;
  chapterIndex: number | null;
  chapterTotal: number | null;
  status: ReadingStatus | null;
  note: string;
  rating: number | null;
  tags: string[];
  openedAt: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  favoritedAt: number | null;
}

export interface SeriesUpsert {
  key: string;
  seriesId: string;
  url: string;
  title: string;
  coverUrl: string | null;
  source: string;
  category: string;
  kind?: string | null;
  currentPage: number;
  totalPages: number;
  chapterLabel: string | null;
  chapterIndex: number | null;
  chapterTotal: number | null;
  openedAt?: number;
  createdAt?: number;
  deletedAt?: number | null;
  favoritedAt?: number | null;
}

export type LibrarySort = 'last_read' | 'title' | 'rating' | 'added';

export interface LibraryQuery {
  status?: ReadingStatus | 'all';
  search?: string;
  sort?: LibrarySort;
  includeR34?: boolean;
  category?: string;
  scope?: 'library' | 'favorites';
}

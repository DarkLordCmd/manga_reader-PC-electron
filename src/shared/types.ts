export type ReadingMode = 'Scroll' | 'Book';
export type BookDirection = 'Ltr' | 'Rtl';

export interface HistoryEntry {
  url: string;
  series_id: string;
  title: string;
  cover_url: string | null;
  source: string;
  chapter_label: string | null;
  chapter_index: number | null;
  chapter_total: number | null;
  current_page: number;
  total_pages: number;
  category: string;
  /** Work type (E-Hentai family category: «Doujinshi», «Manga», …). */
  kind?: string | null;
  opened_at: number;
}

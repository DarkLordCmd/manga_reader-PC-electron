export interface MangaCard {
  manga_id: string;
  title: string;
  cover_url: string | null;
  kind: string;
  score: number | null;
  tags: string[];
  /** contentRating is erotica/pornographic — mark the cover in non-R34 sources. */
  adult?: boolean;
}

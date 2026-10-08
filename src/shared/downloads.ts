export interface DownloadTask {
  id: string;
  title: string;
  sourceUrl: string;
  pageUrls: string[];
  archiveDownloadUrl?: string;
  headers: Record<string, string>;
  proxy?: string;
  outDir: string;
  state: 'queued' | 'running' | 'paused' | 'completed' | 'error';
  priority: number;
  completedPages: number[];
  totalPages: number;
  error?: string;
  addedAt: number;
  epoch?: number;
  mangaId?: string;
  chapterTotal?: number;
  newChapters?: number;
  latestChapterId?: string;
}

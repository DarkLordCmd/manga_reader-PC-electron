import { createHash } from 'crypto';

export interface LayoutChangeError extends Error {
  code: 'layout-changed';
  pageHash: string;
  sourceName: string;
  htmlHead: string;
}

export function assertLayout(markers: string[], html: string, sourceName: string): void {
  for (const m of markers) {
    if (html.includes(m)) return;
  }
  const pageHash = createHash('sha256').update(html).digest('hex').slice(0, 8);
  const htmlHead = html.slice(0, 300);
  const e: LayoutChangeError = Object.assign(
    new Error(`Парсер ${sourceName} сломался: сайт поменял вёрстку (page hash ${pageHash}). ` + 'Пришли разработчику этот хеш.'),
    { code: 'layout-changed' as const, pageHash, sourceName, htmlHead },
  );
  throw e;
}

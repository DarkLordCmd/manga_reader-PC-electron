import { z } from 'zod';
import { CH } from '@shared/ipc';
import type { RemangaImportResult, RemangaLoginResult } from '@shared/ipc';
import type { Settings } from '@shared/settings';
import { handleSafe } from './validate';
import { importRemangaBookmarks, remangaLogin, remangaAuthFromCookies, resolveRemangaAuth } from '../services/remanga-import';
import type { LibraryService } from '../services/library';
import type { HistoryManager } from '../services/history';
import type { SettingsService } from '../services/settings';
import type { SeriesRepository } from '../services/series-repository';
import { logger } from '../services/logger';

const loginInput = z.object({
  user: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(500),
});
const importOptions = z.object({
  limit: z.number().int().positive().max(5000).optional(),
});

export function registerRemangaImport(deps: {
  library: LibraryService;
  history: HistoryManager;
  settings: SettingsService;
  repo: SeriesRepository;
  broadcastLibrary(): void;
  broadcastSettingsChanged(s: Settings): void;
}): void {
  handleSafe(CH.remangaLogin, z.tuple([loginInput]), async (_e, input): Promise<RemangaLoginResult> => {
    const r = await remangaLogin(input.user, input.password);
    if (!r.ok || r.token == null || r.userId == null) return { ok: false, message: r.message };
    const next = { ...deps.settings.get() };
    next.remanga_token = r.token;
    next.remanga_user_id = r.userId;
    next.remanga_username = r.username ?? input.user;
    deps.settings.save(next);
    deps.broadcastSettingsChanged(deps.settings.get());
    logger.info('[remanga-import] logged in, user id', r.userId);
    return { ok: true, message: r.message, userId: r.userId, username: r.username ?? null };
  });

  handleSafe(CH.remangaImport, z.tuple([importOptions.optional()]), async (_e, opts): Promise<RemangaImportResult> => {
    const s = deps.settings.get();
    const auth = { token: s.remanga_token, cookies: s.remanga_cookies_raw };
    if ((!auth.token && !auth.cookies) || s.remanga_user_id == null) {
      return { ok: false, message: 'Сначала войдите в Remanga в настройках.', imported: 0, updated: 0, duplicates: 0 };
    }
    try {
      const resolved = await resolveRemangaAuth(auth);
      if (!resolved) {
        return { ok: false, message: 'Remanga: сессия недействительна — войдите заново.', imported: 0, updated: 0, duplicates: 0 };
      }
      const r = await importRemangaBookmarks(
        { library: deps.library, history: deps.history, repo: deps.repo },
        resolved.auth,
        resolved.id,
        opts ?? {},
      );
      deps.broadcastLibrary();
      const statusLabel: Record<string, string> = {
        reading: 'Читаю',
        planned: 'В планах',
        completed: 'Прочитано',
        on_hold: 'Отложено',
        dropped: 'Брошено',
        favorites: 'Любимое',
      };
      const statuses = Object.entries(r.byStatus)
        .map(([k, n]) => `${statusLabel[k] ?? k}: ${n}`)
        .join(', ');
      return {
        ok: true,
        message: `Импортировано из Remanga: ${r.imported}${r.updated ? `, обновлено: ${r.updated}` : ''}${r.duplicates ? `, дублей по названию: ${r.duplicates}` : ''}${statuses ? ` (${statuses})` : ''}.`,
        imported: r.imported,
        updated: r.updated,
        duplicates: r.duplicates,
      };
    } catch (e) {
      logger.warn('[remanga-import] failed', (e as Error)?.message ?? e);
      return { ok: false, message: `Remanga: ${(e as Error)?.message ?? e}`, imported: 0, updated: 0, duplicates: 0 };
    }
  });

  handleSafe(CH.remangaLogout, z.tuple([]), async () => {
    const next = { ...deps.settings.get() };
    next.remanga_token = '';
    next.remanga_cookies_raw = '';
    next.remanga_user_id = null;
    next.remanga_username = '';
    deps.settings.save(next);
    deps.broadcastSettingsChanged(deps.settings.get());
    return null;
  });
}

import { randomUUID } from 'crypto';
import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync, rmSync, renameSync } from 'fs';
import { join } from 'path';
import type { GalleryResolution } from './resolve-gallery';
import type { DownloadTask } from '@shared/downloads';
import { extractZipAll } from './zip-gallery';
import { writeFileAtomic } from './atomic-write';
import { logger } from './logger';
import { isSafeRemoteUrl } from './url-guard';

export type { DownloadTask };

export const PARALLEL = 3;
/** Page fetches in flight across ALL tasks. The task-level PARALLEL only ran
 * three tasks; a single 100-page chapter was fetched strictly page by page
 * (~1.5-2 s per page through Tor), so one chapter took minutes instead of
 * ~40 s. Four streams is a good Tor balance: enough to keep the circuit busy,
 * far from the concurrency that triggers resets. */
export const PAGE_PARALLEL = 4;

function extFromUrl(url: string): string {
  const m = url.split('?')[0].match(/\.(\w{2,5})$/);
  const ext = m?.[1]?.toLowerCase();
  if (ext && ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'].includes(ext)) return ext;
  return 'bin';
}

function slugify(title: string, id: string): string {
  const base =
    title
      // eslint-disable-next-line no-control-regex
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
      .trim()
      .slice(0, 60) || 'gallery';
  return `${base}-${id.slice(0, 8)}`;
}

/** Dedupe key for a source URL: same chapter with/without a trailing slash (or
 * a different host case) must be the same task. */
function normalizeSourceUrl(raw: string): string {
  const t = (raw ?? '').trim();
  try {
    const u = new URL(t);
    u.hash = '';
    return u.toString().replace(/\/+$/, '');
  } catch {
    return t.replace(/\/+$/, '').toLowerCase();
  }
}

type NativeTimer = (cb: () => void) => unknown;
const schedule = typeof setImmediate === 'function' ? setImmediate : setTimeout;

export class DownloadManager {
  private tasks: DownloadTask[] = [];
  private inFlight = 0;
  private waiters: (() => void)[] = [];
  private persistPath: string;
  /** Manager-wide page-fetch slots (see PAGE_PARALLEL). */
  private pageActive = 0;
  private pageWaiters: (() => void)[] = [];
  /** In-flight add() reservations by normalized URL — see add(). */
  private pendingAdds = new Set<string>();
  /** Progress writes are throttled: persisting+broadcasting on every page meant
   * 100 synchronous JSON rewrites and 100 renderer broadcasts per chapter. */
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private lastNotifyAt = 0;

  private async acquirePageSlot(): Promise<void> {
    if (this.pageActive < PAGE_PARALLEL) {
      this.pageActive++;
      return;
    }
    await new Promise<void>((resolve) => this.pageWaiters.push(resolve));
  }

  private releasePageSlot(): void {
    const next = this.pageWaiters.shift();
    if (next) next();
    else this.pageActive--;
  }

  constructor(
    private outDirBase: string,
    persistPath: string,
    private deps: {
      fetchBinary: (url: string, headers?: Record<string, string>, proxy?: string, timeoutMs?: number) => Promise<Uint8Array>;
      broadcast: (tasks: DownloadTask[]) => void;
    },
  ) {
    this.persistPath = persistPath;
    this.loadPersisted();
  }

  private persist(): void {
    try {
      // Atomic: persist() runs while pages download, so a crash mid-write
      // used to leave truncated JSON behind — and the next start read that as
      // "no downloads", dropping every queued/paused task. Compact (no indent):
      // indentation doubled the size of a file that is not human-edited.
      // 0600: task headers contain the live E-Hentai/nhentai Cookie header.
      writeFileAtomic(this.persistPath, JSON.stringify(this.tasks.map(({ epoch: _epoch, ...t }) => t)), { mode: 0o600 });
    } catch {
      /* ignore */
    }
  }

  private broadcastState(): void {
    this.deps.broadcast(this.tasks.map((t) => ({ ...t })));
  }

  private notify(): void {
    this.lastNotifyAt = Date.now();
    // State changes (add/pause/resume/remove/completed) are rare: persist now.
    this.persist();
    this.broadcastState();
  }

  /** Progress ticks happen after every downloaded page; rewriting a 300+ KB
   * downloads.json twice a second is wasted SSD I/O and blocks the main thread,
   * so the persist is coalesced (the broadcast stays at ~2/s for the UI). */
  private persistThrottled(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persist();
    }, 2000);
  }

  /** Page-progress notify: at most ~2 writes/second, with a trailing update so
   * the final page count still reaches the UI. State changes use notify(). */
  private notifyThrottled(): void {
    const elapsed = Date.now() - this.lastNotifyAt;
    if (elapsed >= 500) {
      this.lastNotifyAt = Date.now();
      this.broadcastState();
      this.persistThrottled();
      return;
    }
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.notifyThrottled();
    }, 500 - elapsed);
  }

  /** Moves an unreadable downloads.json aside before it gets overwritten with
   * an empty list, so the user (or support) can still recover it. */
  private quarantinePersist(reason: string): void {
    try {
      const aside = `${this.persistPath}.corrupt-${Date.now()}`;
      renameSync(this.persistPath, aside);
      logger.warn('[downloads] downloads.json повреждён —', reason, '; сохранён как', aside);
    } catch {
      /* best-effort */
    }
  }

  loadPersisted(): void {
    if (!existsSync(this.persistPath)) return;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.persistPath, 'utf-8'));
    } catch {
      this.quarantinePersist('не JSON');
      return;
    }
    if (!Array.isArray(raw)) {
      this.quarantinePersist('не массив задач');
      return;
    }
    // Validate each task: a single malformed entry used to throw inside .map,
    // which was caught as "empty list" and then immediately persisted over the
    // original file — the whole download queue vanished for good.
    this.tasks = raw
      .filter((t): t is DownloadTask => !!t && typeof t === 'object' && typeof (t as DownloadTask).id === 'string')
      .map((t) => {
        const pageUrls = Array.isArray(t.pageUrls) ? t.pageUrls.filter((u) => typeof u === 'string') : [];
        const outDir =
          typeof t.outDir === 'string' && t.outDir ? t.outDir : join(this.outDirBase, slugify(String(t.title ?? 'gallery'), t.id));
        return {
          ...t,
          title: typeof t.title === 'string' && t.title ? t.title : t.sourceUrl ?? 'Загрузка',
          pageUrls,
          completedPages: Array.isArray(t.completedPages) ? t.completedPages.filter((n) => Number.isInteger(n)) : [],
          headers: t.headers && typeof t.headers === 'object' ? t.headers : {},
          outDir,
          totalPages: Number.isInteger(t.totalPages) ? t.totalPages : pageUrls.length,
          priority: Number.isFinite(t.priority) ? t.priority : 0,
          addedAt: Number.isFinite(t.addedAt) ? t.addedAt : Date.now(),
          state: t.state === 'running' || t.state === 'queued' ? 'queued' : t.state,
          epoch: (t.epoch ?? 0) + 1,
        } as DownloadTask;
      });
    for (const t of this.tasks) {
      if (t.state !== 'queued') continue;
      // rescan outDir for already-downloaded pages
      try {
        if (existsSync(t.outDir)) {
          const have = new Set(readdirSync(t.outDir));
          t.completedPages = t.pageUrls.map((_u, i) => i).filter((i) => have.has(this.fileName(t, i)));
        }
      } catch {
        /* outDir vanished or unreadable — leave completedPages as persisted */
      }
    }
    if (this.tasks.some((t) => t.state === 'queued'))
      (schedule as NativeTimer)(() => {
        void this.pump();
      });
    this.notify();
  }

  fileName(t: DownloadTask, index: number): string {
    return `${String(index + 1).padStart(3, '0')}.${extFromUrl(t.pageUrls[index] ?? '')}`;
  }

  private nextQueued(): DownloadTask | null {
    const cands = this.tasks.filter((t) => t.state === 'queued');
    if (cands.length === 0) return null;
    cands.sort((a, b) => b.priority - a.priority || a.addedAt - b.addedAt);
    return cands[0];
  }

  private async pump(): Promise<void> {
    while (this.inFlight < PARALLEL) {
      const t = this.nextQueued();
      if (!t) break;
      t.state = 'running';
      this.inFlight++;
      void this.runTask(t)
        // A throw outside the task's own try blocks (mkdirSync on a detached
        // USB drive / full disk) used to leave the row "running" forever with an
        // unhandled rejection in the log: resume() only accepts paused|error,
        // and pump() waits for running.
        .catch((e: any) => {
          t.error = e?.message ?? String(e);
          t.state = 'error';
          this.notify();
        })
        .finally(() => {
          this.inFlight--;
          this.notify();
          void this.pump();
          if (this.inFlight === 0 && !this.tasks.some((x) => x.state === 'queued' || x.state === 'running')) {
            const ws = this.waiters;
            this.waiters = [];
            for (const w of ws) w();
          }
        });
    }
  }

  private async runArchiveTask(t: DownloadTask): Promise<void> {
    const epoch = t.epoch ?? 0;
    // Already extracted (e.g. the user paused during unpacking and resumed): the
    // signed E-Hentai archive link expires within hours, so do not fetch it again.
    if (t.pageUrls.length > 0 && t.completedPages.length >= t.totalPages) {
      if (t.state === 'running') t.state = 'completed';
      this.notify();
      return;
    }
    const zipPath = join(t.outDir, 'archive.zip');
    let buf: Uint8Array;
    try {
      buf = await this.deps.fetchBinary(t.archiveDownloadUrl ?? '', t.headers, t.proxy, 600_000);
    } catch (e: any) {
      if (t.epoch !== epoch) return;
      const msg = e?.message ?? String(e);
      t.error = /^HTTP 4\d\d/.test(msg) ? 'Ссылка на архив устарела (E-Hentai ссылок живёт несколько часов). Купи архив заново.' : msg;
      t.state = 'error';
      this.notify();
      return;
    }
    if (t.epoch !== epoch) return;
    if (t.state !== 'running') return;
    try {
      mkdirSync(t.outDir, { recursive: true });
      writeFileSync(zipPath, Buffer.from(buf));
    } catch (e: any) {
      t.error = `Не удалось сохранить архив: ${e?.message ?? String(e)}`;
      t.state = 'error';
      try {
        rmSync(zipPath, { force: true });
      } catch {
        /* best-effort */
      }
      this.notify();
      return;
    }
    this.notify();
    try {
      const written = await extractZipAll(zipPath, t.outDir);
      // Commit the extraction even if the user paused meanwhile: the bytes are
      // already on disk, and discarding them left a "Пауза 0/0" task whose only
      // recovery was re-downloading an archive link that had already expired.
      rmSync(zipPath, { force: true });
      written.sort();
      t.pageUrls = written;
      t.totalPages = written.length;
      t.completedPages = Array.from({ length: written.length }, (_v, i) => i);
      if (this.tasks.includes(t) && t.state === 'running') t.state = 'completed';
    } catch (e: any) {
      // A failed extraction used to leave archive.zip (hundreds of MB for an
      // E-Hentai archive) plus half-written pages that resume accepted by file
      // name. Clean both.
      try {
        rmSync(zipPath, { force: true });
        for (const f of readdirSync(t.outDir)) rmSync(join(t.outDir, f), { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
      if (t.epoch !== epoch) return;
      t.error = e?.message ?? String(e);
      t.state = 'error';
    }
    this.notify();
  }

  private async runTask(t: DownloadTask): Promise<void> {
    if (t.archiveDownloadUrl) return await this.runArchiveTask(t);
    const epoch = t.epoch ?? 0;
    try {
      mkdirSync(t.outDir, { recursive: true });
    } catch (e: any) {
      t.error = `Не удалось создать папку загрузки: ${e?.message ?? String(e)}`;
      t.state = 'error';
      this.notify();
      return;
    }
    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        if (t.state !== 'running' || t.epoch !== epoch) return;
        const i = next++;
        if (i >= t.pageUrls.length) return;
        if (t.completedPages.includes(i)) continue;
        await this.acquirePageSlot();
        try {
          // Re-check after waiting for a slot: the task may have been paused,
          // removed or resynced meanwhile.
          if (t.state !== 'running' || t.epoch !== epoch) return;
          if (!process.env.VITEST && !isSafeRemoteUrl(t.pageUrls[i])) throw new Error('Страница указывает на недопустимый (локальный) адрес');
          const buf = await this.deps.fetchBinary(t.pageUrls[i], t.headers, t.proxy, 60_000);          if (t.epoch !== epoch || t.state !== 'running') return;
          // Atomic page write: a crash mid-write must not leave a truncated file
          // that the resume scan (which only checks file names) would accept as
          // a complete page forever.
          writeFileAtomic(join(t.outDir, this.fileName(t, i)), Buffer.from(buf));
          if (!t.completedPages.includes(i)) {
            t.completedPages.push(i);
            t.completedPages.sort((a, b) => a - b);
          }
          this.notifyThrottled();
        } catch (e: any) {
          if (t.epoch !== epoch) return;
          t.error = e?.message ?? String(e);
          t.state = 'error';
          this.notify();
          return;
        } finally {
          this.releasePageSlot();
        }
      }
    };
    const workers = Array.from({ length: Math.min(PAGE_PARALLEL, t.pageUrls.length) }, () => worker());
    await Promise.all(workers);
    if (t.epoch !== epoch) return;
    if (t.state === 'running') t.state = 'completed';
    this.notify();
  }

  async add(
    sourceUrl: string,
    resolve: () => Promise<GalleryResolution>,
    headers: Record<string, string>,
    proxy?: string,
  ): Promise<DownloadTask | null> {
    const norm = normalizeSourceUrl(sourceUrl);
    // Reserve synchronously: the duplicate check and the push are separated by a
    // network resolve (seconds), so a double click used to start two tasks for
    // the same chapter (two folders, the whole chapter downloaded twice).
    if (this.pendingAdds.has(norm)) return null;
    if (this.tasks.some((t) => normalizeSourceUrl(t.sourceUrl) === norm && t.state !== 'error')) return null;
    this.pendingAdds.add(norm);
    let res: GalleryResolution;
    try {
      res = await resolve();
      if (!res || !Array.isArray(res.pageUrls) || res.pageUrls.length === 0) {
        throw new Error('Источник вернул пустой список страниц — скачивать нечего');
      }
    } catch (e) {
      this.pendingAdds.delete(norm);
      throw e;
    }
    const task: DownloadTask = {
      id: randomUUID(),
      title: res.title,
      sourceUrl,
      pageUrls: res.pageUrls,
      headers,
      proxy,
      outDir: join(this.outDirBase, slugify(res.title, randomUUID())),
      state: 'queued',
      priority: 0,
      completedPages: [],
      totalPages: res.pageUrls.length,
      addedAt: Date.now(),
      epoch: 0,
    };
    this.tasks.push(task);
    this.pendingAdds.delete(norm);
    this.notify();
    (schedule as NativeTimer)(() => {
      void this.pump();
    });
    return task;
  }

  addArchive(sourceUrl: string, title: string, downloadUrl: string, headers: Record<string, string>, proxy?: string): DownloadTask | null {
    if (this.tasks.some((t) => t.sourceUrl === sourceUrl && t.state !== 'error')) return null;
    const task: DownloadTask = {
      id: randomUUID(),
      title,
      sourceUrl,
      pageUrls: [],
      archiveDownloadUrl: downloadUrl,
      headers,
      proxy,
      outDir: join(this.outDirBase, slugify(title, randomUUID())),
      state: 'queued',
      priority: 0,
      completedPages: [],
      totalPages: 0,
      addedAt: Date.now(),
      epoch: 0,
    };
    this.tasks.push(task);
    this.notify();
    (schedule as NativeTimer)(() => {
      void this.pump();
    });
    return task;
  }

  adopt(task: DownloadTask): void {
    // Adopted tasks come from an imported backup: validate like loadPersisted,
    // otherwise an entry with outDir=undefined crashed mkdirSync later and left
    // a stuck "running" row.
    if (!task || typeof task !== 'object') return;
    if (typeof task.sourceUrl !== 'string' || !task.sourceUrl) return;
    if (typeof task.outDir !== 'string' || !task.outDir) return;
    if (!Array.isArray(task.pageUrls) || task.pageUrls.length === 0) return;
    if (this.tasks.some((t) => normalizeSourceUrl(t.sourceUrl) === normalizeSourceUrl(task.sourceUrl))) return;
    this.tasks.push({
      ...task,
      id: randomUUID(),
      pageUrls: task.pageUrls.filter((u) => typeof u === 'string'),
      completedPages: Array.isArray(task.completedPages) ? task.completedPages : [],
      headers: task.headers && typeof task.headers === 'object' ? task.headers : {},
      totalPages: Number.isInteger(task.totalPages) ? task.totalPages : task.pageUrls.length,
      priority: Number.isFinite(task.priority) ? task.priority : 0,
      addedAt: Number.isFinite(task.addedAt) ? task.addedAt : Date.now(),
      state: task.state === 'running' ? 'queued' : task.state,
    });
    this.notify();
    void this.pump();
  }

  pause(id: string): void {
    const t = this.tasks.find((x) => x.id === id);
    if (t && t.state === 'running') {
      t.state = 'paused';
      t.epoch = (t.epoch ?? 0) + 1;
      this.notify();
    }
  }

  resume(id: string): void {
    const t = this.tasks.find((x) => x.id === id);
    if (t && (t.state === 'paused' || t.state === 'error')) {
      t.state = 'queued';
      t.epoch = (t.epoch ?? 0) + 1;
      delete t.error;
      this.notify();
      (schedule as NativeTimer)(() => {
        void this.pump();
      });
    }
  }

  remove(id: string): void {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    if (t.state === 'running') {
      t.state = 'paused';
      t.epoch = (t.epoch ?? 0) + 1;
    }
    this.tasks = this.tasks.filter((x) => x.id !== id);
    this.notify();
  }

  async checkUpdates(urls: string[], resolve: (url: string) => Promise<GalleryResolution | null>): Promise<string[]> {
    const updated: string[] = [];
    for (const url of urls) {
      const t = this.tasks.find((x) => normalizeSourceUrl(x.sourceUrl) === normalizeSourceUrl(url) && x.state === 'completed');
      if (!t) continue;
      // Archive downloads already hold absolute extracted paths, not web page
      // URLs: re-resolving would compare apples to oranges (and re-download an
      // expired signed archive link).
      if (t.archiveDownloadUrl) continue;
      try {
        const res = await resolve(url);
        if (!res || !Array.isArray(res.pageUrls) || res.pageUrls.length === 0) continue;
        const same = res.pageUrls.length === t.pageUrls.length && res.pageUrls.every((u, i) => u === t.pageUrls[i]);
        if (same) continue;
        // Files are named by INDEX (001.jpg…). Only a pure append leaves the
        // existing indices valid; an insertion/reorder made the "ready" pages
        // point at the wrong images and the new page was never downloaded.
        const isAppend = res.pageUrls.length > t.pageUrls.length && t.pageUrls.every((u, i) => res.pageUrls[i] === u);
        if (!isAppend) t.completedPages = [];
        t.pageUrls = res.pageUrls;
        t.totalPages = res.pageUrls.length;
        t.state = 'queued';
        t.epoch = (t.epoch ?? 0) + 1;
        updated.push(t.id);
        (schedule as NativeTimer)(() => {
          void this.pump();
        });
      } catch {
        /* сеть/лимиты — пропускаем */
      }
    }
    if (updated.length > 0) this.notify();
    return updated;
  }

  setPriority(id: string, priority: number): void {
    const t = this.tasks.find((x) => x.id === id);
    if (t) {
      t.priority = priority;
      this.notify();
    }
  }

  setOutDirBase(dir: string): void {
    this.outDirBase = dir;
  }

  setChapterMeta(id: string, patch: { mangaId?: string; chapterTotal?: number; newChapters?: number; latestChapterId?: string }): void {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    Object.assign(t, patch);
    this.notify();
  }

  list(): DownloadTask[] {
    return this.tasks.map((t) => ({ ...t, completedPages: [...t.completedPages] }));
  }

  waitIdle(): Promise<void> {
    if (!this.tasks.some((t) => t.state === 'queued' || t.state === 'running')) return Promise.resolve();
    return new Promise((r) => this.waiters.push(r));
  }
}

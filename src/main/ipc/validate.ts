import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { z, type ZodType } from 'zod';
import { existsSync, statSync } from 'fs';
import { isAbsolute } from 'path';

const noNul = z
  .string()
  .min(1)
  .max(4096)
  .refine((p) => !p.includes('\0'), 'путь содержит NUL');
const absolutePath = noNul.refine((p) => isAbsolute(p), 'путь должен быть абсолютным');

/** Существующая папка либо .zip/.cbz-файл. */
export const existingDirOrArchive: ZodType<string> = absolutePath.refine((p) => {
  if (!existsSync(p)) return false;
  try {
    const st = statSync(p);
    if (st.isDirectory()) return true;
    return st.isFile() && /\.(zip|cbz)$/i.test(p);
  } catch {
    return false;
  }
}, 'путь должен быть существующей папкой или .zip/.cbz файлом');

/** http/https URL. */
export const httpUrl: ZodType<string> = z
  .string()
  .min(1)
  .max(8192)
  .refine((u) => {
    try {
      return /^https?:$/.test(new URL(u).protocol);
    } catch {
      return false;
    }
  }, 'URL должен быть http(s)');

/** Короткий токен dltype EH-архива (значения приходят с сайта: org/resample/…). */
export const dlTypeToken: ZodType<string> = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/, 'некорректный dltype');

/** Любая непустая строка (имена, id, url-тексты, заметки). */
export const anyString: ZodType<string> = z.string().max(65536);
/** Строка-идентификатор без управляющих символов. */
export const idString: ZodType<string> = z
  .string()
  .min(1)
  .max(1024)
  .refine((s) => !/[\x00-\x1f]/.test(s), 'содержит управляющие символы');
/** Неотрицательное целое. */
export const nonNegInt: ZodType<number> = z.number().int().min(0);
/** Шаблон объектов библиотеки/каталога — своя структура проверяется в service-слое. */
export function looseObject<T>(): ZodType<T> {
  return z.custom<T>((v) => !!v && typeof v === 'object' && !Array.isArray(v), 'ожидается объект');
}
/** Шаблон массива строк. */
export const stringArray: ZodType<string[]> = z.array(z.string()).max(10_000);

/** Обёртка ipcMain.handle с валидацией аргументов до вызова обработчика. */
export function handleSafe<T extends unknown[]>(
  channel: string,
  schema: ZodType<T>,
  handler: (event: IpcMainInvokeEvent, ...args: T) => unknown,
): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => i.message).join('; ');
      throw new Error(`Недопустимые аргументы для ${channel}: ${detail}`);
    }
    return handler(event, ...(parsed.data as T));
  });
}

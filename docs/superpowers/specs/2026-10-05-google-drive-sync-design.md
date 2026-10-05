# Синхронизация между устройствами через Google Drive — Design Spec

Дата: 2026-10-05
Статус: approved

Фича: вход по Google (OAuth 2.0, desktop/PKCE, зашитый Client ID), сессия хранится
через Electron `safeStorage`; синхронизация библиотеки/истории/прогресса/списка
загрузок и переносимых настроек между устройствами одного пользователя через
Google Drive (скрытая папка `appDataFolder`, один JSON-файл). Удаления
распространяются через tombstone.

## Требования (утверждено)

- **Модель синка:** один JSON-снапшот на Drive; слияние по `key` / `updatedAt`.
- **Состав:** библиотека (статусы/заметки/оценки/теги — таблица `series`), история и
  прогресс чтения, переносимые настройки чтения. **Исключено:** куки,
  аккаунты ExHentai, прокси, DNS, Tor, пути (`downloads_dir`, `last_folder`), PIN,
  **список загрузок** (см. «Вне рамок»: загрузки машинно-специфичны — локальные пути,
  прокси, headers и сами файлы).
- **OAuth:** зашитый общий Client ID (Desktop app, PKCE, без client secret), у
  пользователя одна кнопка «Войти через Google».
- **Триггеры:** авто при старте (pull+merge), после локальных изменений (debounce ~10 c),
  плюс кнопка «Синхронизировать сейчас».
- **Удаления:** tombstone (`deleted_at`) — удаление распространяется между устройствами.

## Предусловие

Требуется Google Cloud проект с OAuth consent screen и OAuth client типа **Desktop app**.
Client ID задаётся константой на этапе сборки (placeholder в репозитории + инструкция
в настройках). Client secret не используется. Consent screen допускается в режиме
Testing (до 100 аккаунтов; Google показывает «unverified»). Scope:
`openid email https://www.googleapis.com/auth/drive.appdata`.

## Ф-1: Google Auth (`src/main/services/google-auth.ts`)

- `GOOGLE_CLIENT_ID` — константа (placeholder, заменяется при сборке/настройке).
- `login(): Promise<{ email: string }>`:
  1. Локальный HTTP-сервер на `127.0.0.1:0` (эфемерный порт).
  2. PKCE: `code_verifier` (random 43–128), `code_challenge = base64url(sha256(verifier))`.
  3. Auth-URL: `https://accounts.google.com/o/oauth2/v2/auth` с `client_id`,
     `redirect_uri=http://127.0.0.1:<port>`, `response_type=code`, `scope=openid email
     https://www.googleapis.com/auth/drive.appdata`, `code_challenge`,
     `code_challenge_method=S256`, `access_type=offline`, `prompt=consent`.
  4. Открывает URL в модальном `BrowserWindow` (отдельная `session.fromPartition`, не
     затрагивает куки приложения). Пользователь входит; Google редиректит на loopback.
  5. Сервер ловит `code`, окно закрывается.
  6. Обмен на токены: POST `https://oauth2.googleapis.com/token`
     (`grant_type=authorization_code`, `code`, `code_verifier`, `client_id`, `redirect_uri`).
  7. Верификация email: `https://www.googleapis.com/oauth2/v3/userinfo`.
  8. Токены сохраняются: `{ refresh_token, access_token, expires_at, email }`.
- `getAccessToken(): Promise<string>` — авто-refresh
  (`grant_type=refresh_token`) при истечении (буфер 60 c).
- `status(): { authed: boolean; email: string | null }`.
- `logout(): Promise<void>` — revoke (`https://oauth2.googleapis.com/revoke?token=...`) и
  удаление хранилища.
- Хранилище токенов — `userData/google-auth.bin`, зашифровано `safeStorage`
  (`encryptString`/`decryptString`, DPAPI на Windows). Ошибки/таймауты выдают русские
  сообщения.

## Ф-2: Google Drive (`src/main/services/google-drive.ts`)

- Только `appDataFolder` (`spaces=appDataFolder`), один файл `manga-reader-sync.json`.
- `findSyncFile(): Promise<string | null>` — `files.list` с `q=name='manga-reader-sync.json'`.
- `download(): Promise<string | null>` — `files.get?alt=media` (null, если файла нет).
- `upload(content: string): Promise<void>` — `files.create` (multipart) либо
  `files.update` при наличии id.
- Все запросы с `Authorization: Bearer <access_token>`; 401 → один refresh+retry.

## Ф-3: Payload и слияние (`src/main/services/sync-payload.ts`, чистые функции)

```ts
export interface SyncPayload {
  format: 'manga-reader-sync'
  version: 1
  updatedAt: number
  series: LibraryItem[]          // включает tombstone (deletedAt != null)
  settings: SyncSettings         // только переносимые поля
  settingsUpdatedAt: number
}
export interface SyncSettings {
  reading_mode: 'Scroll' | 'Book'
  book_direction: 'Ltr' | 'Rtl'
  width_scale: number
  pages_per_screen: number
  page_margin: number
  infinite_scroll: boolean
  nhentai_show_page_counts: boolean
  show_thumbnails: boolean
  thumb_size: number
  show_r34_history: boolean
  library_auto_add: boolean
}
```

- `buildSyncPayload(local): SyncPayload` — собирает из `repo.allIncludingDeleted()`,
  текущих настроек (подмножество) и `settingsUpdatedAt` из sync-state.
- `mergeSyncPayload(local: SyncPayload, remote: SyncPayload): SyncPayload` — по каждому
  `key` побеждает свежий `updatedAt` (tombstone — тоже участник); настройки — снапшот с
  большим `settingsUpdatedAt`.
- `parseSyncPayload(text): SyncPayload` — валидация `format`/`version`, массивов,
  русские ошибки.
- `settingsUpdatedAt` хранится в `userData/sync-state.json` и обновляется при изменении
  любого поля `SyncSettings`; слияние берёт снапшот с большим значением.

## Ф-4: Tombstone и миграция схемы

- `series` + колонка `deleted_at INTEGER` (nullable). Миграция `PRAGMA user_version` 1→2:
  `ALTER TABLE series ADD COLUMN deleted_at INTEGER` (идемпотентно, в `db.ts`).
- `LibraryItem`/`SeriesUpsert` + поле `deletedAt: number | null`.
- `SeriesRepository.delete(key)` становится **мягким**: `deleted_at = now()`,
  `updated_at = now()` (строку не удаляем). Новый `hardDelete(key)` — физическое удаление
  (для очистки tombstone).
- `all()`/`get()`/`findByUrl()`/`list()`/`countByStatus()` исключают `deleted_at IS NOT
  NULL`. Специальный `allIncludingDeleted()` — для сборки payload.
- `clearHistory()` помечает tombstone'ами строки с `status IS NULL` (чтобы удаление
  истории распространялось), а не удаляет физически.
- `importItems()` учитывает `deletedAt` и сравнивает `updatedAt` (tombstone может
  «победить» живую запись).
- Очистка tombstone — вне рамок v1 (хранятся бессрочно; так удалённая запись не
  возвращается с устройства, которое давно не синкалось).

## Ф-5: Оркестрация (`src/main/services/sync.ts`)

- `syncNow()` (single-flight): статус `syncing` → `googleDrive.download()` →
  `mergeSyncPayload(local, remote)` → применить локально (`repo.importItems`,
  настройки) → `googleDrive.upload(merged)` → записать `lastSyncAt`, `status`.
- `syncOnStart()` — если `sync_enabled && authed`, вызвать `syncNow()` после `ready`.
- Debounced-авто: подписка на локальные изменения (библиотека/настройки/прогресс),
  debounce ~10 c, если `sync_auto`; пропуск во время активного `syncNow`.
- Ошибки сети/авторизации не роняют приложение: статус `error` + русское сообщение,
  повтор при следующем триггере.
- Состояние (`{ state: 'idle'|'syncing'|'error', lastSyncAt, email, lastError }`) —
  файл `userData/sync-state.json`, трансляция событием `sync:changed`.

## Ф-6: Настройки и UI

- `Settings` + `sync_enabled: boolean` (default false), `sync_auto: boolean` (default true).
- Секция «Синхронизация (Google Drive)» в `Settings.tsx`:
  - не залогинен: кнопка «Войти через Google» + подпись с предусловием (Client ID).
  - залогинен: email, «Последняя синхронизация», кнопка «Синхронизировать сейчас»,
    тумблеры «Авто-синхронизация», «Синхронизация включена», «Выйти».

## IPC / типы

- `src/shared/sync.ts`: `SyncStatus`, `SyncState`, `GoogleAuthStatus`.
- `src/shared/ipc.ts`: каналы `googleAuthStatus`, `googleLogin`, `googleLogout`,
  `syncNow`, `syncGetState`, событие `syncChanged`; методы в `Api`.

## Безопасность

- Client ID не является секретом; client secret отсутствует (PKCE).
- Refresh-token — только `safeStorage`; файл исключён из бэкапа и синка.
- Доступ только к `appDataFolder`; другие файлы пользователя недоступны.
- `logout()` ревокает токен на стороне Google.

## Тесты

- `sync-payload`: build/merge (новейший `updatedAt` побеждает, tombstone-wins, настройки
  по `settingsUpdatedAt`, merge загрузок), `parseSyncPayload` (валидация/русские ошибки).
- `google-auth`: PKCE (`code_verifier`/`challenge`), разбор loopback-URL, обработка
  error-параметра — чистые функции (сеть мокается).
- `google-drive`: mock fetch — create vs update, 401→refresh+retry.
- Tombstone в репозитории: `delete` скрывает из `list`, `allIncludingDeleted` видит,
  `importItems` с tombstone; миграция столбца.
- Реальный вход OAuth + Drive — **ручной smoke** (нужны credentials пользователя).

## Риски / ограничения

- Без Google Cloud OAuth client фича не работает; предусловие документируется.
- Consent screen в Testing → предупреждение «unverified»; при публичном релизе
  `drive.appdata` может требовать верификации.
- Одновременная правка одной записи на двух устройствах → выигрывает свежий `updatedAt`
  (потеря второй правки — обычный last-write-wins).
- Нет автотеста против реального Google API — только ручной smoke.
- Tombstone'ы занимают место до очистки (90 дней).

## Вне рамок (YAGNI)

- Синхронизация списка загрузок и файлов (машинно-специфично: локальные пути, прокси,
  headers, сами изображения) — v1 синхронизирует только библиотеку/историю/прогресс и
  переносимые настройки.
- Синк секретов (куки/аккаунты/прокси).
- Мультиаккаунтность Google (один аккаунт на установку).
- Серверный бэкенд/WebSocket-реалтайм.

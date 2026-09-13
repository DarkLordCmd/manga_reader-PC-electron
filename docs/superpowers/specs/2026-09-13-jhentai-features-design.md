# 7 фич из JHenTai — Design Spec

Дата: 2026-09-13
Статус: approved (подход A: единый download-домен в main, одна зависимость yauzl)

## 1. Менеджер загрузок

- `download-manager.ts` (main): очередь, 3 параллельных потока, приоритеты, пауза/резюм, дедуп по sourceUrl.
- Состояние: `userData/downloads.json` → восстановление после перезапуска.
- Задача: `{ id, title, sourceUrl, pageUrls, headers, proxy, outDir, state, priority, completedPages, totalPages }`.
- Страницы пишутся `NNN.<ext>`; резюм = скан outDir, докачка отсутствующих.
- Резолв галереи выносится из обработчика `openUrl` в общую `resolveGallery(url)`.
- IPC: `downloads:list/add/pause/resume/remove/clear/setPriority/checkUpdates`; событие `downloads:changed`.
- UI: экран Downloads (прогресс, pause/resume/priority/delete/open). Настройка `downloads_dir`.

## 2. Синхронизация обновлений

- Хранится pageCount на момент скачивания; `resolveGallery(sourceUrl)` при открытии и по кнопке → вырос → `state='update-available'`, докачка в тот же outDir.
- Для серий (MangaDex/Remanga/Senkuro) — diff глав.

## 3. Архивы

- Локальные .zip/.cbz через yauzl: lazy-стрим страниц в `userData/tmp/zip/`, natural-sort имён, tmp чистится при закрытии.
- EH-архивы: кнопка в BookView → `ehArchive:cost` → подтверждение → загрузка → автораспаковка в outDir. IPC: `ehArchive:cost/buy`.

## 4. Domain fronting

- Уже реализовано; доработка: актуализировать HOST2IPS из JHenTai.

## 5. Позиция чтения

- Использовать существующий `read_progress[url]` как startPage при openUrl/открытии скачанной галереи; кнопка сброса.

## 6. EH-лимиты (`eh-limits.ts`)

- `parseLimitResponse(text)` → kind: image-limit | usage-limit | sad-panda (+таймер сброса, если парсится).
- Глобальный блок: все EH/EX запросы сразу фейлятся с сообщением+таймером, без лишних запросов.
- Авто-переключение на другой аккаунт из ExAccounts, иначе тост с таймером + подсказка включить fronting/Tor.
- Баннер с обратным отсчётом в TopBar. Событие `eh-limits:changed`.

## 7. PIN-лок

- `pin.json` (userData, вне settings.json): sha256(salt+pin), 4–8 цифр, задержка 30с после 3 ошибок.
- LockScreen при старте поверх App; вкл/выкл в Settings (выкл требует текущий PIN).

## Тесты (vitest)

- download-manager: очередь/приоритеты/резюм (мок fetch, tmp).
- update-sync: diff pageCount.
- zip: lazy-стрим fake-zip.
- eh-limits: parse по HTML-фикстурам, переключение аккаунта.
- pin: set/verify/remove.

## IPC-сводка

Новые каналы: `downloads:*`, `ehArchive:*`, `pin:hasPin/setPin/removePin/verifyPin`.
События: `downloads:changed`, `eh-limits:changed`.

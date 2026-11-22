# Rust-порт парсера листинга E-Hentai (эксперимент fast-anything)

Проверенный порт `parseExHentaiListing` из `src/main/services/sources/eh.ts` на Rust
(`scraper` + `url` + `regex`). Источник сгенерирован и проверен инструментом
[fast-anything](https://github.com/EL4CTEO/fast-anything) v0.7.0.

## Что проверено

- `fast-anything verify` — **91/91** вызовов совпали с JS (10 записанных + 81 производный
  edge-case: обрезанный HTML, пустые строки, невалидные URL и т.д.).
- Скорость на строке листинга (синтетическая страница, структура реального EH):
  - 250 строк: **30.9 мс → 7.7 мс на вызов (4.0×)**;
  - 25 строк (реальный размер страницы каталога): **2.93 мс → 0.73 мс**, экономия ~2.2 мс;
  - лабораторный прогон 10 парсингов по 250 строк: **490 мс → 195 мс (2.5×)**.
- `fast-anything` рекомендовал порт сам: `parseExHentaiListing` занял 73.8% времени
  профилируемого участка (парсинг листинга в изоляции).

## Почему порт не включён в приложение

Экономия ~2 мс на страницу каталога — меньше 1% времени загрузки: каталог EH упирается
в сеть и Tor (сотни миллисекунд — секунды), а не в парсинг HTML. Сам fast-anything
советует не портировать функции меньше 2% прогона. Нативный `.node`-модуль добавил бы
Rust-тулчейн и платформенную сборку в `electron-builder` ради незаметного выигрыша,
поэтому в прод он не тащится; код оставлен как проверенный эксперимент.

Если всё же включать:

1. Собрать `.node`: `cargo build --release` в этой папке (нужен napi-rs; файл
   `target/release/eh_parser.dll` переименовать в `eh_parser.node`).
2. Положить рядом с приложением, добавить `extraResources` в electron-builder и
   `asarUnpack`.
3. В `eh.ts` грузить его через `createRequire`/`require` с путём
   `process.resourcesPath` (упакованное) / `app.getAppPath()` (dev) и вызывать с
   fallback на JS при любой ошибке.
4. Добавить дифференциальный тест: native vs JS на `tests/fixtures/eh-popular.html`
   и на страницах с 1/25/250 строк.

## Воспроизвести замеры

```sh
npm i -g @el4cteo/fast-anything tsx
# harness (в tools/fast-anything) собирается в CJS и профилируется:
npx esbuild tools/fast-anything/eh-listing-harness.ts --bundle --platform=node --format=cjs \
  --outfile=tools/fast-anything/harness.cjs --alias:electron=./tools/fast-anything/electron-stub.mjs \
  --external:better-sqlite3
fast-anything scan -- node tools/fast-anything/harness.cjs
fast-anything port <id>
# правим src/lib.rs (уже лежит здесь), затем:
fast-anything verify <id>
fast-anything enable <id>
fast-anything bench
```

`electron-stub.mjs` нужен только потому, что `eh.ts` транзитивно импортирует
`electron` (`user-agent.ts`), а харнесс запускается обычным Node.

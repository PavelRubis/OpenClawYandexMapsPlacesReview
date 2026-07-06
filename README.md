# OpenClaw Yandex Maps Places Review

Tool-плагин для OpenClaw, который собирает последние публичные отзывы заведения на Яндекс Картах через Playwright.

Плагин не использует API Яндекса. Он открывает публичную страницу заведения в браузере, переходит на страницу отзывов, пытается отсортировать отзывы по новизне и возвращает найденные отзывы в JSON.

## Возможности

- Tool `yandex_maps_place_reviews`.
- Принимает ссылку на заведение в Яндекс Картах.
- Возвращает последние `N` отзывов, по умолчанию `100`.
- Если отзывов меньше запрошенного количества или Яндекс перестал догружать список, возвращает доступные отзывы и warning.
- Для каждого отзыва возвращает `url`, если ссылку удалось извлечь, `date` и `text`.
- Поддерживает уровни логирования через config плагина.
- Есть обычные тесты, live-тест и headed live-тест с видимым браузером.

## Требования

- Node.js `22.19+`; рекомендуется Node.js `24`.
- npm.
- Playwright Chromium.

Проверьте версию Node:

```powershell
node --version
```

Если нужен portable Node на Windows, скачайте архив Node.js 24 с https://nodejs.org/dist/latest-v24.x/, распакуйте его в удобную директорию и добавьте эту директорию в `PATH` текущей сессии:

```powershell
$env:PATH="D:\Tools\node-v24.x.x-win-x64;$env:PATH"
node --version
npm --version
```

После этого все команды ниже можно выполнять как обычные `npm` / `npx`.

## Установка зависимостей

```powershell
npm install
npx cross-env PLAYWRIGHT_BROWSERS_PATH=0 playwright install chromium
```

## Сборка и проверки

```powershell
npm run build
npm test
npm run plugin:build
npm run plugin:validate
```

Полная локальная проверка:

```powershell
npm run verify
```

## Использование tool

Имя tool:

```text
yandex_maps_place_reviews
```

Параметры:

- `url` - ссылка на заведение в Яндекс Картах.
- `count` - необязательное количество последних отзывов, по умолчанию `100`, минимум `1`, максимум `500`.

Config плагина:

- `logLevel` - необязательный уровень логирования: `silent`, `error`, `warn`, `info`, `debug`.

Формат результата:

```json
{
  "sourceUrl": "https://yandex.ru/maps/org/example/123/reviews/",
  "requestedCount": 100,
  "fetchedAt": "2026-07-07T00:00:00.000Z",
  "reviews": [
    {
      "url": "https://yandex.ru/maps/org/example/123/reviews/abc",
      "date": "2026-07-06T12:00:00.000Z",
      "text": "Текст отзыва"
    }
  ],
  "stats": {
    "attempts": 1,
    "captchaReloads": 0,
    "scrolls": 1,
    "duplicatesSkipped": 0,
    "logLevel": "info"
  },
  "warnings": []
}
```

## Посмотреть output вручную

Headless-режим:

```powershell
$env:LOG_LEVEL='silent'
npm run run:tool -- "https://yandex.ru/maps/org/tri_vokzala_depo/168713437054/" 100
```

Видимый браузер:

```powershell
$env:HEADED='1'
$env:LOG_LEVEL='silent'
npm run run:tool -- "https://yandex.ru/maps/org/tri_vokzala_depo/168713437054/" 100
```

## Live-тесты

Headless live-тест:

```powershell
$env:YANDEX_MAPS_PLACE_URL="https://yandex.ru/maps/org/tri_vokzala_depo/168713437054/"
$env:YANDEX_MAPS_REVIEW_COUNT="100"
npm run test:live
```

Live-тест с видимым браузером:

```powershell
$env:YANDEX_MAPS_PLACE_URL="https://yandex.ru/maps/org/tri_vokzala_depo/168713437054/"
$env:YANDEX_MAPS_REVIEW_COUNT="100"
npm run test:headed
```

Обычный `npm test` не ходит в Яндекс и пропускает live-тест, если `YANDEX_MAPS_PLACE_URL` не задан.

## Структура проекта

- `src/Tools` - тонкие OpenClaw tool adapters.
- `src/Application` - DTO, dependency interfaces и tool call handlers.
- `src/Infrastructure` - Playwright collector, logging и clock implementations.
- `src/Composition` - сборка handlers и infrastructure.
- `src/Schemas` - TypeBox-схемы config и parameters.
- `src/Tests` - application, infrastructure, plugin и live scraper tests.
- `scripts/run-tool.ts` - ручной запуск collector-а и печать JSON output.

## Ограничения

- Плагин не решает CAPTCHA автоматически.
- Если Яндекс показывает challenge/CAPTCHA, collector замедляется, перезагружает страницу и пытается продолжить после последнего найденного отзыва.
- Если список перестал догружаться, collector возвращает уже найденные отзывы с warning.
- DOM Яндекс Карт может меняться, поэтому live-тесты вынесены отдельно от обычного набора тестов.

## Лицензия

MIT. См. [LICENSE](./LICENSE).

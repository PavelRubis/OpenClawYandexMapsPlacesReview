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
- OpenClaw `2026.6.11+` для установки плагина.
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

## Установка в OpenClaw

На Ubuntu установите плагин, Chromium и необходимые системные библиотеки:

```bash
openclaw plugins install npm:@sharleysoft/openclaw-yandex-maps-places-review
npx --yes @sharleysoft/openclaw-yandex-maps-places-review@latest setup --with-deps
openclaw plugins enable yandex-maps-places-review
openclaw plugins inspect yandex-maps-places-review --runtime --json
```

Setup-команду нужно запускать от того же Unix-пользователя, под которым работает OpenClaw Gateway: Playwright хранит Chromium в пользовательском cache. Флаг `--with-deps` устанавливает системные Linux-пакеты и может запросить `sudo`.

На Windows и macOS системные Linux-пакеты не нужны:

```powershell
openclaw plugins install npm:@sharleysoft/openclaw-yandex-maps-places-review
npx --yes @sharleysoft/openclaw-yandex-maps-places-review@latest setup
openclaw plugins enable yandex-maps-places-review
openclaw plugins inspect yandex-maps-places-review --runtime --json
```

Если Gateway не перезапустился автоматически, выполните:

```bash
openclaw gateway restart
```

Обновление плагина:

```bash
openclaw plugins update yandex-maps-places-review
npx --yes @sharleysoft/openclaw-yandex-maps-places-review@latest setup --with-deps
openclaw plugins inspect yandex-maps-places-review --runtime --json
```

После обновления setup-команда повторно проверяет и устанавливает Chromium, требуемый новой версией Playwright. На Windows и macOS используйте её без `--with-deps`.

## Локальная разработка

### Установка зависимостей

```powershell
npm install
npx cross-env PLAYWRIGHT_BROWSERS_PATH=0 playwright install chromium
```

### Сборка и проверки

```powershell
npm run build
npm run test:unit
npm run test:live
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

Поддерживаются как канонические ссылки вида `https://yandex.ru/maps/org/...`, так и share/POI-ссылки вида `https://yandex.com/maps/213/moscow/?mode=poi&poi%5Buri%5D=ymapsbm1%3A%2F%2Forg%3Foid%3D...&tab=reviews`.

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

После успешной проверки команда сохраняет полный JSON-результат в `artifacts/yandex-maps-reviews.headed.json`. Путь можно переопределить:

```powershell
$env:YANDEX_MAPS_OUTPUT_FILE="artifacts/my-place-reviews.json"
npm run test:headed
```

`npm test` запускает стабильные unit/component-тесты без обращения к Яндекс Картам. Live-проверка запускается отдельно через `npm run test:live` и запрашивает минимум 60 отзывов. `YANDEX_MAPS_PLACE_URL` и `YANDEX_MAPS_REVIEW_COUNT` позволяют переопределить страницу и количество; count для live-теста должен быть от 60 до 500. Недоступность сети, CAPTCHA или изменение DOM приводят к падению live-теста.

Live-тест является обязательным release gate: workflow не публикует npm-пакет и не создаёт GitHub Release, пока тест не завершится успешно.

## Выпуск новой версии

Release workflow запускается тегом, который должен точно совпадать с версией package и manifest:

```bash
npm version patch --no-git-tag-version
# Обновите version в openclaw.plugin.json тем же значением.
npm run verify
git add package.json package-lock.json openclaw.plugin.json
git commit -m "release: v0.1.1"
git tag v0.1.1
git push origin master --tags
```

Workflow на `ubuntu-latest` устанавливает Chromium, выполняет unit/component- и обязательный live-тест, валидирует manifest, устанавливает собранный `.tgz` через `npm-pack:`, публикует этот же проверенный архив в npm и только после этого создаёт GitHub Release.

Для самого первого выпуска, пока npm-пакет ещё не существует, Trusted Publisher настроить нельзя. Создайте временный granular npm token с разрешением publish и bypass 2FA, сохраните его как secret `NPM_TOKEN` в GitHub environment `npm` и создайте тег `v0.1.0`. После успешного workflow:

1. Настройте для npm-пакета Trusted Publisher: GitHub repository `PavelRubis/OpenClawYandexMapsPlacesReview`, workflow `release.yml`, environment `npm`, permission `npm publish`.
2. Удалите secret `NPM_TOKEN`.
3. В настройках npm запретите обычную token-based публикацию.

Следующие версии публикуются через GitHub OIDC без постоянного npm-токена. Если live-тест упал из-за временной внешней ошибки, допускается rerun workflow. Если потребовалось изменение кода, существующий тег не переписывается — выпускается новая patch-версия.

## Структура проекта

- `src/Tools` - тонкие OpenClaw tool adapters.
- `src/Application` - DTO, нормализация входа, dependency interfaces и tool call handlers.
- `src/Infrastructure` - Playwright collector, logging и clock implementations.
- `src/Composition` - сборка handlers и infrastructure.
- `src/Schemas` - TypeBox-схемы config и parameters.
- `src/Tests` - application, infrastructure, plugin и live collector tests.
- `scripts/run-tool.ts` - ручной запуск handler-а через composition root и печать JSON output.

## Ограничения

- Плагин не решает CAPTCHA автоматически.
- Если Яндекс показывает challenge/CAPTCHA, collector замедляется, перезагружает страницу и пытается продолжить после последнего найденного отзыва.
- Если список перестал догружаться, collector возвращает уже найденные отзывы с warning.
- DOM Яндекс Карт может меняться; обязательный live-тест обнаруживает такие изменения при каждом запуске `npm test`.

## Лицензия

MIT. См. [LICENSE](./LICENSE).

[Русская версия](./README.ru.md)

# OpenClaw Yandex Maps Places Review

An OpenClaw tool plugin that uses Playwright to collect the latest public reviews for a place on Yandex Maps.

The plugin does not use the Yandex API. It opens the place's public page in a browser, navigates to its reviews, attempts to sort them by newest first, and returns the reviews it finds as JSON.

## Features

- Provides the `yandex_maps_place_reviews` tool.
- Accepts a link to a place on Yandex Maps.
- Returns the latest `N` reviews; the default is `100`.
- If fewer reviews are available than requested or Yandex stops loading more reviews, returns the available reviews with a warning.
- Returns `url` when it can be extracted, `date`, and `text` for each review.
- Supports configurable logging levels through the plugin configuration.
- Includes regular tests, a live test, and a headed live test with a visible browser.

## Requirements

- Node.js `22.19+`; Node.js `24` is recommended.
- npm.
- OpenClaw `2026.6.11+` to install the plugin.
- Playwright Chromium.

Check your Node.js version:

```powershell
node --version
```

## Installing in OpenClaw

On Ubuntu, install the plugin, Chromium, and the required system libraries:

```bash
openclaw plugins install npm:@sharleysoft/openclaw-yandex-maps-places-review
npx --yes @sharleysoft/openclaw-yandex-maps-places-review@latest setup --with-deps
openclaw plugins enable yandex-maps-places-review
```

Run the setup command without the `sudo` prefix and as the same Unix user that runs the OpenClaw Gateway, because Playwright stores Chromium in the user's cache. That user must have `sudo` privileges; Playwright will request elevation when it installs the required Linux system packages.

Windows and macOS do not require the Linux system packages:

```powershell
openclaw plugins install npm:@sharleysoft/openclaw-yandex-maps-places-review
npx --yes @sharleysoft/openclaw-yandex-maps-places-review@latest setup
openclaw plugins enable yandex-maps-places-review
```

The `coding` tools profile does not include tools provided by plugins. To allow only this tool, add it to the active `openclaw.json`:

```json5
{
  tools: {
    profile: "coding",
    alsoAllow: ["yandex_maps_place_reviews"],
  },
}
```

If `tools.alsoAllow` already contains values, append to the existing array instead of replacing it. If `tools.allow` is configured at the same level, add `yandex_maps_place_reviews` there instead: `allow` and `alsoAllow` cannot be used together at the same level.

When using sandbox mode `all` or `non-main`, also allow the plugin ID at the sandbox level:

```json5
{
  tools: {
    sandbox: {
      tools: {
        alsoAllow: ["yandex-maps-places-review"],
      },
    },
  },
}
```

Validate the configuration, restart the Gateway, and then verify that the tool is registered at runtime:

```bash
openclaw config validate
openclaw gateway restart
openclaw plugins inspect yandex-maps-places-review --runtime --json
```

To update the plugin:

```bash
openclaw plugins update yandex-maps-places-review
npx --yes @sharleysoft/openclaw-yandex-maps-places-review@latest setup --with-deps
openclaw gateway restart
openclaw plugins inspect yandex-maps-places-review --runtime --json
```

After an update, the setup command checks and installs the Chromium version required by the new Playwright version. On Ubuntu, run it without the `sudo` prefix as the Gateway user with `sudo` privileges. On Windows and macOS, run it without `--with-deps`.

## Local Development

### Installing Dependencies

```powershell
npm install
npx cross-env PLAYWRIGHT_BROWSERS_PATH=0 playwright install chromium
```

### Build and Checks

```powershell
npm run build
npm run test:unit
npm run test:live
npm test
npm run plugin:build
npm run plugin:validate
```

Run the complete local verification suite:

```powershell
npm run verify
```

## Tool Usage

Tool name:

```text
yandex_maps_place_reviews
```

Parameters:

- `url` - a link to a place on Yandex Maps.
- `count` - optional number of latest reviews to return; defaults to `100`, with a minimum of `1` and a maximum of `500`.

Both canonical URLs such as `https://yandex.ru/maps/org/...` and share/POI URLs such as `https://yandex.com/maps/213/moscow/?mode=poi&poi%5Buri%5D=ymapsbm1%3A%2F%2Forg%3Foid%3D...&tab=reviews` are supported.

Plugin configuration:

- `logLevel` - optional logging level: `silent`, `error`, `warn`, `info`, or `debug`.

Result format:

```json
{
  "sourceUrl": "https://yandex.ru/maps/org/example/123/reviews/",
  "requestedCount": 100,
  "fetchedAt": "2026-07-07T00:00:00.000Z",
  "reviews": [
    {
      "url": "https://yandex.ru/maps/org/example/123/reviews/abc",
      "date": "2026-07-06T12:00:00.000Z",
      "text": "Review text"
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

## Inspecting Output Manually

Headless mode:

```powershell
$env:LOG_LEVEL='silent'
npm run run:tool -- "https://yandex.ru/maps/org/tri_vokzala_depo/168713437054/" 100
```

Visible browser:

```powershell
$env:HEADED='1'
$env:LOG_LEVEL='silent'
npm run run:tool -- "https://yandex.ru/maps/org/tri_vokzala_depo/168713437054/" 100
```

## Live Tests

Headless live test:

```powershell
$env:YANDEX_MAPS_PLACE_URL="https://yandex.ru/maps/org/tri_vokzala_depo/168713437054/"
$env:YANDEX_MAPS_REVIEW_COUNT="100"
npm run test:live
```

Live test with a visible browser:

```powershell
$env:YANDEX_MAPS_PLACE_URL="https://yandex.ru/maps/org/tri_vokzala_depo/168713437054/"
$env:YANDEX_MAPS_REVIEW_COUNT="100"
npm run test:headed
```

After a successful run, the command saves the complete JSON result to `artifacts/yandex-maps-reviews.headed.json`. You can override the path:

```powershell
$env:YANDEX_MAPS_OUTPUT_FILE="artifacts/my-place-reviews.json"
npm run test:headed
```

`npm test` runs stable unit and component tests without accessing Yandex Maps. The live check runs separately through `npm run test:live` and requests at least 60 reviews. `YANDEX_MAPS_PLACE_URL` and `YANDEX_MAPS_REVIEW_COUNT` let you override the page and review count; the live-test count must be between 60 and 500. Network unavailability, a CAPTCHA, or DOM changes cause the live test to fail.

The live test is a mandatory release gate: the workflow does not publish the npm package or create a GitHub Release until the test passes.

## Releasing a New Version

The release workflow is triggered by a tag that must exactly match the package and manifest versions:

```bash
npm version patch --no-git-tag-version
# Update the version in openclaw.plugin.json to the same value.
npm run verify
git add package.json package-lock.json openclaw.plugin.json
git commit -m "release: v0.1.1"
git tag v0.1.1
git push origin master --tags
```

The workflow on `ubuntu-latest` installs Chromium, runs the unit/component tests and the mandatory live test, validates the manifest, installs the built `.tgz` through `npm-pack:`, publishes the same verified archive to npm, and only then creates a GitHub Release.

For the first release, while the npm package does not yet exist, you cannot configure a Trusted Publisher. Create a temporary granular npm token with publish permission and 2FA bypass, save it as the `NPM_TOKEN` secret in the `npm` GitHub environment, and create the `v0.1.0` tag. After the workflow succeeds:

1. Configure a Trusted Publisher for the npm package: GitHub repository `PavelRubis/OpenClawYandexMapsPlacesReview`, workflow `release.yml`, environment `npm`, permission `npm publish`.
2. Delete the `NPM_TOKEN` secret.
3. Disable regular token-based publishing in the npm settings.

Subsequent versions are published through GitHub OIDC without a persistent npm token. If the live test fails because of a temporary external error, you may rerun the workflow. If a code change is required, do not overwrite the existing tag; release a new patch version instead.

## Project Structure

- `src/Tools` - thin OpenClaw tool adapters.
- `src/Application` - DTOs, input normalization, dependency interfaces, and tool call handlers.
- `src/Infrastructure` - the Playwright collector, logging, and clock implementations.
- `src/Composition` - composition of handlers and infrastructure.
- `src/Schemas` - TypeBox schemas for configuration and parameters.
- `src/Tests` - application, infrastructure, plugin, and live collector tests.
- `scripts/run-tool.ts` - manual execution of the handler through the composition root, with JSON output printed to the console.

## Limitations

- The plugin does not solve CAPTCHAs automatically.
- If Yandex displays a challenge or CAPTCHA, the collector slows down, reloads the page, and attempts to continue after the last review it found.
- If the list stops loading more reviews, the collector returns the reviews it has already found with a warning.
- The Yandex Maps DOM may change; the mandatory live test detects such changes on every `npm test` run.

## License

MIT. See [LICENSE](./LICENSE).

import type { LogLevel } from "../Application/Dtos/yandex-maps-place-reviews.dto.js";
import { GetYandexMapsPlaceReviewsToolCallHandler } from "../Application/ToolCallHandlers/get-yandex-maps-place-reviews-tool-call-handler.js";
import { SystemClock } from "../Infrastructure/Clock/system-clock.js";
import { PinoAppLogger } from "../Infrastructure/Logging/pino-app-logger.js";
import { PlaywrightYandexMapsReviewCollector } from "../Infrastructure/YandexMaps/playwright-yandex-maps-review-collector.js";
import { PlaywrightYandexMapsReviewNavigator } from "../Infrastructure/YandexMaps/playwright-yandex-maps-review-navigator.js";
import { PlaywrightYandexMapsReviewParser } from "../Infrastructure/YandexMaps/playwright-yandex-maps-review-parser.js";

export type PluginConfig = {
  logLevel?: LogLevel;
};

export function createToolCallHandlers(config: PluginConfig = {}) {
  const logger = new PinoAppLogger(config.logLevel ?? "info");
  const clock = new SystemClock();
  const navigator = new PlaywrightYandexMapsReviewNavigator(logger);
  const parser = new PlaywrightYandexMapsReviewParser();
  const collector = new PlaywrightYandexMapsReviewCollector({
    logger,
    clock,
    navigator,
    parser,
  });

  return {
    getYandexMapsPlaceReviews: new GetYandexMapsPlaceReviewsToolCallHandler(collector, clock, logger),
  };
}

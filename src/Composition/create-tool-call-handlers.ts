import type { LogLevel } from "../Application/Dtos/yandex-maps-place-reviews.dto.js";
import { GetYandexMapsPlaceReviewsToolCallHandler } from "../Application/ToolCallHandlers/get-yandex-maps-place-reviews-tool-call-handler.js";
import { SystemClock } from "../Infrastructure/Clock/system-clock.js";
import { PinoAppLogger } from "../Infrastructure/Logging/pino-app-logger.js";
import { PlaywrightYandexMapsReviewCollector } from "../Infrastructure/YandexMaps/playwright-yandex-maps-review-collector.js";

export type PluginConfig = {
  logLevel?: LogLevel;
};

export function createToolCallHandlers(config: PluginConfig = {}) {
  const logger = new PinoAppLogger(config.logLevel ?? "info");
  const clock = new SystemClock();
  const collector = new PlaywrightYandexMapsReviewCollector({
    logger,
    clock,
  });

  return {
    getYandexMapsPlaceReviews: new GetYandexMapsPlaceReviewsToolCallHandler(collector, clock, logger),
  };
}

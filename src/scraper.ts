import type {
  GetYandexMapsPlaceReviewsInputDto,
  GetYandexMapsPlaceReviewsOutputDto,
  LogLevel,
} from "./Application/Dtos/yandex-maps-place-reviews.dto.js";
import { SystemClock } from "./Infrastructure/Clock/system-clock.js";
import { PinoAppLogger } from "./Infrastructure/Logging/pino-app-logger.js";
import {
  extractReviewsFromPage,
  isCaptchaOrChallenge,
  PlaywrightYandexMapsReviewCollector,
} from "./Infrastructure/YandexMaps/playwright-yandex-maps-review-collector.js";
import { PlaywrightYandexMapsReviewNavigator } from "./Infrastructure/YandexMaps/playwright-yandex-maps-review-navigator.js";
import { PlaywrightYandexMapsReviewParser } from "./Infrastructure/YandexMaps/playwright-yandex-maps-review-parser.js";

export { extractReviewsFromPage, isCaptchaOrChallenge };

export type CollectorOptions = GetYandexMapsPlaceReviewsInputDto & {
  logLevel?: LogLevel;
};

export async function fetchYandexMapsPlaceReviews(
  options: CollectorOptions,
  executionOptions?: {
    signal?: AbortSignal;
  },
): Promise<GetYandexMapsPlaceReviewsOutputDto> {
  const logger = new PinoAppLogger(options.logLevel ?? "info");
  const clock = new SystemClock();
  const navigator = new PlaywrightYandexMapsReviewNavigator(logger);
  const parser = new PlaywrightYandexMapsReviewParser();
  const collector = new PlaywrightYandexMapsReviewCollector({
    logger,
    clock,
    navigator,
    parser,
  });

  return collector.collect(options, executionOptions);
}

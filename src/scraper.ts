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
  const collector = new PlaywrightYandexMapsReviewCollector({
    logger,
    clock: new SystemClock(),
  });

  return collector.collect(options, executionOptions);
}

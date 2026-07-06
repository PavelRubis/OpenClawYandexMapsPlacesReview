import { describe, expect, it, vi } from "vitest";
import type { Clock } from "../../Application/Dependencies/clock.js";
import type { AppLogger } from "../../Application/Dependencies/logger.js";
import type { YandexMapsReviewCollector } from "../../Application/Dependencies/yandex-maps-review-collector.js";
import { GetYandexMapsPlaceReviewsToolCallHandler } from "../../Application/ToolCallHandlers/get-yandex-maps-place-reviews-tool-call-handler.js";

const clock: Clock = {
  now: () => new Date("2026-07-07T00:00:00.000Z"),
};

const logger: AppLogger = {
  level: "silent",
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
};

describe("GetYandexMapsPlaceReviewsToolCallHandler", () => {
  it("normalizes default count before calling the collector", async () => {
    const collector: YandexMapsReviewCollector = {
      collect: vi.fn(async (input) => ({
        sourceUrl: "https://yandex.ru/maps/org/test/1/reviews/",
        requestedCount: input.count ?? -1,
        fetchedAt: clock.now().toISOString(),
        reviews: [],
        stats: {
          attempts: 1,
          captchaReloads: 0,
          scrolls: 0,
          duplicatesSkipped: 0,
          logLevel: "silent",
        },
      })),
    };
    const handler = new GetYandexMapsPlaceReviewsToolCallHandler(collector, clock, logger);

    await expect(handler.handle({ url: "https://yandex.ru/maps/org/test/1/" })).resolves.toMatchObject({
      requestedCount: 100,
    });
    expect(collector.collect).toHaveBeenCalledWith(
      {
        url: "https://yandex.ru/maps/org/test/1/",
        count: 100,
      },
      {
        signal: undefined,
      },
    );
  });

  it("rejects an empty URL before calling infrastructure", async () => {
    const collector: YandexMapsReviewCollector = {
      collect: vi.fn(),
    };
    const handler = new GetYandexMapsPlaceReviewsToolCallHandler(collector, clock, logger);

    await expect(handler.handle({ url: " " })).rejects.toThrow(/url must not be empty/);
    expect(collector.collect).not.toHaveBeenCalled();
  });
});

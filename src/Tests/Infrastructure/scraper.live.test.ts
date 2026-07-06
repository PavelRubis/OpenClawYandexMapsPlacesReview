import { describe, expect, it } from "vitest";
import { fetchYandexMapsPlaceReviews } from "../../scraper.js";

const liveUrl = process.env.YANDEX_MAPS_PLACE_URL;
const liveCount = normalizeLiveCount(process.env.YANDEX_MAPS_REVIEW_COUNT);
const headed = process.env.HEADED === "1";

const describeLive = liveUrl ? describe : describe.skip;

describeLive("live Yandex Maps scraper", () => {
  it(
    "collects recent reviews from a real Yandex Maps place page",
    async () => {
      const result = await fetchYandexMapsPlaceReviews({
        url: liveUrl!,
        count: liveCount,
        headed,
        logLevel: "debug",
      });

      expect(result.sourceUrl).toContain("/reviews/");
      expect(result.requestedCount).toBe(liveCount);
      expect(result.reviews.length).toBeGreaterThan(0);
      expect(result.reviews.length).toBeLessThanOrEqual(liveCount);

      for (const review of result.reviews) {
        expect(review.date.trim()).not.toBe("");
        expect(review.text.trim()).not.toBe("");
      }
    },
    180_000,
  );
});

function normalizeLiveCount(value: string | undefined): number {
  if (value === undefined) {
    return 5;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    throw new Error("YANDEX_MAPS_REVIEW_COUNT must be an integer from 1 to 500 for live tests.");
  }

  return parsed;
}

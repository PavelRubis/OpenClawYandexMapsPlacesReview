import { describe, expect, it } from "vitest";
import { normalizeYandexMapsReviewsUrl } from "../../yandex-url.js";

describe("normalizeYandexMapsReviewsUrl", () => {
  it("normalizes a place URL to reviews", () => {
    expect(normalizeYandexMapsReviewsUrl("https://yandex.ru/maps/org/test/123/?ll=1#tab")).toBe(
      "https://yandex.ru/maps/org/test/123/reviews/",
    );
  });

  it("keeps an existing reviews URL canonical", () => {
    expect(normalizeYandexMapsReviewsUrl("https://yandex.ru/maps/org/test/123/reviews/?sort=foo")).toBe(
      "https://yandex.ru/maps/org/test/123/reviews/",
    );
  });

  it("rejects non-Yandex Maps URLs", () => {
    expect(() => normalizeYandexMapsReviewsUrl("https://example.com/maps/org/test/123")).toThrow(/Yandex Maps/);
  });
});

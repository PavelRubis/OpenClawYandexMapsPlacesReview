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

  it("keeps a POI share URL and selects the reviews tab", () => {
    expect(
      normalizeYandexMapsReviewsUrl(
        "https://yandex.com/maps/213/moscow/?indoorLevel=1&ll=37.586531%2C55.805508&mode=poi&poi%5Bpoint%5D=37.584962%2C55.805483&poi%5Buri%5D=ymapsbm1%3A%2F%2Forg%3Foid%3D22642467915&source=serp_navig&tab=overview&utm_source=share&z=18.4",
      ),
    ).toBe(
      "https://yandex.com/maps/213/moscow/?indoorLevel=1&ll=37.586531%2C55.805508&mode=poi&poi%5Bpoint%5D=37.584962%2C55.805483&poi%5Buri%5D=ymapsbm1%3A%2F%2Forg%3Foid%3D22642467915&tab=reviews&z=18.4",
    );
  });

  it("rejects a map URL without an organization", () => {
    expect(() => normalizeYandexMapsReviewsUrl("https://yandex.com/maps/213/moscow/?ll=1%2C2")).toThrow(
      /place page/,
    );
  });

  it("rejects non-Yandex Maps URLs", () => {
    expect(() => normalizeYandexMapsReviewsUrl("https://example.com/maps/org/test/123")).toThrow(/Yandex Maps/);
  });
});

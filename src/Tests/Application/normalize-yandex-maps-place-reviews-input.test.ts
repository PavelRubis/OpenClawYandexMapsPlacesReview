import { describe, expect, it } from "vitest";
import { normalizeYandexMapsPlaceReviewsInput } from "../../Application/Normalization/normalize-yandex-maps-place-reviews-input.js";

describe("normalizeYandexMapsPlaceReviewsInput", () => {
  it("normalizes a place URL and applies the default count", () => {
    expect(
      normalizeYandexMapsPlaceReviewsInput({
        url: "https://yandex.ru/maps/org/test/123/?ll=1#tab",
      }),
    ).toEqual({
      url: "https://yandex.ru/maps/org/test/123/reviews/",
      count: 100,
    });
  });

  it("preserves headed and accepts the supported count boundaries", () => {
    expect(
      normalizeYandexMapsPlaceReviewsInput({
        url: "https://yandex.ru/maps/org/test/123/",
        count: 1,
        headed: true,
      }),
    ).toMatchObject({ count: 1, headed: true });
    expect(
      normalizeYandexMapsPlaceReviewsInput({
        url: "https://yandex.ru/maps/org/test/123/",
        count: 500,
      }).count,
    ).toBe(500);
  });

  it("rejects invalid count values", () => {
    const input = { url: "https://yandex.ru/maps/org/test/123/" };

    expect(() => normalizeYandexMapsPlaceReviewsInput({ ...input, count: 0 })).toThrow(/between/);
    expect(() => normalizeYandexMapsPlaceReviewsInput({ ...input, count: 501 })).toThrow(/between/);
    expect(() => normalizeYandexMapsPlaceReviewsInput({ ...input, count: 1.5 })).toThrow(/integer/);
  });

  it("keeps an existing reviews URL canonical", () => {
    expect(
      normalizeYandexMapsPlaceReviewsInput({
        url: "https://yandex.ru/maps/org/test/123/reviews/?sort=foo",
      }).url,
    ).toBe("https://yandex.ru/maps/org/test/123/reviews/");
  });

  it("keeps a POI share URL, selects reviews, and removes tracking parameters", () => {
    expect(
      normalizeYandexMapsPlaceReviewsInput({
        url: "https://yandex.com/maps/213/moscow/?indoorLevel=1&ll=37.586531%2C55.805508&mode=poi&poi%5Bpoint%5D=37.584962%2C55.805483&poi%5Buri%5D=ymapsbm1%3A%2F%2Forg%3Foid%3D22642467915&source=serp_navig&tab=overview&utm_source=share&z=18.4",
      }).url,
    ).toBe(
      "https://yandex.com/maps/213/moscow/?indoorLevel=1&ll=37.586531%2C55.805508&mode=poi&poi%5Bpoint%5D=37.584962%2C55.805483&poi%5Buri%5D=ymapsbm1%3A%2F%2Forg%3Foid%3D22642467915&tab=reviews&z=18.4",
    );
  });

  it("rejects empty, relative, non-place, and non-Yandex URLs", () => {
    expect(() => normalizeYandexMapsPlaceReviewsInput({ url: " " })).toThrow(/must not be empty/);
    expect(() => normalizeYandexMapsPlaceReviewsInput({ url: "/maps/org/test/123" })).toThrow(/absolute/);
    expect(() =>
      normalizeYandexMapsPlaceReviewsInput({ url: "https://yandex.com/maps/213/moscow/?ll=1%2C2" }),
    ).toThrow(/place page/);
    expect(() =>
      normalizeYandexMapsPlaceReviewsInput({ url: "https://example.com/maps/org/test/123" }),
    ).toThrow(/Yandex Maps/);
  });
});

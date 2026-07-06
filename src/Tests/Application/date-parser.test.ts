import { describe, expect, it } from "vitest";
import { parseYandexReviewDate } from "../../date-parser.js";

const NOW = new Date(2026, 6, 5);

describe("parseYandexReviewDate", () => {
  it("parses relative dates", () => {
    expect(parseYandexReviewDate("сегодня", NOW)?.getDate()).toBe(5);
    expect(parseYandexReviewDate("вчера", NOW)?.getDate()).toBe(4);
    expect(parseYandexReviewDate("2 дня назад", NOW)?.getDate()).toBe(3);
  });

  it("parses Russian absolute dates", () => {
    const parsed = parseYandexReviewDate("12 июня 2026", NOW);
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(5);
    expect(parsed?.getDate()).toBe(12);
  });

  it("parses English absolute dates from yandex.com", () => {
    const parsed = parseYandexReviewDate("July 3", NOW);
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(6);
    expect(parsed?.getDate()).toBe(3);
  });
});

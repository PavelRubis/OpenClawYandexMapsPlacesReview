import { describe, expect, it } from "vitest";
import { findResumeIndex, mergeUniqueReviews, reviewKey } from "../../dedupe.js";

describe("review dedupe", () => {
  it("uses only date and text for the key", () => {
    const first = { url: "https://example.test/one", date: "сегодня", text: "Отличное место" };
    const second = { url: "https://example.test/two", date: "сегодня", text: " Отличное   место " };

    expect(reviewKey(first)).toBe(reviewKey(second));
  });

  it("merges unique reviews and skips duplicate date+text pairs", () => {
    const existing = [{ date: "сегодня", text: "A" }];
    const incoming = [
      { date: "сегодня", text: "A" },
      { date: "вчера", text: "A" },
    ];

    const merged = mergeUniqueReviews(existing, incoming);
    expect(merged.reviews).toHaveLength(2);
    expect(merged.duplicates).toBe(1);
  });

  it("finds the resume point by normalized text", () => {
    expect(
      findResumeIndex(
        [
          { date: "1 июля", text: "Первый отзыв" },
          { date: "2 июля", text: "Последний   обработанный" },
        ],
        "Последний обработанный",
      ),
    ).toBe(1);
  });
});

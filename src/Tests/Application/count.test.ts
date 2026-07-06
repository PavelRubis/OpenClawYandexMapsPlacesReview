import { describe, expect, it } from "vitest";
import { normalizeReviewCount } from "../../count.js";

describe("normalizeReviewCount", () => {
  it("defaults to 100", () => {
    expect(normalizeReviewCount(undefined)).toBe(100);
  });

  it("accepts the supported range", () => {
    expect(normalizeReviewCount(1)).toBe(1);
    expect(normalizeReviewCount(500)).toBe(500);
  });

  it("rejects invalid values", () => {
    expect(() => normalizeReviewCount(0)).toThrow(/between/);
    expect(() => normalizeReviewCount(501)).toThrow(/between/);
    expect(() => normalizeReviewCount(1.5)).toThrow(/integer/);
  });
});

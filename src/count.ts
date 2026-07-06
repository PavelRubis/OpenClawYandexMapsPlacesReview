import { DEFAULT_REVIEW_COUNT, MAX_REVIEW_COUNT, MIN_REVIEW_COUNT } from "./types.js";

export function normalizeReviewCount(count: number | undefined): number {
  if (count === undefined) {
    return DEFAULT_REVIEW_COUNT;
  }

  if (!Number.isInteger(count)) {
    throw new Error("count must be an integer.");
  }

  if (count < MIN_REVIEW_COUNT || count > MAX_REVIEW_COUNT) {
    throw new Error(`count must be between ${MIN_REVIEW_COUNT} and ${MAX_REVIEW_COUNT}.`);
  }

  return count;
}

import type { Review } from "./types.js";

export function reviewKey(review: Review): string {
  return `text:${review.date.trim()}|${normalizeText(review.text)}`;
}

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function mergeUniqueReviews(existing: Review[], incoming: Review[]): { reviews: Review[]; duplicates: number } {
  const seen = new Set(existing.map(reviewKey));
  const reviews = [...existing];
  let duplicates = 0;

  for (const review of incoming) {
    const key = reviewKey(review);
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }

    seen.add(key);
    reviews.push(review);
  }

  return { reviews, duplicates };
}

export function findResumeIndex(reviews: Review[], lastText: string): number {
  const normalizedLastText = normalizeText(lastText);
  return reviews.findIndex((review) => normalizeText(review.text) === normalizedLastText);
}

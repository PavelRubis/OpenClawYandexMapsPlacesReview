export const REVIEW_CARD_SELECTOR = [
  ".business-review-view",
  "[data-testid*='review']",
  "[itemprop='review']",
].join(", ");

export const REVIEWS_CONTAINER_SELECTOR = ".business-reviews-card-view__reviews-container";
export const SORT_CONTROL_SELECTOR = "div[role=button].rating-ranking-view";
export const SORT_OPTION_SELECTOR = ".rating-ranking-view__popup-line";

export const REVIEW_BODY_SELECTORS = [
  ".business-review-view__body-text",
  ".business-review-view__body",
  "[class*='body-text']",
  "[class*='review'][class*='text']",
  "[itemprop='reviewBody']",
];

export const NEWEST_SORT_TEXT = /^(?:new first|сначала\s+новые|новые\s+сначала|по\s+новизне)$/i;
export const EXPAND_REVIEW_TEXT = /^(?:ещ[её]|more|читать\s+полностью|развернуть)$/i;

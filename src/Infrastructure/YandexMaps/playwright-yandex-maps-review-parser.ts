import type { Locator, Page } from "playwright";
import type { YandexMapsReviewDto } from "../../Application/Dtos/yandex-maps-place-reviews.dto.js";
import { normalizeText } from "../../dedupe.js";
import type {
  ExtractedReviews,
  YandexMapsReviewParser,
} from "./playwright-yandex-maps-review-contracts.js";
import {
  EXPAND_REVIEW_TEXT,
  REVIEW_BODY_SELECTORS,
  REVIEW_CARD_SELECTOR,
} from "./yandex-maps-review-dom.js";

export class PlaywrightYandexMapsReviewParser implements YandexMapsReviewParser {
  async extractReviews(page: Page, signal?: AbortSignal): Promise<YandexMapsReviewDto[]> {
    return (await this.extractReviewsWithDiagnostics(page, signal)).reviews;
  }

  async extractReviewsWithDiagnostics(page: Page, signal?: AbortSignal): Promise<ExtractedReviews> {
    const cards = page.locator(REVIEW_CARD_SELECTOR);
    const count = await cards.count();
    const reviews: YandexMapsReviewDto[] = [];
    const failedExpansionKeys: string[] = [];

    for (let index = 0; index < count; index += 1) {
      signal?.throwIfAborted();
      const card = cards.nth(index);
      const review = await extractReview(card);
      if (review === null) {
        continue;
      }

      reviews.push(review);
      if (await hasVisibleExpansionControl(card)) {
        failedExpansionKeys.push(
          normalizeText(review.text).slice(0, 200) ||
            `card-${(await card.getAttribute("data-review-id").catch(() => null)) ?? "unknown"}`,
        );
      }
    }

    return { reviews, failedExpansionKeys };
  }

  async isCaptchaOrChallenge(page: Page): Promise<boolean> {
    const url = page.url().toLowerCase();
    if (url.includes("showcaptcha") || url.includes("smartcaptcha") || url.includes("captcha")) {
      return true;
    }

    const text = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
    return /captcha|капч|подтвердите,?\s+что\s+вы\s+не\s+робот|проверяем/i.test(text);
  }
}

async function hasVisibleExpansionControl(card: Locator): Promise<boolean> {
  return card
    .getByText(EXPAND_REVIEW_TEXT)
    .first()
    .isVisible({ timeout: 250 })
    .catch(() => false);
}

async function extractReview(card: Locator): Promise<YandexMapsReviewDto | null> {
  const text = normalizeText(await firstText(card, REVIEW_BODY_SELECTORS));
  if (!text) {
    return null;
  }

  const date =
    normalizeText(await firstAttribute(card, ["meta[itemprop='datePublished']"], "content")) ||
    normalizeText(await firstAttribute(card, ["time"], "datetime")) ||
    normalizeText(await firstText(card, [".business-review-view__date", "[class*='date']", "time"]));

  const href = await firstAttribute(
    card,
    ["a[href*='review']", "a[href*='/reviews/']", "a[href*='maps.yandex']"],
    "href",
  );
  const url = href ? absoluteYandexUrl(href) : undefined;

  return {
    ...(url ? { url } : {}),
    date,
    text,
  };
}

async function firstText(root: Locator, selectors: readonly string[]): Promise<string> {
  for (const selector of selectors) {
    const locator = root.locator(selector).first();
    if ((await locator.count()) > 0) {
      const text = await locator.innerText().catch(() => "");
      if (text.trim()) {
        return text;
      }
    }
  }

  return "";
}

async function firstAttribute(root: Locator, selectors: readonly string[], attribute: string): Promise<string> {
  for (const selector of selectors) {
    const locator = root.locator(selector).first();
    if ((await locator.count()) > 0) {
      const value = await locator.getAttribute(attribute).catch(() => null);
      if (value?.trim()) {
        return value;
      }
    }
  }

  return "";
}

function absoluteYandexUrl(href: string): string {
  try {
    return new URL(href, "https://yandex.ru").toString();
  } catch {
    return href;
  }
}

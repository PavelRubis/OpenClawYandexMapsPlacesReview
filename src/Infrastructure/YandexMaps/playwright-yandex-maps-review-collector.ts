import { chromium, type Browser, type Locator, type Page } from "playwright";
import type { Clock } from "../../Application/Dependencies/clock.js";
import type { AppLogger } from "../../Application/Dependencies/logger.js";
import type { YandexMapsReviewCollector } from "../../Application/Dependencies/yandex-maps-review-collector.js";
import type {
  GetYandexMapsPlaceReviewsInputDto,
  GetYandexMapsPlaceReviewsOutputDto,
  LogLevel,
  YandexMapsReviewDto,
} from "../../Application/Dtos/yandex-maps-place-reviews.dto.js";
import { normalizeReviewCount } from "../../count.js";
import { findResumeIndex, mergeUniqueReviews, normalizeText } from "../../dedupe.js";
import { normalizeYandexMapsReviewsUrl } from "../../yandex-url.js";

const REVIEW_CARD_SELECTOR = [".business-review-view", "[data-testid*='review']", "[itemprop='review']"].join(", ");
const REVIEWS_CONTAINER_SELECTOR = ".business-reviews-card-view__reviews-container";

const MAX_SCROLLS = 140;
const MAX_CAPTCHA_RELOADS = 4;
const BASE_DELAY_MS = 450;
const SLOW_DELAY_MS = 1_600;

export type PlaywrightYandexMapsReviewCollectorOptions = {
  logger: AppLogger;
  clock: Clock;
};

export class PlaywrightYandexMapsReviewCollector implements YandexMapsReviewCollector {
  constructor(private readonly options: PlaywrightYandexMapsReviewCollectorOptions) {}

  async collect(
    input: GetYandexMapsPlaceReviewsInputDto,
    options?: {
      signal?: AbortSignal;
    },
  ): Promise<GetYandexMapsPlaceReviewsOutputDto> {
    const requestedCount = normalizeReviewCount(input.count);
    const sourceUrl = normalizeYandexMapsReviewsUrl(input.url);
    const warnings: string[] = [];
    const stats = {
      attempts: 1,
      captchaReloads: 0,
      scrolls: 0,
      duplicatesSkipped: 0,
      logLevel: this.options.logger.level,
    };

    let browser: Browser | undefined;
    let reviews: YandexMapsReviewDto[] = [];
    let delayMs = BASE_DELAY_MS;
    let scansWithoutNewReviews = 0;

    this.options.logger.info("Starting review collection.", {
      sourceUrl,
      requestedCount,
      headed: Boolean(input.headed),
    });

    try {
      options?.signal?.throwIfAborted();
      browser = await chromium.launch({
        headless: !input.headed,
        slowMo: input.headed ? 100 : 0,
      });
      const page = await browser.newPage({
        locale: "ru-RU",
        viewport: { width: 1366, height: 900 },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      });

      await openReviewsPage(page, sourceUrl, this.options.logger, options?.signal);
      await prepareReviewsPage(page, delayMs, this.options.logger, options?.signal);

      for (let scroll = 0; scroll < MAX_SCROLLS && reviews.length < requestedCount; scroll += 1) {
        options?.signal?.throwIfAborted();

        if (await isCaptchaOrChallenge(page)) {
          const resumed = await recoverFromCaptcha({
            page,
            sourceUrl,
            collected: reviews,
            delayMs,
            logger: this.options.logger,
            stats,
            warnings,
            signal: options?.signal,
          });
          delayMs = resumed.delayMs;
          if (!resumed.recovered) {
            break;
          }
        }

        const pageReviews = await extractReviewsFromPage(page, options?.signal);
        const resumeIndex =
          reviews.length > 0 ? findResumeIndex(pageReviews, reviews[reviews.length - 1]?.text ?? "") : -1;
        const newPageReviews = resumeIndex === -1 ? pageReviews : pageReviews.slice(resumeIndex + 1);
        const previousReviewCount = reviews.length;
        const merged = mergeUniqueReviews(reviews, newPageReviews);
        reviews = merged.reviews.slice(0, requestedCount);
        stats.duplicatesSkipped += merged.duplicates;
        scansWithoutNewReviews = reviews.length > previousReviewCount ? 0 : scansWithoutNewReviews + 1;

        this.options.logger.debug("Collected reviews after scan.", {
          total: reviews.length,
          seenOnPage: pageReviews.length,
          duplicates: merged.duplicates,
          scansWithoutNewReviews,
          scroll,
        });

        if (reviews.length >= requestedCount) {
          break;
        }

        if (scansWithoutNewReviews >= 2) {
          const message = `Stopped after ${scansWithoutNewReviews} scans without new unique reviews; returning ${reviews.length} reviews.`;
          this.options.logger.info(message);
          warnings.push(message);
          break;
        }

        const moved = await scrollReviews(page, delayMs, options?.signal);
        stats.scrolls += 1;
        if (!moved) {
          this.options.logger.info("Review list appears exhausted.");
          break;
        }
      }

      if (stats.scrolls >= MAX_SCROLLS && reviews.length < requestedCount) {
        warnings.push(`Stopped after ${MAX_SCROLLS} scrolls with ${reviews.length} reviews collected.`);
      }
    } finally {
      await browser?.close();
    }

    return {
      sourceUrl,
      requestedCount,
      fetchedAt: this.options.clock.now().toISOString(),
      reviews,
      stats,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }
}

async function openReviewsPage(
  page: Page,
  sourceUrl: string,
  logger: AppLogger,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  logger.debug("Opening reviews page.");
  await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  signal?.throwIfAborted();
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
}

async function prepareReviewsPage(page: Page, delayMs: number, logger: AppLogger, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await acceptCookiesIfVisible(page);
  await clickIfVisible(page, /отзывы/i);
  await selectNewestSort(page, logger);
  await expandVisibleReviewTexts(page, signal);
  await page.waitForTimeout(delayMs);
  signal?.throwIfAborted();
  logger.debug("Reviews page prepared.");
}

async function selectNewestSort(page: Page, logger: AppLogger): Promise<void> {
  await openSortPopup(page, logger);

  const optionClicked = await page
    .evaluate(() => {
      const normalize = (value: string | null | undefined) => value?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
      const option = Array.from(
        document.querySelectorAll<HTMLElement>(".rating-ranking-view__popup-line, div"),
      ).find((element) => {
        const text = normalize(element.textContent);
        return (
          (text === "new first" ||
            text === "сначала новые" ||
            text === "новые сначала" ||
            text === "по новизне") &&
          String(element.className).includes("rating-ranking-view__popup-line") &&
          element.offsetParent !== null
        );
      });

      option?.click();
      return Boolean(option);
    })
    .catch(() => false);

  if (!optionClicked) {
    const clicked = await clickIfVisible(page, /new first|сначала\s+новые|новые\s+сначала|по\s+новизне/i);
    if (!clicked) {
      logger.warn("Could not select newest-first sort control; continuing with visible order.");
    }
    return;
  }

  await page.waitForTimeout(1_000);
  const sortText = await page
    .locator("div[role=button].rating-ranking-view")
    .first()
    .innerText({ timeout: 2_000 })
    .catch(() => "");
  if (!/new first|сначала\s+новые|новые\s+сначала|по\s+новизне/i.test(sortText)) {
    logger.warn("Newest-first sort was clicked but not confirmed in the control text.", { sortText });
  }
}

async function openSortPopup(page: Page, logger: AppLogger): Promise<void> {
  const openedByMouse = await page
    .locator("div[role=button].rating-ranking-view")
    .first()
    .click({ timeout: 3_000 })
    .then(() => true)
    .catch(() => false);

  await page.waitForTimeout(1_000);
  if (await hasSortPopup(page)) {
    return;
  }

  if (!openedByMouse) {
    logger.debug("Sort control was not clickable through Playwright locator; trying DOM event dispatch.");
  }

  const dispatched = await page
    .evaluate(() => {
      const sortBtn = document.querySelector<HTMLElement>("div[role=button].rating-ranking-view");
      if (!sortBtn) {
        return false;
      }

      const rect = sortBtn.getBoundingClientRect();
      const clientX = rect.x + rect.width / 2;
      const clientY = rect.y + rect.height / 2;
      const pointerBase = {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
      };
      const mouseBase = {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
        button: 0,
      };

      sortBtn.dispatchEvent(new PointerEvent("pointerdown", pointerBase));
      sortBtn.dispatchEvent(new MouseEvent("mousedown", mouseBase));
      sortBtn.dispatchEvent(new PointerEvent("pointerup", pointerBase));
      sortBtn.dispatchEvent(new MouseEvent("mouseup", mouseBase));
      sortBtn.dispatchEvent(new MouseEvent("click", mouseBase));
      return true;
    })
    .catch(() => false);

  if (!dispatched) {
    await clickIfVisible(page, /by default|по умолчанию|сначала|новые|по новизне/i);
  }

  await page.waitForTimeout(2_000);
}

async function hasSortPopup(page: Page): Promise<boolean> {
  return page
    .locator(".rating-ranking-view__popup-line")
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
}

async function recoverFromCaptcha(args: {
  page: Page;
  sourceUrl: string;
  collected: YandexMapsReviewDto[];
  delayMs: number;
  logger: AppLogger;
  stats: {
    attempts: number;
    captchaReloads: number;
    scrolls: number;
    duplicatesSkipped: number;
    logLevel: LogLevel;
  };
  warnings: string[];
  signal?: AbortSignal;
}): Promise<{ recovered: boolean; delayMs: number }> {
  args.signal?.throwIfAborted();
  args.stats.captchaReloads += 1;
  args.stats.attempts += 1;
  const nextDelayMs = Math.max(args.delayMs * 2, SLOW_DELAY_MS);
  const lastText = args.collected.at(-1)?.text;

  args.logger.warn("CAPTCHA or challenge screen detected. Reloading and slowing down.", {
    captchaReloads: args.stats.captchaReloads,
    collected: args.collected.length,
    nextDelayMs,
  });

  if (args.stats.captchaReloads > MAX_CAPTCHA_RELOADS) {
    args.warnings.push(
      `CAPTCHA/challenge remained after ${MAX_CAPTCHA_RELOADS} reloads; returning ${args.collected.length} reviews.`,
    );
    return { recovered: false, delayMs: nextDelayMs };
  }

  await args.page.waitForTimeout(nextDelayMs);
  args.signal?.throwIfAborted();
  await args.page.goto(args.sourceUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await args.page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
  await prepareReviewsPage(args.page, nextDelayMs, args.logger, args.signal);

  if (lastText !== undefined) {
    await scrollUntilText(args.page, lastText, nextDelayMs, args.logger, args.signal);
  }

  return { recovered: true, delayMs: nextDelayMs };
}

async function scrollUntilText(
  page: Page,
  text: string,
  delayMs: number,
  logger: AppLogger,
  signal?: AbortSignal,
): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    signal?.throwIfAborted();
    const reviews = await extractReviewsFromPage(page, signal);
    if (findResumeIndex(reviews, text) !== -1) {
      logger.debug("Resume review found after reload.", { scrolls: index });
      return;
    }
    const moved = await scrollReviews(page, delayMs, signal);
    if (!moved) {
      return;
    }
  }
}

export async function extractReviewsFromPage(page: Page, signal?: AbortSignal): Promise<YandexMapsReviewDto[]> {
  await expandVisibleReviewTexts(page, signal);
  const cards = page.locator(REVIEW_CARD_SELECTOR);
  const count = await cards.count();
  const reviews: YandexMapsReviewDto[] = [];

  for (let index = 0; index < count; index += 1) {
    signal?.throwIfAborted();
    const card = cards.nth(index);
    const review = await extractReview(card);
    if (review !== null) {
      reviews.push(review);
    }
  }

  return reviews;
}

async function extractReview(card: Locator): Promise<YandexMapsReviewDto | null> {
  const text = normalizeText(
    await firstText(card, [
      ".business-review-view__body-text",
      ".business-review-view__body",
      "[class*='body-text']",
      "[class*='review'][class*='text']",
      "[itemprop='reviewBody']",
    ]),
  );

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

async function firstText(root: Locator, selectors: string[]): Promise<string> {
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

async function firstAttribute(root: Locator, selectors: string[], attribute: string): Promise<string> {
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

async function scrollReviews(page: Page, delayMs: number, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted();
  const before = await page.locator(REVIEW_CARD_SELECTOR).count().catch(() => 0);
  const beforeFingerprint = await reviewListFingerprint(page);
  const beforeScrollState = await scrollState(page);
  const scrollTarget = page.locator(REVIEWS_CONTAINER_SELECTOR).first();

  await page.locator(REVIEW_CARD_SELECTOR).last().scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => undefined);

  if ((await scrollTarget.count()) > 0) {
    await scrollTarget.evaluate((element) => {
      element.scrollBy({ top: 5_000, behavior: "instant" });
    });
  }

  await page.evaluate(() => {
    window.scrollBy(0, 5_000);
    const scrollables = Array.from(document.querySelectorAll<HTMLElement>("body, html, main, div"));
    for (const element of scrollables) {
      if (element.scrollHeight > element.clientHeight) {
        element.scrollBy({ top: 5_000, behavior: "instant" });
      }
    }
  });
  await page.mouse.wheel(0, 4_000);
  await page.waitForTimeout(Math.max(delayMs, 1_500));
  signal?.throwIfAborted();
  await expandVisibleReviewTexts(page, signal);
  const after = await page.locator(REVIEW_CARD_SELECTOR).count().catch(() => 0);
  const afterFingerprint = await reviewListFingerprint(page);
  const afterScrollState = await scrollState(page);
  return after > before || afterFingerprint !== beforeFingerprint || afterScrollState !== beforeScrollState;
}

async function reviewListFingerprint(page: Page): Promise<string> {
  return page
    .locator(REVIEW_CARD_SELECTOR)
    .evaluateAll((elements) =>
      elements
        .slice(-3)
        .map((element) => element.textContent?.replace(/\s+/g, " ").trim().slice(0, 200) ?? "")
        .join("||"),
    )
    .catch(() => "");
}

async function scrollState(page: Page): Promise<string> {
  return page
    .evaluate(() => {
      const states = [`window:${window.scrollY}`];
      for (const element of Array.from(
        document.querySelectorAll<HTMLElement>("main, [class*='scroll'], [class*='panel']"),
      )) {
        if (element.scrollHeight > element.clientHeight) {
          states.push(`${element.className}:${element.scrollTop}`);
        }
      }
      return states.join("|");
    })
    .catch(() => "");
}

async function expandVisibleReviewTexts(page: Page, signal?: AbortSignal): Promise<void> {
  const buttons = page.getByText(/ещ[её]|more|читать полностью|развернуть/i);
  const count = Math.min(await buttons.count().catch(() => 0), 20);

  for (let index = 0; index < count; index += 1) {
    signal?.throwIfAborted();
    await buttons.nth(index).click({ timeout: 1_000 }).catch(() => undefined);
  }
}

async function clickIfVisible(page: Page, label: RegExp): Promise<boolean> {
  const target = page.getByText(label).first();
  if ((await target.count().catch(() => 0)) === 0) {
    return false;
  }

  await target.click({ timeout: 2_000 }).catch(() => undefined);
  return true;
}

async function acceptCookiesIfVisible(page: Page): Promise<void> {
  await clickIfVisible(page, /принять|соглас|accept|agree/i);
}

export async function isCaptchaOrChallenge(page: Page): Promise<boolean> {
  const url = page.url().toLowerCase();
  if (url.includes("showcaptcha") || url.includes("smartcaptcha") || url.includes("captcha")) {
    return true;
  }

  const text = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
  return /captcha|капч|подтвердите,?\s+что\s+вы\s+не\s+робот|проверяем/i.test(text);
}

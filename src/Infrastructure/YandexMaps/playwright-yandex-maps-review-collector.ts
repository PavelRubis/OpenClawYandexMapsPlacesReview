import { chromium, type Browser, type ElementHandle, type Locator, type Page } from "playwright";
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
const SORT_CONTROL_SELECTOR = "div[role=button].rating-ranking-view";
const SORT_OPTION_SELECTOR = ".rating-ranking-view__popup-line";
const NEWEST_SORT_TEXT = /^(?:new first|сначала\s+новые|новые\s+сначала|по\s+новизне)$/i;
const EXPAND_REVIEW_TEXT = /^(?:ещ[её]|more|читать\s+полностью|развернуть)$/i;

const MAX_SCROLLS = 140;
const MAX_CAPTCHA_RELOADS = 4;
const MAX_SORT_ATTEMPTS = 3;
const BASE_DELAY_MS = 450;
const SLOW_DELAY_MS = 1_600;
const DOM_READY_TIMEOUT_MS = 30_000;
const CONTENT_UPDATE_TIMEOUT_MS = 10_000;

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
    const failedReviewExpansionKeys = new Set<string>();

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

        const extracted = await extractReviewsWithDiagnostics(page, options?.signal);
        const pageReviews = extracted.reviews;
        for (const key of extracted.failedExpansionKeys) {
          failedReviewExpansionKeys.add(key);
        }
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
          this.options.logger.debug("Review list did not load new cards after scrolling.");
        }
      }

      if (stats.scrolls >= MAX_SCROLLS && reviews.length < requestedCount) {
        warnings.push(`Stopped after ${MAX_SCROLLS} scrolls with ${reviews.length} reviews collected.`);
      }
      if (failedReviewExpansionKeys.size > 0) {
        warnings.push(
          `Could not expand the full text of ${failedReviewExpansionKeys.size} review${failedReviewExpansionKeys.size === 1 ? "" : "s"}; visible text was returned.`,
        );
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
  await withAbort(page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 45_000 }), signal);
  signal?.throwIfAborted();
  await withAbort(page.waitForLoadState("networkidle", { timeout: 20_000 }), signal).catch((error: unknown) => {
    signal?.throwIfAborted();
    if (!(error instanceof Error) || !error.message.includes("Timeout")) {
      throw error;
    }
  });
}

async function prepareReviewsPage(page: Page, delayMs: number, logger: AppLogger, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await acceptCookiesIfVisible(page, signal);
  await clickIfVisible(page, /отзывы/i, signal);
  await waitForReviewsPageReady(page, signal);
  await selectNewestSort(page, logger, signal);
  await waitForTimeout(page, delayMs, signal);
  signal?.throwIfAborted();
  logger.debug("Reviews page prepared.");
}

export async function waitForReviewsPageReady(page: Page, signal?: AbortSignal): Promise<void> {
  const ready = await waitForCondition(
    async () => {
      const containerVisible = await page
        .locator(REVIEWS_CONTAINER_SELECTOR)
        .first()
        .isVisible({ timeout: 500 })
        .catch(() => false);
      const sortVisible = await page
        .locator(SORT_CONTROL_SELECTOR)
        .first()
        .isVisible({ timeout: 500 })
        .catch(() => false);
      const cardCount = await page.locator(REVIEW_CARD_SELECTOR).count().catch(() => 0);
      return containerVisible && sortVisible && cardCount > 0;
    },
    DOM_READY_TIMEOUT_MS,
    page,
    signal,
  );

  if (!ready) {
    throw new Error("Yandex Maps reviews page did not expose the expected review list and sort controls.");
  }
}

export async function selectNewestSort(page: Page, logger: AppLogger, signal?: AbortSignal): Promise<void> {
  const control = page.locator(SORT_CONTROL_SELECTOR).first();

  for (let attempt = 1; attempt <= MAX_SORT_ATTEMPTS; attempt += 1) {
    signal?.throwIfAborted();
    const beforeFingerprint = await reviewListFingerprint(page);

    const opened = await clickLocator(control, signal, 3_000);
    if (!opened) {
      logger.debug("Could not open the review sort popup.", { attempt });
      continue;
    }

    const option = page.locator(SORT_OPTION_SELECTOR).filter({ hasText: NEWEST_SORT_TEXT }).first();
    const optionVisible = await waitForCondition(
      () => option.isVisible({ timeout: 500 }).catch(() => false),
      3_000,
      page,
      signal,
    );
    if (!optionVisible || !(await clickLocator(option, signal, 3_000))) {
      logger.debug("Could not click the newest-first sort option.", { attempt });
      continue;
    }

    const confirmed = await waitForCondition(
      async () => {
        const sortText = await control.innerText({ timeout: 500 }).catch(() => "");
        if (!NEWEST_SORT_TEXT.test(normalizeText(sortText))) {
          return false;
        }

        const currentFingerprint = await reviewListFingerprint(page);
        return currentFingerprint !== beforeFingerprint && (await areReviewDatesDescending(page));
      },
      CONTENT_UPDATE_TIMEOUT_MS,
      page,
      signal,
    );
    if (confirmed) {
      logger.debug("Newest-first review sort confirmed.", { attempt });
      return;
    }

    logger.debug("Newest-first review sort was not confirmed after clicking.", { attempt });
  }

  throw new Error(`Could not confirm newest-first review sorting after ${MAX_SORT_ATTEMPTS} attempts.`);
}

async function areReviewDatesDescending(page: Page): Promise<boolean> {
  const values = await page
    .locator(REVIEW_CARD_SELECTOR)
    .locator("meta[itemprop='datePublished']")
    .evaluateAll((elements) =>
      elements
        .slice(0, 20)
        .map((element) => element.getAttribute("content"))
        .filter((value): value is string => Boolean(value)),
    )
    .catch(() => [] as string[]);
  const timestamps = values.map((value) => Date.parse(value)).filter(Number.isFinite);
  if (timestamps.length < 2) {
    return false;
  }

  return timestamps.every((value, index) => index === 0 || timestamps[index - 1]! >= value);
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

  await waitForTimeout(args.page, nextDelayMs, args.signal);
  args.signal?.throwIfAborted();
  await withAbort(
    args.page.goto(args.sourceUrl, { waitUntil: "domcontentloaded", timeout: 45_000 }),
    args.signal,
  );
  await withAbort(args.page.waitForLoadState("networkidle", { timeout: 20_000 }), args.signal).catch(
    (error: unknown) => {
      args.signal?.throwIfAborted();
      if (!(error instanceof Error) || !error.message.includes("Timeout")) {
        throw error;
      }
    },
  );
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
  return (await extractReviewsWithDiagnostics(page, signal)).reviews;
}

export async function extractReviewsWithDiagnostics(
  page: Page,
  signal?: AbortSignal,
): Promise<{ reviews: YandexMapsReviewDto[]; failedExpansionKeys: string[] }> {
  const cards = page.locator(REVIEW_CARD_SELECTOR);
  const count = await cards.count();
  const reviews: YandexMapsReviewDto[] = [];
  const failedExpansionKeys: string[] = [];

  for (let index = 0; index < count; index += 1) {
    signal?.throwIfAborted();
    const card = cards.nth(index);
    const expansion = await expandReviewText(card, page, signal);
    if (expansion.failureKey !== undefined) {
      failedExpansionKeys.push(expansion.failureKey);
    }
    const review = await extractReview(card);
    if (review !== null) {
      reviews.push(review);
    }
  }

  return { reviews, failedExpansionKeys };
}

async function expandReviewText(
  card: Locator,
  page: Page,
  signal?: AbortSignal,
): Promise<{ failureKey?: string }> {
  signal?.throwIfAborted();
  const button = card.getByText(EXPAND_REVIEW_TEXT).first();
  const visible = await button.isVisible({ timeout: 250 }).catch(() => false);
  if (!visible) {
    return {};
  }

  const beforeText = await firstText(card, [
    ".business-review-view__body-text",
    ".business-review-view__body",
    "[class*='body-text']",
    "[class*='review'][class*='text']",
    "[itemprop='reviewBody']",
  ]);
  const clicked = await clickLocator(button, signal, 2_000);
  const expanded =
    clicked &&
    (await waitForCondition(
      async () => {
        const currentText = await firstText(card, [
          ".business-review-view__body-text",
          ".business-review-view__body",
          "[class*='body-text']",
          "[class*='review'][class*='text']",
          "[itemprop='reviewBody']",
        ]);
        const buttonStillVisible = await button.isVisible({ timeout: 250 }).catch(() => false);
        return normalizeText(currentText) !== normalizeText(beforeText) || !buttonStillVisible;
      },
      2_500,
      page,
      signal,
    ));

  if (expanded) {
    return {};
  }

  const key = normalizeText(beforeText).slice(0, 200) || `card-${await card.getAttribute("data-review-id").catch(() => null) ?? "unknown"}`;
  return { failureKey: key };
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

export async function scrollReviews(page: Page, delayMs: number, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted();
  const before = await page.locator(REVIEW_CARD_SELECTOR).count().catch(() => 0);
  const beforeFingerprint = await reviewListFingerprint(page);
  const cards = page.locator(REVIEW_CARD_SELECTOR);
  if (before === 0) {
    return false;
  }

  const scrollContainer = await findReviewsScrollContainer(page);
  if (scrollContainer === null) {
    return false;
  }

  try {
    await cards.last().scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => undefined);
    signal?.throwIfAborted();
    await scrollContainer.hover().catch(() => undefined);
    await scrollContainer.evaluate((element) => {
      element.scrollTo({ top: element.scrollHeight, behavior: "instant" });
    });
    await page.mouse.wheel(0, 4_000);
    await waitForTimeout(page, Math.max(delayMs, 500), signal);

    return waitForCondition(
      async () => {
        const after = await page.locator(REVIEW_CARD_SELECTOR).count().catch(() => 0);
        if (after > before) {
          return true;
        }
        return (await reviewListFingerprint(page)) !== beforeFingerprint;
      },
      CONTENT_UPDATE_TIMEOUT_MS,
      page,
      signal,
    );
  } finally {
    await scrollContainer.dispose();
  }
}

async function findReviewsScrollContainer(page: Page): Promise<ElementHandle<HTMLElement> | null> {
  const source = page.locator(REVIEWS_CONTAINER_SELECTOR).first();
  if ((await source.count().catch(() => 0)) === 0) {
    return null;
  }

  const handle = await source.evaluateHandle((element) => {
    let current: HTMLElement | null = element.parentElement;
    while (current !== null) {
      const style = getComputedStyle(current);
      if (current.scrollHeight > current.clientHeight && /auto|scroll/.test(style.overflowY)) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  });
  const element = handle.asElement();
  if (element === null) {
    await handle.dispose();
    return null;
  }
  return element as ElementHandle<HTMLElement>;
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

async function waitForCondition(
  condition: () => Promise<boolean>,
  timeoutMs: number,
  page: Page,
  signal?: AbortSignal,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    if (await condition()) {
      return true;
    }
    await waitForTimeout(page, Math.min(250, Math.max(deadline - Date.now(), 0)), signal);
  }
  signal?.throwIfAborted();
  return condition();
}

async function waitForTimeout(page: Page, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  let remaining = timeoutMs;
  while (remaining > 0) {
    signal?.throwIfAborted();
    const chunk = Math.min(remaining, 250);
    await page.waitForTimeout(chunk);
    remaining -= chunk;
  }
  signal?.throwIfAborted();
}

async function clickLocator(locator: Locator, signal?: AbortSignal, timeout = 2_000): Promise<boolean> {
  signal?.throwIfAborted();
  const clicked = await locator
    .click({ timeout })
    .then(() => true)
    .catch(() => false);
  signal?.throwIfAborted();
  return clicked;
}

function withAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) {
    return operation;
  }
  signal.throwIfAborted();

  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export async function clickIfVisible(page: Page, label: RegExp, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted();
  const target = page.getByText(label).first();
  if (!(await target.isVisible({ timeout: 500 }).catch(() => false))) {
    return false;
  }

  return clickLocator(target, signal, 2_000);
}

async function acceptCookiesIfVisible(page: Page, signal?: AbortSignal): Promise<void> {
  await clickIfVisible(page, /принять|соглас|accept|agree/i, signal);
}

export async function isCaptchaOrChallenge(page: Page): Promise<boolean> {
  const url = page.url().toLowerCase();
  if (url.includes("showcaptcha") || url.includes("smartcaptcha") || url.includes("captcha")) {
    return true;
  }

  const text = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
  return /captcha|капч|подтвердите,?\s+что\s+вы\s+не\s+робот|проверяем/i.test(text);
}

import { chromium, type ElementHandle, type Locator, type Page } from "playwright";
import type { AppLogger } from "../../Application/Dependencies/logger.js";
import type {
  PlaywrightYandexMapsReviewSession,
  YandexMapsReviewNavigator,
} from "./playwright-yandex-maps-review-contracts.js";
import {
  EXPAND_REVIEW_TEXT,
  NEWEST_SORT_TEXT,
  REVIEW_BODY_SELECTORS,
  REVIEW_CARD_SELECTOR,
  REVIEWS_CONTAINER_SELECTOR,
  SORT_CONTROL_SELECTOR,
  SORT_OPTION_SELECTOR,
} from "./yandex-maps-review-dom.js";

const MAX_SORT_ATTEMPTS = 3;
const DOM_READY_TIMEOUT_MS = 30_000;
const CONTENT_UPDATE_TIMEOUT_MS = 10_000;

export class PlaywrightYandexMapsReviewNavigator implements YandexMapsReviewNavigator {
  constructor(private readonly logger: AppLogger) {}

  async open(sourceUrl: string, headed: boolean, signal?: AbortSignal): Promise<PlaywrightYandexMapsReviewSession> {
    signal?.throwIfAborted();
    const browser = await chromium.launch({
      headless: !headed,
      slowMo: headed ? 100 : 0,
    });

    try {
      const page = await browser.newPage({
        locale: "ru-RU",
        viewport: { width: 1366, height: 900 },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      });
      await this.navigate(page, sourceUrl, signal);
      return { browser, page };
    } catch (error) {
      await browser.close();
      throw error;
    }
  }

  async prepare(page: Page, delayMs: number, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    await this.acceptCookiesIfVisible(page, signal);
    await this.clickIfVisible(page, /отзывы/i, signal);
    await this.waitForReviewsPageReady(page, signal);
    await this.selectNewestSort(page, signal);
    await this.wait(page, delayMs, signal);
    signal?.throwIfAborted();
    this.logger.debug("Reviews page prepared.");
  }

  async reload(page: Page, sourceUrl: string, signal?: AbortSignal): Promise<void> {
    await this.navigate(page, sourceUrl, signal);
  }

  async expandReviewTexts(page: Page, signal?: AbortSignal): Promise<void> {
    const cards = page.locator(REVIEW_CARD_SELECTOR);
    const count = await cards.count();

    for (let index = 0; index < count; index += 1) {
      signal?.throwIfAborted();
      await this.expandReviewText(cards.nth(index), page, signal);
    }
  }

  async scroll(page: Page, delayMs: number, signal?: AbortSignal): Promise<boolean> {
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
      await this.wait(page, Math.max(delayMs, 500), signal);

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

  async wait(page: Page, timeoutMs: number, signal?: AbortSignal): Promise<void> {
    let remaining = timeoutMs;
    while (remaining > 0) {
      signal?.throwIfAborted();
      const chunk = Math.min(remaining, 250);
      await page.waitForTimeout(chunk);
      remaining -= chunk;
    }
    signal?.throwIfAborted();
  }

  async close(session: PlaywrightYandexMapsReviewSession | undefined): Promise<void> {
    await session?.browser.close();
  }

  async waitForReviewsPageReady(page: Page, signal?: AbortSignal): Promise<void> {
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

  async selectNewestSort(page: Page, signal?: AbortSignal): Promise<void> {
    const control = page.locator(SORT_CONTROL_SELECTOR).first();

    for (let attempt = 1; attempt <= MAX_SORT_ATTEMPTS; attempt += 1) {
      signal?.throwIfAborted();
      const beforeFingerprint = await reviewListFingerprint(page);

      const opened = await clickLocator(control, signal, 3_000);
      if (!opened) {
        this.logger.debug("Could not open the review sort popup.", { attempt });
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
        this.logger.debug("Could not click the newest-first sort option.", { attempt });
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
        this.logger.debug("Newest-first review sort confirmed.", { attempt });
        return;
      }

      this.logger.debug("Newest-first review sort was not confirmed after clicking.", { attempt });
    }

    throw new Error(`Could not confirm newest-first review sorting after ${MAX_SORT_ATTEMPTS} attempts.`);
  }

  async clickIfVisible(page: Page, label: RegExp, signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted();
    const target = page.getByText(label).first();
    if (!(await target.isVisible({ timeout: 500 }).catch(() => false))) {
      return false;
    }

    return clickLocator(target, signal, 2_000);
  }

  private async navigate(page: Page, sourceUrl: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    this.logger.debug("Opening reviews page.");
    await withAbort(page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 45_000 }), signal);
    signal?.throwIfAborted();
    await withAbort(page.waitForLoadState("networkidle", { timeout: 20_000 }), signal).catch((error: unknown) => {
      signal?.throwIfAborted();
      if (!(error instanceof Error) || !error.message.includes("Timeout")) {
        throw error;
      }
    });
  }

  private async acceptCookiesIfVisible(page: Page, signal?: AbortSignal): Promise<void> {
    await this.clickIfVisible(page, /принять|соглас|accept|agree/i, signal);
  }

  private async expandReviewText(card: Locator, page: Page, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const roleButton = card.getByRole("button", { name: EXPAND_REVIEW_TEXT }).first();
    const roleButtonVisible = await roleButton.isVisible({ timeout: 250 }).catch(() => false);
    const button = roleButtonVisible ? roleButton : card.getByText(EXPAND_REVIEW_TEXT).first();
    const visible = roleButtonVisible || (await button.isVisible({ timeout: 250 }).catch(() => false));
    if (!visible) {
      return;
    }

    const beforeText = await firstText(card, REVIEW_BODY_SELECTORS);
    const clicked = await clickLocator(button, signal, 2_000);
    if (!clicked) {
      return;
    }

    await waitForCondition(
      async () => {
        const currentText = await firstText(card, REVIEW_BODY_SELECTORS);
        const buttonStillVisible = await button.isVisible({ timeout: 250 }).catch(() => false);
        return normalizeText(currentText) !== normalizeText(beforeText) || !buttonStillVisible;
      },
      2_500,
      page,
      signal,
    );
  }
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

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

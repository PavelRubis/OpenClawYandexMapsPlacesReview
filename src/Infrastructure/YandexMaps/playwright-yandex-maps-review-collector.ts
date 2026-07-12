import type { Page } from "playwright";
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
import { findResumeIndex, mergeUniqueReviews } from "../../dedupe.js";
import { normalizeYandexMapsReviewsUrl } from "../../yandex-url.js";
import type {
  ExtractedReviews,
  PlaywrightYandexMapsReviewSession,
  YandexMapsReviewNavigator,
  YandexMapsReviewParser,
} from "./playwright-yandex-maps-review-contracts.js";
import { PlaywrightYandexMapsReviewNavigator } from "./playwright-yandex-maps-review-navigator.js";
import { PlaywrightYandexMapsReviewParser } from "./playwright-yandex-maps-review-parser.js";

const MAX_SCROLLS = 140;
const MAX_CAPTCHA_RELOADS = 4;
const BASE_DELAY_MS = 450;
const SLOW_DELAY_MS = 1_600;

type CollectionStats = {
  attempts: number;
  captchaReloads: number;
  scrolls: number;
  duplicatesSkipped: number;
  logLevel: LogLevel;
};

export type PlaywrightYandexMapsReviewCollectorOptions = {
  logger: AppLogger;
  clock: Clock;
  navigator: YandexMapsReviewNavigator;
  parser: YandexMapsReviewParser;
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
    const stats: CollectionStats = {
      attempts: 1,
      captchaReloads: 0,
      scrolls: 0,
      duplicatesSkipped: 0,
      logLevel: this.options.logger.level,
    };

    let session: PlaywrightYandexMapsReviewSession | undefined;
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
      session = await this.options.navigator.open(sourceUrl, Boolean(input.headed), options?.signal);
      await this.options.navigator.prepare(session.page, delayMs, options?.signal);

      for (let scroll = 0; scroll < MAX_SCROLLS && reviews.length < requestedCount; scroll += 1) {
        options?.signal?.throwIfAborted();

        if (await this.options.parser.isCaptchaOrChallenge(session.page)) {
          const resumed = await this.recoverFromCaptcha({
            session,
            sourceUrl,
            collected: reviews,
            delayMs,
            stats,
            warnings,
            signal: options?.signal,
          });
          delayMs = resumed.delayMs;
          if (!resumed.recovered) {
            break;
          }
        }

        await this.options.navigator.expandReviewTexts(session.page, options?.signal);
        const extracted = await this.options.parser.extractReviewsWithDiagnostics(session.page, options?.signal);
        for (const key of extracted.failedExpansionKeys) {
          failedReviewExpansionKeys.add(key);
        }

        const pageReviews = extracted.reviews;
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

        const moved = await this.options.navigator.scroll(session.page, delayMs, options?.signal);
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
      await this.options.navigator.close(session);
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

  private async recoverFromCaptcha(args: {
    session: PlaywrightYandexMapsReviewSession;
    sourceUrl: string;
    collected: YandexMapsReviewDto[];
    delayMs: number;
    stats: CollectionStats;
    warnings: string[];
    signal?: AbortSignal;
  }): Promise<{ recovered: boolean; delayMs: number }> {
    args.signal?.throwIfAborted();
    args.stats.captchaReloads += 1;
    args.stats.attempts += 1;
    const nextDelayMs = Math.max(args.delayMs * 2, SLOW_DELAY_MS);
    const lastText = args.collected.at(-1)?.text;

    this.options.logger.warn("CAPTCHA or challenge screen detected. Reloading and slowing down.", {
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

    await this.options.navigator.wait(args.session.page, nextDelayMs, args.signal);
    await this.options.navigator.reload(args.session.page, args.sourceUrl, args.signal);
    await this.options.navigator.prepare(args.session.page, nextDelayMs, args.signal);

    if (lastText !== undefined) {
      await this.scrollUntilText(args.session.page, lastText, nextDelayMs, args.signal);
    }

    return { recovered: true, delayMs: nextDelayMs };
  }

  private async scrollUntilText(
    page: Page,
    text: string,
    delayMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
    for (let index = 0; index < 50; index += 1) {
      signal?.throwIfAborted();
      await this.options.navigator.expandReviewTexts(page, signal);
      const reviews = await this.options.parser.extractReviews(page, signal);
      if (findResumeIndex(reviews, text) !== -1) {
        this.options.logger.debug("Resume review found after reload.", { scrolls: index });
        return;
      }
      const moved = await this.options.navigator.scroll(page, delayMs, signal);
      if (!moved) {
        return;
      }
    }
  }
}

const silentLogger: AppLogger = {
  level: "silent",
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
};

export async function waitForReviewsPageReady(page: Page, signal?: AbortSignal): Promise<void> {
  return new PlaywrightYandexMapsReviewNavigator(silentLogger).waitForReviewsPageReady(page, signal);
}

export async function selectNewestSort(page: Page, logger: AppLogger, signal?: AbortSignal): Promise<void> {
  return new PlaywrightYandexMapsReviewNavigator(logger).selectNewestSort(page, signal);
}

export async function extractReviewsFromPage(page: Page, signal?: AbortSignal): Promise<YandexMapsReviewDto[]> {
  const navigator = new PlaywrightYandexMapsReviewNavigator(silentLogger);
  await navigator.expandReviewTexts(page, signal);
  return new PlaywrightYandexMapsReviewParser().extractReviews(page, signal);
}

export async function extractReviewsWithDiagnostics(page: Page, signal?: AbortSignal): Promise<ExtractedReviews> {
  const navigator = new PlaywrightYandexMapsReviewNavigator(silentLogger);
  await navigator.expandReviewTexts(page, signal);
  return new PlaywrightYandexMapsReviewParser().extractReviewsWithDiagnostics(page, signal);
}

export async function scrollReviews(page: Page, delayMs: number, signal?: AbortSignal): Promise<boolean> {
  return new PlaywrightYandexMapsReviewNavigator(silentLogger).scroll(page, delayMs, signal);
}

export async function clickIfVisible(page: Page, label: RegExp, signal?: AbortSignal): Promise<boolean> {
  return new PlaywrightYandexMapsReviewNavigator(silentLogger).clickIfVisible(page, label, signal);
}

export async function isCaptchaOrChallenge(page: Page): Promise<boolean> {
  return new PlaywrightYandexMapsReviewParser().isCaptchaOrChallenge(page);
}

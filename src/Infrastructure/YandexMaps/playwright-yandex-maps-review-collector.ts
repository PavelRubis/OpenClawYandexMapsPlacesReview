import type { Page } from "playwright";
import type { Clock } from "../../Application/Dependencies/clock.js";
import type { AppLogger } from "../../Application/Dependencies/logger.js";
import type { YandexMapsReviewCollector } from "../../Application/Dependencies/yandex-maps-review-collector.js";
import type {
  CollectYandexMapsPlaceReviewsInputDto,
  GetYandexMapsPlaceReviewsOutputDto,
  LogLevel,
  YandexMapsReviewDto,
} from "../../Application/Dtos/yandex-maps-place-reviews.dto.js";
import type {
  PlaywrightYandexMapsReviewSession,
  YandexMapsReviewNavigator,
  YandexMapsReviewParser,
} from "./playwright-yandex-maps-review-contracts.js";

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
    input: CollectYandexMapsPlaceReviewsInputDto,
    options?: {
      signal?: AbortSignal;
    },
  ): Promise<GetYandexMapsPlaceReviewsOutputDto> {
    const requestedCount = input.count;
    const sourceUrl = input.url;
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

        const pageReviews = extracted.reviews;
        reviews = this.replaceTruncatedReviews(reviews, pageReviews);
        const resumeIndex =
          reviews.length > 0 ? this.findResumeIndex(pageReviews, reviews[reviews.length - 1]?.text ?? "") : -1;
        const newPageReviews = resumeIndex === -1 ? pageReviews : pageReviews.slice(resumeIndex + 1);
        const previousReviewCount = reviews.length;
        const merged = this.mergeUniqueReviews(reviews, newPageReviews);
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
      const truncatedReviewCount = reviews.filter(
        (review) => this.truncatedTextPrefix(review.text) !== undefined,
      ).length;
      if (truncatedReviewCount > 0) {
        warnings.push(
          `Could not expand the full text of ${truncatedReviewCount} review${truncatedReviewCount === 1 ? "" : "s"}; visible text was returned.`,
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
      if (this.findResumeIndex(reviews, text) !== -1) {
        this.options.logger.debug("Resume review found after reload.", { scrolls: index });
        return;
      }
      const moved = await this.options.navigator.scroll(page, delayMs, signal);
      if (!moved) {
        return;
      }
    }
  }

  private mergeUniqueReviews(
    existing: YandexMapsReviewDto[],
    incoming: YandexMapsReviewDto[],
  ): { reviews: YandexMapsReviewDto[]; duplicates: number } {
    const seen = new Set(existing.map((review) => this.reviewKey(review)));
    const reviews = [...existing];
    let duplicates = 0;

    for (const review of incoming) {
      const key = this.reviewKey(review);
      if (seen.has(key)) {
        duplicates += 1;
        continue;
      }

      seen.add(key);
      reviews.push(review);
    }

    return { reviews, duplicates };
  }

  private replaceTruncatedReviews(
    existing: YandexMapsReviewDto[],
    incoming: YandexMapsReviewDto[],
  ): YandexMapsReviewDto[] {
    return existing.map((review) => {
      const truncatedPrefix = this.truncatedTextPrefix(review.text);
      if (truncatedPrefix === undefined) {
        return review;
      }

      const replacement = incoming.find((candidate) => {
        if (candidate.date.trim() !== review.date.trim()) {
          return false;
        }
        if (review.url !== undefined && candidate.url !== undefined && review.url !== candidate.url) {
          return false;
        }

        const candidateText = this.normalizeText(candidate.text);
        return candidateText.length > truncatedPrefix.length && candidateText.startsWith(truncatedPrefix);
      });

      return replacement === undefined
        ? review
        : { ...replacement, ...(replacement.url === undefined && review.url !== undefined ? { url: review.url } : {}) };
    });
  }

  private truncatedTextPrefix(text: string): string | undefined {
    const normalized = this.normalizeText(text);
    if (!/(?:…|\.\.\.)\s*(?:ещ[её]|more)$/i.test(normalized)) {
      return undefined;
    }
    return normalized.replace(/(?:…|\.\.\.)\s*(?:ещ[её]|more)$/i, "").trim();
  }

  private reviewKey(review: YandexMapsReviewDto): string {
    return `text:${review.date.trim()}|${this.normalizeText(review.text)}`;
  }

  private normalizeText(text: string): string {
    return text.replace(/\s+/g, " ").trim();
  }

  private findResumeIndex(reviews: YandexMapsReviewDto[], lastText: string): number {
    const normalizedLastText = this.normalizeText(lastText);
    return reviews.findIndex((review) => this.normalizeText(review.text) === normalizedLastText);
  }
}

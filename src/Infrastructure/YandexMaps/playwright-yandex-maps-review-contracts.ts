import type { Browser, Page } from "playwright";
import type { YandexMapsReviewDto } from "../../Application/Dtos/yandex-maps-place-reviews.dto.js";

export type PlaywrightYandexMapsReviewSession = {
  browser: Browser;
  page: Page;
};

export type ExtractedReviews = {
  reviews: YandexMapsReviewDto[];
  failedExpansionKeys: string[];
};

export interface YandexMapsReviewNavigator {
  open(sourceUrl: string, headed: boolean, signal?: AbortSignal): Promise<PlaywrightYandexMapsReviewSession>;
  prepare(page: Page, delayMs: number, signal?: AbortSignal): Promise<void>;
  reload(page: Page, sourceUrl: string, signal?: AbortSignal): Promise<void>;
  expandReviewTexts(page: Page, signal?: AbortSignal): Promise<void>;
  scroll(page: Page, delayMs: number, signal?: AbortSignal): Promise<boolean>;
  wait(page: Page, timeoutMs: number, signal?: AbortSignal): Promise<void>;
  close(session: PlaywrightYandexMapsReviewSession | undefined): Promise<void>;
}

export interface YandexMapsReviewParser {
  extractReviews(page: Page, signal?: AbortSignal): Promise<YandexMapsReviewDto[]>;
  extractReviewsWithDiagnostics(page: Page, signal?: AbortSignal): Promise<ExtractedReviews>;
  isCaptchaOrChallenge(page: Page): Promise<boolean>;
}

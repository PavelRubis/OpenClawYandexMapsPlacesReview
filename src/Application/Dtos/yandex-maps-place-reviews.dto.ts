export const DEFAULT_REVIEW_COUNT = 100;
export const MIN_REVIEW_COUNT = 1;
export const MAX_REVIEW_COUNT = 500;

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

export type YandexMapsReviewDto = {
  url?: string;
  date: string;
  text: string;
};

export type GetYandexMapsPlaceReviewsInputDto = {
  url: string;
  count?: number;
  headed?: boolean;
};

export type GetYandexMapsPlaceReviewsOutputDto = {
  sourceUrl: string;
  requestedCount: number;
  fetchedAt: string;
  reviews: YandexMapsReviewDto[];
  stats: {
    attempts: number;
    captchaReloads: number;
    scrolls: number;
    duplicatesSkipped: number;
    logLevel: LogLevel;
  };
  warnings?: string[];
};

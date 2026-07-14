import type { Browser, Page } from "playwright";
import { describe, expect, it } from "vitest";
import type { Clock } from "../../Application/Dependencies/clock.js";
import type { AppLogger } from "../../Application/Dependencies/logger.js";
import type { YandexMapsReviewDto } from "../../Application/Dtos/yandex-maps-place-reviews.dto.js";
import { PlaywrightYandexMapsReviewCollector } from "../../Infrastructure/YandexMaps/playwright-yandex-maps-review-collector.js";
import type {
  ExtractedReviews,
  PlaywrightYandexMapsReviewSession,
  YandexMapsReviewNavigator,
  YandexMapsReviewParser,
} from "../../Infrastructure/YandexMaps/playwright-yandex-maps-review-contracts.js";

const clock: Clock = {
  now: () => new Date("2026-07-12T12:00:00.000Z"),
};

const logger: AppLogger = {
  level: "silent",
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
};

describe("PlaywrightYandexMapsReviewCollector orchestration", () => {
  it("normalizes resume text, deduplicates by date and text, and ignores the URL", async () => {
    const navigator = new FakeNavigator();
    const parser = new FakeParser([
      extracted([
        { url: "https://example.test/one", date: "2026-07-01", text: "First review" },
        { date: "2026-07-02", text: "Resume Point" },
      ]),
      extracted([
        { url: "https://example.test/one", date: "2026-07-01", text: "First review" },
        { date: "2026-07-02", text: "Resume   Point" },
        { url: "https://example.test/two", date: "2026-07-01", text: " First   review " },
        { url: "https://example.test/three", date: "2026-07-03", text: "First review" },
      ]),
    ]);
    const collector = createCollector(navigator, parser);

    const result = await collector.collect({ url: placeUrl, count: 3 });

    expect(result.reviews).toEqual([
      { url: "https://example.test/one", date: "2026-07-01", text: "First review" },
      { date: "2026-07-02", text: "Resume Point" },
      { url: "https://example.test/three", date: "2026-07-03", text: "First review" },
    ]);
    expect(result.stats.duplicatesSkipped).toBe(1);
    expect(result.stats.scrolls).toBe(1);
    expect(navigator.closedSessions).toEqual([navigator.session]);
  });

  it("stops after two scans without new reviews and preserves the warning text", async () => {
    const navigator = new FakeNavigator();
    const parser = new FakeParser([
      extracted([review("1")]),
      extracted([review("1")]),
      extracted([review("1")]),
    ]);
    const collector = createCollector(navigator, parser);

    const result = await collector.collect({ url: placeUrl, count: 5 });

    expect(result.reviews).toHaveLength(1);
    expect(result.warnings).toEqual([
      "Stopped after 2 scans without new unique reviews; returning 1 reviews.",
    ]);
    expect(result.stats.scrolls).toBe(2);
  });

  it("replaces an earlier truncated review with its expanded text on a later scan", async () => {
    const navigator = new FakeNavigator();
    const parser = new FakeParser([
      extracted(
        [
          { date: "2026-07-02", text: "A sufficiently distinctive long review prefix… ещё" },
          { date: "2026-07-01", text: "Resume point" },
        ],
        ["A sufficiently distinctive long review prefix"],
      ),
      extracted([
        {
          date: "2026-07-02",
          text: "A sufficiently distinctive long review prefix with the complete ending.",
        },
        { date: "2026-07-01", text: "Resume point" },
        { date: "2026-06-30", text: "Third review" },
      ]),
    ]);
    const collector = createCollector(navigator, parser);

    const result = await collector.collect({ url: placeUrl, count: 3 });

    expect(result.reviews).toEqual([
      {
        date: "2026-07-02",
        text: "A sufficiently distinctive long review prefix with the complete ending.",
      },
      { date: "2026-07-01", text: "Resume point" },
      { date: "2026-06-30", text: "Third review" },
    ]);
    expect(result.warnings).toBeUndefined();
  });

  it("recovers from CAPTCHA, resumes after the last review, and increases the delay", async () => {
    const navigator = new FakeNavigator();
    const parser = new FakeParser(
      [extracted([review("1")]), extracted([review("1"), review("2")])],
      [false, true],
      [review("1")],
    );
    const collector = createCollector(navigator, parser);

    const result = await collector.collect({ url: placeUrl, count: 2 });

    expect(result.stats).toMatchObject({ attempts: 2, captchaReloads: 1 });
    expect(navigator.reloadCalls).toBe(1);
    expect(navigator.waitDelays).toContain(1_600);
    expect(result.reviews).toHaveLength(2);
  });

  it("returns the CAPTCHA exhaustion warning after the configured retry limit", async () => {
    const navigator = new FakeNavigator();
    const parser = new FakeParser(
      [extracted([review("1")]), extracted([review("2")]), extracted([review("3")]), extracted([review("4")])],
      [true, true, true, true, true],
      [review("1"), review("2"), review("3"), review("4")],
    );
    const collector = createCollector(navigator, parser);

    const result = await collector.collect({ url: placeUrl, count: 10 });

    expect(result.stats).toMatchObject({ attempts: 6, captchaReloads: 5 });
    expect(result.warnings).toContain("CAPTCHA/challenge remained after 4 reloads; returning 4 reviews.");
    expect(navigator.reloadCalls).toBe(4);
  });

  it("stops at the scroll limit", async () => {
    const navigator = new FakeNavigator();
    const parser = new FakeParser(
      Array.from({ length: 140 }, (_, index) => extracted([review(String(index))])),
    );
    const collector = createCollector(navigator, parser);

    const result = await collector.collect({ url: placeUrl, count: 500 });

    expect(result.stats.scrolls).toBe(140);
    expect(result.reviews).toHaveLength(140);
    expect(result.warnings).toContain("Stopped after 140 scrolls with 140 reviews collected.");
  });

  it("honors cancellation and closes an opened session", async () => {
    const controller = new AbortController();
    const navigator = new FakeNavigator();
    navigator.prepareError = () => {
      controller.abort();
      controller.signal.throwIfAborted();
    };
    const collector = createCollector(navigator, new FakeParser([]));

    await expect(
      collector.collect({ url: placeUrl, count: 1 }, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(navigator.closedSessions).toEqual([navigator.session]);
  });

  it("closes the session when parsing fails", async () => {
    const navigator = new FakeNavigator();
    const parser = new FakeParser([]);
    parser.extractionError = new Error("DOM changed");
    const collector = createCollector(navigator, parser);

    await expect(collector.collect({ url: placeUrl, count: 1 })).rejects.toThrow("DOM changed");
    expect(navigator.closedSessions).toEqual([navigator.session]);
  });
});

class FakeNavigator implements YandexMapsReviewNavigator {
  readonly session = {
    browser: {} as Browser,
    page: {} as Page,
  };
  readonly closedSessions: Array<PlaywrightYandexMapsReviewSession | undefined> = [];
  readonly waitDelays: number[] = [];
  reloadCalls = 0;
  prepareError?: () => never;

  async open(): Promise<PlaywrightYandexMapsReviewSession> {
    return this.session;
  }

  async prepare(): Promise<void> {
    this.prepareError?.();
  }

  async reload(): Promise<void> {
    this.reloadCalls += 1;
  }

  async expandReviewTexts(): Promise<void> {}

  async scroll(): Promise<boolean> {
    return true;
  }

  async wait(_page: Page, timeoutMs: number): Promise<void> {
    this.waitDelays.push(timeoutMs);
  }

  async close(session: PlaywrightYandexMapsReviewSession | undefined): Promise<void> {
    this.closedSessions.push(session);
  }
}

class FakeParser implements YandexMapsReviewParser {
  private extractionIndex = 0;
  private captchaIndex = 0;
  extractionError?: Error;

  constructor(
    private readonly extractions: ExtractedReviews[],
    private readonly captchaResults: boolean[] = [],
    private readonly resumeReviews: YandexMapsReviewDto[] = [],
  ) {}

  async extractReviews(): Promise<YandexMapsReviewDto[]> {
    return this.resumeReviews;
  }

  async extractReviewsWithDiagnostics(): Promise<ExtractedReviews> {
    if (this.extractionError !== undefined) {
      throw this.extractionError;
    }
    const result = this.extractions[this.extractionIndex] ?? extracted([]);
    this.extractionIndex += 1;
    return result;
  }

  async isCaptchaOrChallenge(): Promise<boolean> {
    const result = this.captchaResults[this.captchaIndex] ?? false;
    this.captchaIndex += 1;
    return result;
  }
}

function createCollector(navigator: YandexMapsReviewNavigator, parser: YandexMapsReviewParser) {
  return new PlaywrightYandexMapsReviewCollector({ logger, clock, navigator, parser });
}

function extracted(reviews: YandexMapsReviewDto[], failedExpansionKeys: string[] = []): ExtractedReviews {
  return { reviews, failedExpansionKeys };
}

function review(id: string): YandexMapsReviewDto {
  return {
    date: `2026-07-${id.padStart(2, "0")}`,
    text: `Review ${id}`,
  };
}

const placeUrl = "https://yandex.ru/maps/org/test/1/reviews/";

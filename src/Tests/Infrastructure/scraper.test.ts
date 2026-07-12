import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppLogger } from "../../Application/Dependencies/logger.js";
import {
  clickIfVisible,
  extractReviewsWithDiagnostics,
  extractReviewsFromPage,
  isCaptchaOrChallenge,
  scrollReviews,
  selectNewestSort,
  waitForReviewsPageReady,
} from "../../Infrastructure/YandexMaps/playwright-yandex-maps-review-collector.js";

let browser: Browser | undefined;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
});

describe("scraper browser helpers", () => {
  it("extracts date, text, and link from local fixture HTML", async () => {
    const page = await browser!.newPage();
    await page.setContent(`
      <article class="business-review-view">
        <time datetime="2026-07-05">5 июля 2026</time>
        <a href="/maps/org/test/1/reviews/abc">share</a>
        <div class="business-review-view__body-text">Очень вкусный кофе</div>
      </article>
      <article class="business-review-view">
        <div class="business-review-view__date">вчера</div>
        <div class="business-review-view__body-text">Приветливый персонал</div>
      </article>
    `);

    await expect(extractReviewsFromPage(page)).resolves.toEqual([
      {
        url: "https://yandex.ru/maps/org/test/1/reviews/abc",
        date: "2026-07-05",
        text: "Очень вкусный кофе",
      },
      {
        date: "вчера",
        text: "Приветливый персонал",
      },
    ]);
    await page.close();
  });

  it("detects a captcha-like challenge page", async () => {
    const page = await browser!.newPage();
    await page.setContent("<main>Подтвердите, что вы не робот</main>");

    await expect(isCaptchaOrChallenge(page)).resolves.toBe(true);
    await page.close();
  });

  it("selects newest-first sorting and confirms descending review dates", async () => {
    const page = await browser!.newPage();
    await page.setContent(sortFixtureHtml());

    await selectNewestSort(page, silentLogger);

    expect(await page.locator(".rating-ranking-view").innerText()).toBe("По новизне");
    expect(await page.locator(".business-review-view__date").allInnerTexts()).toEqual(["11 июля", "8 июля"]);
    await page.close();
  });

  it(
    "fails when newest-first sorting cannot be selected",
    async () => {
      const page = await browser!.newPage();
      await page.setContent(`
        <div role="button" class="rating-ranking-view">По умолчанию</div>
        <div class="business-reviews-card-view__reviews-container">
          ${reviewCard("2026-07-08T00:00:00.000Z", "8 июля", "Восьмое июля")}
          ${reviewCard("2026-07-11T00:00:00.000Z", "11 июля", "Одиннадцатое июля")}
        </div>
      `);

      await expect(selectNewestSort(page, silentLogger)).rejects.toThrow(
        "Could not confirm newest-first review sorting after 3 attempts.",
      );
      await page.close();
    },
    15_000,
  );

  it("expands only an exact review-more control", async () => {
    const page = await browser!.newPage();
    await page.setContent(`
      <div class="business-review-view">
        <meta itemprop="datePublished" content="2026-07-11T00:00:00.000Z">
        <div class="business-review-view__body-text">Помещение уютное</div>
      </div>
      <div class="business-review-view">
        <meta itemprop="datePublished" content="2026-07-10T00:00:00.000Z">
        <div class="business-review-view__body-text" id="expandable">Короткий текст… ещё</div>
        <button id="more">ещё</button>
      </div>
      <script>
        window.unrelatedClicks = 0;
        document.querySelector('.business-review-view')?.addEventListener('click', () => window.unrelatedClicks += 1);
        document.querySelector('#more')?.addEventListener('click', (event) => {
          event.currentTarget.remove();
          document.querySelector('#expandable').textContent = 'Полный текст отзыва';
        });
      </script>
    `);

    const reviews = await extractReviewsFromPage(page);

    expect(reviews.map((review) => review.text)).toEqual(["Помещение уютное", "Полный текст отзыва"]);
    expect(await page.evaluate(() => (window as unknown as { unrelatedClicks: number }).unrelatedClicks)).toBe(0);
    await page.close();
  });

  it("returns false when a visible target cannot be clicked", async () => {
    const page = await browser!.newPage();
    await page.setContent("<button disabled>Принять</button>");

    await expect(clickIfVisible(page, /^Принять$/i)).resolves.toBe(false);
    await page.close();
  });

  it("reports a review whose full text cannot be expanded", async () => {
    const page = await browser!.newPage();
    await page.setContent(`
      <article class="business-review-view">
        <meta itemprop="datePublished" content="2026-07-11T00:00:00.000Z">
        <div class="business-review-view__body-text">Короткий текст… ещё</div>
        <button disabled>ещё</button>
      </article>
    `);

    const result = await extractReviewsWithDiagnostics(page);

    expect(result.reviews[0]?.text).toBe("Короткий текст… ещё");
    expect(result.failedExpansionKeys).toHaveLength(1);
    await page.close();
  });

  it("loads the next review batch through the closest scroll container", async () => {
    const page = await browser!.newPage();
    await page.setContent(scrollFixtureHtml(true));

    await expect(scrollReviews(page, 0)).resolves.toBe(true);
    expect(await page.locator(".business-review-view").count()).toBe(100);
    await page.close();
  });

  it(
    "reports no movement at the end and ignores unrelated scroll panels",
    async () => {
      const page = await browser!.newPage();
      await page.setContent(scrollFixtureHtml(false));

      await expect(scrollReviews(page, 0)).resolves.toBe(false);
      expect(await page.locator(".unrelated-scroll").evaluate((element) => element.scrollTop)).toBe(0);
      await page.close();
    },
    15_000,
  );

  it("honors cancellation while waiting for the reviews DOM", async () => {
    const page = await browser!.newPage();
    await page.setContent("<main>Loading</main>");
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);

    await expect(waitForReviewsPageReady(page, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    await page.close();
  });

  it("honors cancellation while expanding a review", async () => {
    const page = await browser!.newPage();
    await page.setContent(`
      <article class="business-review-view">
        <meta itemprop="datePublished" content="2026-07-11T00:00:00.000Z">
        <div class="business-review-view__body-text">Короткий текст… ещё</div>
        <button>ещё</button>
      </article>
    `);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);

    await expect(extractReviewsFromPage(page, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    await page.close();
  });

  it("honors cancellation while waiting for a new review batch", async () => {
    const page = await browser!.newPage();
    await page.setContent(scrollFixtureHtml(false));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);

    await expect(scrollReviews(page, 0, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    await page.close();
  });
});

const silentLogger: AppLogger = {
  level: "silent",
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
};

function sortFixtureHtml(): string {
  return `
    <div role="button" class="rating-ranking-view">По умолчанию</div>
    <div class="sort-popup" hidden>
      <div class="rating-ranking-view__popup-line">По умолчанию</div>
      <div class="rating-ranking-view__popup-line" id="newest">По новизне</div>
    </div>
    <div class="business-reviews-card-view__reviews-container" id="reviews">
      ${reviewCard("2026-07-08T00:00:00.000Z", "8 июля", "Восьмое июля")}
      ${reviewCard("2026-07-11T00:00:00.000Z", "11 июля", "Одиннадцатое июля")}
    </div>
    <script>
      const control = document.querySelector('.rating-ranking-view');
      const popup = document.querySelector('.sort-popup');
      control.addEventListener('click', () => popup.hidden = false);
      document.querySelector('#newest').addEventListener('click', () => {
        control.textContent = 'По новизне';
        popup.hidden = true;
        const reviews = document.querySelector('#reviews');
        reviews.prepend(reviews.lastElementChild);
      });
    </script>
  `;
}

function scrollFixtureHtml(loadMore: boolean): string {
  const cards = Array.from({ length: 50 }, (_, index) =>
    reviewCard(
      new Date(Date.UTC(2026, 6, 11, 0, 0, -index)).toISOString(),
      `Дата ${index}`,
      `Отзыв ${index}`,
    ),
  ).join("");

  return `
    <style>
      .scroll__container { height: 200px; overflow-y: scroll; }
      .business-review-view { height: 40px; }
      .unrelated-scroll { height: 20px; overflow-y: scroll; }
      .unrelated-scroll > div { height: 100px; }
    </style>
    <div class="unrelated-scroll"><div>Посторонняя панель</div></div>
    <div class="scroll__container">
      <div class="business-reviews-card-view__reviews-container" id="reviews">${cards}</div>
    </div>
    <script>
      let loaded = false;
      document.querySelector('.scroll__container').addEventListener('scroll', () => {
        if (!${String(loadMore)} || loaded) return;
        loaded = true;
        const reviews = document.querySelector('#reviews');
        for (let index = 50; index < 100; index += 1) {
          const card = document.createElement('article');
          card.className = 'business-review-view';
          card.innerHTML = '<meta itemprop="datePublished" content="2026-07-10T00:00:00.000Z"><div class="business-review-view__date">Дата ' + index + '</div><div class="business-review-view__body-text">Отзыв ' + index + '</div>';
          reviews.append(card);
        }
      });
    </script>
  `;
}

function reviewCard(date: string, label: string, text: string): string {
  return `<article class="business-review-view"><meta itemprop="datePublished" content="${date}"><div class="business-review-view__date">${label}</div><div class="business-review-view__body-text">${text}</div></article>`;
}

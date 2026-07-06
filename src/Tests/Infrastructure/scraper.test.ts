import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractReviewsFromPage, isCaptchaOrChallenge } from "../../scraper.js";

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
});

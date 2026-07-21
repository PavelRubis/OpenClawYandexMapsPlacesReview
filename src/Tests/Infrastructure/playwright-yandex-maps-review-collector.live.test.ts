import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createToolCallHandlers } from "../../Composition/create-tool-call-handlers.js";

const liveUrl =
  process.env.YANDEX_MAPS_PLACE_URL ??
  "https://yandex.com/maps/213/moscow/?indoorLevel=1&ll=37.586531%2C55.805508&mode=poi&poi%5Bpoint%5D=37.584962%2C55.805483&poi%5Buri%5D=ymapsbm1%3A%2F%2Forg%3Foid%3D22642467915&source=serp_navig&tab=reviews&utm_source=share&z=18.4";
const liveCount = normalizeLiveCount(process.env.YANDEX_MAPS_REVIEW_COUNT);
const headed = process.env.HEADED === "1";

describe("live Yandex Maps review collector", () => {
  it(
    "collects recent reviews from a real Yandex Maps place page",
    async () => {
      const handlers = createToolCallHandlers({ logLevel: "info" });
      const result = await handlers.getYandexMapsPlaceReviews
        .handle({
          url: liveUrl,
          count: liveCount,
          headed,
        })
        .catch(async (error: unknown) => {
          await writeLiveOutput({
            status: "failed",
            sourceUrl: liveUrl,
            requestedCount: liveCount,
            failedAt: new Date().toISOString(),
            error: serializeError(error),
          });
          throw error;
        });

      await writeLiveOutput(result);

      const resultUrl = new URL(result.sourceUrl);
      expect(resultUrl.pathname.includes("/reviews/") || resultUrl.searchParams.get("tab") === "reviews").toBe(true);
      expect(result.requestedCount).toBe(liveCount);
      expect(result.reviews).toHaveLength(liveCount);

      const timestamps = result.reviews.map((review) => Date.parse(review.date));
      for (const [index, review] of result.reviews.entries()) {
        expect(review.date.trim()).not.toBe("");
        expect(review.text.trim()).not.toBe("");
        expect(review.text).not.toMatch(/…\s*ещё\s*$/i);
        expect(timestamps[index]).not.toBeNaN();
        if (index > 0) {
          expect(timestamps[index - 1]).toBeGreaterThanOrEqual(timestamps[index]!);
        }
      }
    },
    300_000,
  );
});

async function writeLiveOutput(value: unknown): Promise<void> {
  if (!headed && process.env.YANDEX_MAPS_OUTPUT_FILE === undefined) {
    return;
  }

  const outputPath = resolve(
    process.env.YANDEX_MAPS_OUTPUT_FILE ?? "artifacts/yandex-maps-reviews.headed.json",
  );
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  console.info(`Live-test output written to ${outputPath}`);
}

function serializeError(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }

  return {
    name: "UnknownError",
    message: String(error),
  };
}

function normalizeLiveCount(value: string | undefined): number {
  if (value === undefined) {
    return 60;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 60 || parsed > 500) {
    throw new Error("YANDEX_MAPS_REVIEW_COUNT must be an integer from 60 to 500 for live tests.");
  }

  return parsed;
}

import type { LogLevel } from "../src/Application/Dtos/yandex-maps-place-reviews.dto.js";
import { createToolCallHandlers } from "../src/Composition/create-tool-call-handlers.js";

const url = process.argv[2] ?? process.env.YANDEX_MAPS_PLACE_URL;
const count = normalizeCount(process.argv[3] ?? process.env.YANDEX_MAPS_REVIEW_COUNT);
const headed = process.env.HEADED === "1";
const logLevel = normalizeLogLevel(process.env.LOG_LEVEL);

if (!url) {
  console.error("Usage: npm run run:tool -- <YANDEX_MAPS_PLACE_URL> [count]");
  process.exit(1);
}

const handlers = createToolCallHandlers({ logLevel });
const result = await handlers.getYandexMapsPlaceReviews.handle({ url, count, headed });

console.log(JSON.stringify(result, null, 2));

function normalizeCount(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    throw new Error("count must be an integer from 1 to 500.");
  }

  return parsed;
}

function normalizeLogLevel(value: string | undefined): LogLevel {
  if (value === undefined) {
    return "info";
  }

  if (["silent", "error", "warn", "info", "debug"].includes(value)) {
    return value as LogLevel;
  }

  throw new Error("LOG_LEVEL must be one of silent, error, warn, info, debug.");
}

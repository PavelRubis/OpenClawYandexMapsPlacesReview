import {
  DEFAULT_REVIEW_COUNT,
  MAX_REVIEW_COUNT,
  MIN_REVIEW_COUNT,
  type CollectYandexMapsPlaceReviewsInputDto,
  type GetYandexMapsPlaceReviewsInputDto,
} from "../Dtos/yandex-maps-place-reviews.dto.js";

const ALLOWED_HOSTS = new Set(["yandex.ru", "yandex.com", "yandex.by", "yandex.kz", "yandex.uz"]);

export function normalizeYandexMapsPlaceReviewsInput(
  input: GetYandexMapsPlaceReviewsInputDto,
): CollectYandexMapsPlaceReviewsInputDto {
  return {
    url: normalizeYandexMapsReviewsUrl(input.url),
    count: normalizeReviewCount(input.count),
    ...(input.headed === undefined ? {} : { headed: input.headed }),
  };
}

function normalizeReviewCount(count: number | undefined): number {
  if (count === undefined) {
    return DEFAULT_REVIEW_COUNT;
  }

  if (!Number.isInteger(count)) {
    throw new Error("count must be an integer.");
  }

  if (count < MIN_REVIEW_COUNT || count > MAX_REVIEW_COUNT) {
    throw new Error(`count must be between ${MIN_REVIEW_COUNT} and ${MAX_REVIEW_COUNT}.`);
  }

  return count;
}

function normalizeYandexMapsReviewsUrl(input: string): string {
  if (!input.trim()) {
    throw new Error("url must not be empty.");
  }

  let parsed: URL;

  try {
    parsed = new URL(input);
  } catch {
    throw new Error("url must be an absolute Yandex Maps URL.");
  }

  const host = parsed.hostname.replace(/^www\./, "");
  if (!ALLOWED_HOSTS.has(host) || !parsed.pathname.startsWith("/maps/")) {
    throw new Error("url must point to a Yandex Maps place page.");
  }

  parsed.hash = "";

  if (isPoiShareUrl(parsed)) {
    parsed.searchParams.set("tab", "reviews");
    parsed.searchParams.delete("source");
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_")) {
        parsed.searchParams.delete(key);
      }
    }
    return parsed.toString();
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  if (!parts.includes("org")) {
    throw new Error("url must point to a Yandex Maps place page.");
  }

  parsed.search = "";
  const reviewsIndex = parts.indexOf("reviews");
  if (reviewsIndex !== -1) {
    parts.length = reviewsIndex + 1;
  } else {
    parts.push("reviews");
  }

  parsed.pathname = `/${parts.join("/")}/`;
  return parsed.toString();
}

function isPoiShareUrl(url: URL): boolean {
  if (url.searchParams.get("mode") !== "poi") {
    return false;
  }

  const poiUri = url.searchParams.get("poi[uri]");
  if (poiUri === null) {
    return false;
  }

  try {
    const parsedPoi = new URL(poiUri);
    return (
      parsedPoi.protocol === "ymapsbm1:" &&
      parsedPoi.hostname === "org" &&
      /^\d+$/.test(parsedPoi.searchParams.get("oid") ?? "")
    );
  } catch {
    return false;
  }
}

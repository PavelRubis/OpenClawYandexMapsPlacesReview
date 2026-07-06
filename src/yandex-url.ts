const ALLOWED_HOSTS = new Set(["yandex.ru", "yandex.com", "yandex.by", "yandex.kz", "yandex.uz"]);

export function normalizeYandexMapsReviewsUrl(input: string): string {
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
  parsed.search = "";

  const parts = parsed.pathname.split("/").filter(Boolean);
  const reviewsIndex = parts.indexOf("reviews");
  if (reviewsIndex !== -1) {
    parts.length = reviewsIndex + 1;
  } else {
    parts.push("reviews");
  }

  parsed.pathname = `/${parts.join("/")}/`;
  return parsed.toString();
}

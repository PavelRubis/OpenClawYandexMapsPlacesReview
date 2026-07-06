const MONTHS: Record<string, number> = {
  января: 0,
  january: 0,
  февраль: 1,
  февраля: 1,
  february: 1,
  марта: 2,
  march: 2,
  апреля: 3,
  april: 3,
  мая: 4,
  may: 4,
  июня: 5,
  june: 5,
  июля: 6,
  july: 6,
  августа: 7,
  august: 7,
  сентября: 8,
  september: 8,
  октября: 9,
  october: 9,
  ноября: 10,
  november: 10,
  декабря: 11,
  december: 11,
};

export function parseYandexReviewDate(value: string, now = new Date()): Date | null {
  const text = value.trim().toLowerCase();
  if (!text) {
    return null;
  }

  const iso = /^\d{4}-\d{1,2}-\d{1,2}/.test(text) ? Date.parse(text) : Number.NaN;
  if (!Number.isNaN(iso)) {
    return new Date(iso);
  }

  if (text === "сегодня") {
    return startOfDay(now);
  }

  if (text === "вчера") {
    const date = startOfDay(now);
    date.setDate(date.getDate() - 1);
    return date;
  }

  const relative = text.match(
    /(\d+)\s+(день|дня|дней|недел[яьи]|месяц(?:а|ев)?|год|года|лет)\s+назад/,
  );
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2] ?? "";
    const date = startOfDay(now);
    if (unit.startsWith("д")) {
      date.setDate(date.getDate() - amount);
    } else if (unit.startsWith("недел")) {
      date.setDate(date.getDate() - amount * 7);
    } else if (unit.startsWith("месяц")) {
      date.setMonth(date.getMonth() - amount);
    } else {
      date.setFullYear(date.getFullYear() - amount);
    }
    return date;
  }

  const absolute = text.match(/(\d{1,2})\s+([a-zа-яё]+)(?:\s+(\d{4}))?/);
  if (absolute) {
    const day = Number(absolute[1]);
    const month = MONTHS[absolute[2] ?? ""];
    const year = absolute[3] === undefined ? now.getFullYear() : Number(absolute[3]);
    if (month !== undefined) {
      return new Date(year, month, day);
    }
  }

  const englishAbsolute = text.match(/([a-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?/);
  if (englishAbsolute) {
    const month = MONTHS[englishAbsolute[1] ?? ""];
    const day = Number(englishAbsolute[2]);
    const year = englishAbsolute[3] === undefined ? now.getFullYear() : Number(englishAbsolute[3]);
    if (month !== undefined) {
      return new Date(year, month, day);
    }
  }

  return null;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

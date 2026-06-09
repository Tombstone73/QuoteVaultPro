const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export type InboundDateInferenceResult = {
  parsedDate: string;
  confidence: number;
  sourceText: string;
  warning: string | null;
};

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isValidDate(year: number, month: number, day: number): boolean {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function formatDate(year: number, month: number, day: number): string {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function inferContextYearDate(args: {
  month: number;
  day: number;
  sourceText: string;
  baseDate: Date;
}): InboundDateInferenceResult | null {
  const base = startOfDay(args.baseDate);
  let year = base.getFullYear();
  if (!isValidDate(year, args.month, args.day)) return null;

  let candidate = startOfDay(new Date(year, args.month - 1, args.day));
  let confidence = 84;
  let warning: string | null = null;
  const daysBehind = Math.round((base.getTime() - candidate.getTime()) / 86400000);

  if (daysBehind > 2) {
    year += 1;
    if (!isValidDate(year, args.month, args.day)) return null;
    candidate = startOfDay(new Date(year, args.month - 1, args.day));
    confidence = daysBehind >= 7 ? 72 : 64;
    warning = "Date had already passed in the context year, so it was interpreted as next year.";
  } else if (daysBehind > 0) {
    confidence = 58;
    warning = "Date is slightly before the received date; staff should confirm the intended year.";
  }

  return {
    parsedDate: formatDate(candidate.getFullYear(), candidate.getMonth() + 1, candidate.getDate()),
    confidence,
    sourceText: args.sourceText,
    warning,
  };
}

function weekdayFromText(text: string, baseDate: Date): InboundDateInferenceResult | null {
  const relativeMatch = text.match(/\b(?:need(?:ed)?\s+by|in\s+hand\s+by|by|due)\s+(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
  if (!relativeMatch) return null;

  const sourceText = relativeMatch[0].trim();
  const isNext = Boolean(relativeMatch[1]);
  const weekday = WEEKDAYS[relativeMatch[2].toLowerCase()];
  const base = startOfDay(baseDate);
  let daysAhead = (weekday - base.getDay() + 7) % 7;
  if (daysAhead === 0 || isNext) daysAhead += 7;

  const parsed = new Date(base);
  parsed.setDate(base.getDate() + daysAhead);

  return {
    parsedDate: formatDate(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate()),
    confidence: isNext ? 82 : 76,
    sourceText,
    warning: isNext ? null : "Relative weekday inferred from received date; staff should confirm if timing is ambiguous.",
  };
}

export function inferInboundRequestedDate(args: {
  text: string;
  receivedAt?: Date | string | null;
  now?: Date;
}): InboundDateInferenceResult | null {
  const text = args.text || "";
  if (!text.trim()) return null;

  const receivedAt = args.receivedAt ? new Date(args.receivedAt) : null;
  const baseDate = receivedAt && !Number.isNaN(receivedAt.getTime()) ? receivedAt : args.now ?? new Date();

  const isoMatch = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    if (isValidDate(year, month, day)) {
      return { parsedDate: formatDate(year, month, day), confidence: 96, sourceText: isoMatch[0], warning: null };
    }
  }

  const numericMatch = text.match(/\b(?:by|due|in\s+hand\s+by|firm\s+in\s+hand\s+by)?\s*(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/i);
  if (numericMatch) {
    const month = Number(numericMatch[1]);
    const day = Number(numericMatch[2]);
    const yearText = numericMatch[3];
    if (yearText) {
      const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
      if (isValidDate(year, month, day)) {
        return { parsedDate: formatDate(year, month, day), confidence: 95, sourceText: numericMatch[0].trim(), warning: null };
      }
    }
    return inferContextYearDate({ month, day, sourceText: numericMatch[0].trim(), baseDate });
  }

  const monthMatch = text.match(/\b(january|february|march|april|may|june|july|august|september|sept|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?\b/i);
  if (monthMatch) {
    const month = MONTHS[monthMatch[1].toLowerCase()];
    const day = Number(monthMatch[2]);
    const yearText = monthMatch[3];
    if (yearText) {
      const year = Number(yearText);
      if (isValidDate(year, month, day)) {
        return { parsedDate: formatDate(year, month, day), confidence: 95, sourceText: monthMatch[0].trim(), warning: null };
      }
    }
    return inferContextYearDate({ month, day, sourceText: monthMatch[0].trim(), baseDate });
  }

  return weekdayFromText(text, baseDate);
}

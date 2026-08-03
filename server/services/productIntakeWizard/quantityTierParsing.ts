export type ParsedQuantityTier = {
  minQty: number;
  maxQty: number | null;
  perPieceCents: number;
  label: string;
};

export type QuantityTierParseResult = {
  tiers: ParsedQuantityTier[];
  errors: string[];
  missingRateQuestions: string[];
};

function cents(value: string): number | null {
  const amount = Number(value.replace(/,/g, ""));
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

function rangeFromMatch(match: RegExpExecArray): { minQty: number; maxQty: number | null } {
  const closedMin = match[1] ? Number(match[1]) : null;
  const closedMax = match[2] ? Number(match[2]) : null;
  const openMin = match[3] ? Number(match[3]) : null;
  const upToMax = match[4] ? Number(match[4]) : null;
  return closedMin !== null && closedMax !== null
    ? { minQty: closedMin, maxQty: closedMax }
    : openMin !== null
      ? { minQty: openMin, maxQty: null }
      : { minQty: 1, maxQty: upToMax! };
}

/** Parses explicit per-piece tier wording without inventing bounds or rates. */
export function parseNaturalLanguageQuantityTiers(text: string): QuantityTierParseResult {
  const normalized = text.replace(/[–—]/g, "-");
  const rangePattern = /\b(?:(\d{1,6})\s*(?:through|to|-)\s*(\d{1,6})|(\d{1,6})\s*(?:or\s+more|and\s+(?:above|up)|\+)|up\s+to\s*(\d{1,6}))(?=\s|$|[.,;:])/gi;
  const tiers: Array<ParsedQuantityTier & { offset: number }> = [];
  const missingRateQuestions: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = rangePattern.exec(normalized))) {
    const range = rangeFromMatch(match);
    const label = range.maxQty === null ? `${range.minQty}+` : `${range.minQty}-${range.maxQty}`;
    const after = normalized.slice(rangePattern.lastIndex, rangePattern.lastIndex + 56);
    const before = normalized.slice(Math.max(0, match.index - 80), match.index);
    const followingRate = after.match(/^\s*(?:at|=|:|for)?\s*\$?\s*(-?\d+(?:\.\d{1,2})?)\s*(?:each|per\s+piece)?\b/i)?.[1];
    const precedingRate = before.match(/\$?\s*(-?\d+(?:\.\d{1,2})?)\s*(?:each|per\s+piece)\s*(?:for\s*)?(?:quantities?\s*)?$/i)?.[1];
    const rate = followingRate ?? precedingRate;
    if (!rate) {
      missingRateQuestions.push(`What price should apply to quantities ${range.maxQty === null ? `${range.minQty} and above` : `${range.minQty} through ${range.maxQty}`}?`);
      continue;
    }
    const perPieceCents = cents(rate);
    if (perPieceCents === null) {
      missingRateQuestions.push(`What price should apply to quantities ${label}?`);
      continue;
    }
    tiers.push({ ...range, perPieceCents, label, offset: match.index });
  }

  const errors: string[] = [];
  const ordered = tiers.sort((a, b) => a.offset - b.offset);
  if (/\$\s*-\d/.test(normalized) || ordered.some((tier) => tier.perPieceCents < 0)) errors.push("Quantity-tier prices cannot be negative.");
  for (const tier of ordered) {
    if (!Number.isInteger(tier.minQty) || tier.minQty < 1 || (tier.maxQty !== null && (!Number.isInteger(tier.maxQty) || tier.maxQty < tier.minQty))) {
      errors.push(`Quantity tier ${tier.label} has an invalid range.`);
    }
  }
  if (ordered.length > 0 && ordered[0]!.minQty !== 1) errors.push("Quantity tiers must begin at quantity 1.");
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    if (previous.maxQty === null) errors.push("An open-ended quantity tier must be the final tier.");
    else if (current.minQty <= previous.maxQty) errors.push("Quantity tiers cannot overlap or repeat a lower bound.");
    else if (current.minQty !== previous.maxQty + 1) errors.push("Quantity tiers must provide continuous coverage.");
  }
  if (ordered.filter((tier) => tier.maxQty === null).length > 1) errors.push("Only one quantity tier may be open-ended.");

  return {
    tiers: ordered.map(({ offset: _offset, ...tier }) => tier),
    errors: Array.from(new Set(errors)),
    missingRateQuestions: Array.from(new Set(missingRateQuestions)),
  };
}

export function hasCompleteNaturalLanguageQuantityTiers(text: string): boolean {
  const parsed = parseNaturalLanguageQuantityTiers(text);
  return parsed.tiers.length >= 2 && parsed.errors.length === 0 && parsed.missingRateQuestions.length === 0;
}

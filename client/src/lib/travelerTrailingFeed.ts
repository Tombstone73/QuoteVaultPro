export const BASE_TRAVELER_TRAILING_FEED_MM = 38.1;
export const MAX_ADDITIONAL_TRAVELER_TRAILING_FEED_MM = 100;

export function normalizeAdditionalTravelerTrailingFeedMm(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_ADDITIONAL_TRAVELER_TRAILING_FEED_MM) return 0;
  return parsed;
}

export function getEffectiveTravelerTrailingFeedMm(additionalFeedMm: unknown): number {
  return BASE_TRAVELER_TRAILING_FEED_MM + normalizeAdditionalTravelerTrailingFeedMm(additionalFeedMm);
}

export function travelerFeedSpacerMm(additionalFeedMm: unknown): string {
  return `${getEffectiveTravelerTrailingFeedMm(additionalFeedMm)}mm`;
}

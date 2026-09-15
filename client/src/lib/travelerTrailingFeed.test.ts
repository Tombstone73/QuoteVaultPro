import {
  BASE_TRAVELER_TRAILING_FEED_MM,
  getEffectiveTravelerTrailingFeedMm,
  travelerFeedSpacerMm,
} from "./travelerTrailingFeed";

describe("Traveler trailing feed", () => {
  test.each([
    [0, 38.1],
    [20, 58.1],
    [12.7, 50.8],
    [25, 63.1],
    [50, 88.1],
    [100, 138.1],
  ])("adds %s mm to the canonical %s mm tear-off space", (additional, expected) => {
    expect(BASE_TRAVELER_TRAILING_FEED_MM).toBe(38.1);
    expect(getEffectiveTravelerTrailingFeedMm(additional)).toBe(expected);
  });

  test("falls back safely for malformed render query values", () => {
    expect(getEffectiveTravelerTrailingFeedMm(-1)).toBe(38.1);
    expect(getEffectiveTravelerTrailingFeedMm("12,7")).toBe(38.1);
    expect(travelerFeedSpacerMm(12.7)).toBe("50.8mm");
  });
});

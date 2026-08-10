import { describe, expect, test } from "@jest/globals";
import { parseNaturalLanguageQuantityTiers } from "../services/productIntakeWizard/quantityTierParsing";

const request = "Create a new product called DEV Test Stickers 080326. It is quantity-only and priced per piece. Charge $3 each for quantities 1 through 24, $2.50 each for 25 through 49, and $2 each for 50 or more. Do not set production routing or a minimum charge.";

describe("natural-language quantity tiers", () => {
  test.each([
    [request],
    ["1-24 at $3, 25-49 at $2.50, 50+ at $2"],
    ["up to 24 at $3; 25 to 49 at $2.50; 50 and above at $2"],
  ])("normalizes complete per-piece tiers from %s", (text) => {
    const parsed = parseNaturalLanguageQuantityTiers(text);
    expect(parsed.errors).toEqual([]);
    expect(parsed.missingRateQuestions).toEqual([]);
    expect(parsed.tiers.map((tier) => [tier.minQty, tier.maxQty, tier.perPieceCents])).toEqual([
      [1, 24, 300], [25, 49, 250], [50, null, 200],
    ]);
  });

  test("rejects invalid tier overlaps, duplicate thresholds, reversed bounds, and missing rates", () => {
    expect(parseNaturalLanguageQuantityTiers("1-24 at $3, 24-49 at $2.50, 50+ at $2").errors.join(" ")).toMatch(/overlap|repeat/i);
    expect(parseNaturalLanguageQuantityTiers("1-24 at $3, 25-24 at $2.50, 50+ at $2").errors.join(" ")).toMatch(/invalid range/i);
    expect(parseNaturalLanguageQuantityTiers("1-24, 25-49 at $2.50, 50+ at $2").missingRateQuestions).toEqual(["What price should apply to quantities 1 through 24?"]);
  });
});

import { clonePricingPatchFromMessage, pricingPatchFromMessage } from "../services/assistant/productManagementPricingParsing";

describe("product management pricing parsing", () => {
  it("parses natural price-first square-foot and minimum wording", () => {
    expect(pricingPatchFromMessage("Change AI VALIDATION 19I 3mm PVC to $4.75 per square foot with a $30 minimum."))
      .toEqual({ basePricing: { perSqftCents: 475, minimumChargeCents: 3000 } });
  });

  it("retains price-unit and field-first supported forms", () => {
    expect(pricingPatchFromMessage("Set per square foot to $4.75 and minimum charge to $30."))
      .toEqual({ basePricing: { perSqftCents: 475, minimumChargeCents: 3000 } });
  });

  it("binds clone pricing only to labelled currency amounts, never numeric product-name suffixes", () => {
    const request = "Clone DEV Test Minimum Charge 080426 as DEV Test Minimum Charge Clone 080426. Change the price to $2.50 per square foot and the minimum charge to $30.00. Keep all other settings unchanged.";
    expect(clonePricingPatchFromMessage(request)).toEqual({ basePricing: { perSqftCents: 250, minimumChargeCents: 3000 } });
  });

  it("ignores identifiers, UUIDs, dates, and unrelated numbers in clone requests", () => {
    const request = "Clone product ID 123e4567-e89b-12d3-a456-426614174000 named Print 2026-08-04 as Print Clone 080426. Set $2.50 per square foot and $30.00 minimum charge; quantity 24 is unchanged.";
    expect(clonePricingPatchFromMessage(request)).toEqual({ basePricing: { perSqftCents: 250, minimumChargeCents: 3000 } });
  });

  it("fails closed for an unlabelled clone pricing amount or conflicting field amounts", () => {
    expect(clonePricingPatchFromMessage("Clone Banner 080426 as Banner Clone 080426. Change the price to 2.50.")).toEqual(expect.objectContaining({ error: expect.stringContaining("explicit currency") }));
    expect(clonePricingPatchFromMessage("Clone Banner as Banner Copy. Set $2.50 per square foot and $3.00 per square foot.")).toEqual(expect.objectContaining({ error: expect.stringContaining("More than one") }));
  });
});

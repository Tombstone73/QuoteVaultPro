import { pricingPatchFromMessage } from "../services/assistant/productManagementPricingParsing";

describe("product management pricing parsing", () => {
  it("parses natural price-first square-foot and minimum wording", () => {
    expect(pricingPatchFromMessage("Change AI VALIDATION 19I 3mm PVC to $4.75 per square foot with a $30 minimum."))
      .toEqual({ basePricing: { perSqftCents: 475, minimumChargeCents: 3000 } });
  });

  it("retains price-unit and field-first supported forms", () => {
    expect(pricingPatchFromMessage("Set per square foot to $4.75 and minimum charge to $30."))
      .toEqual({ basePricing: { perSqftCents: 475, minimumChargeCents: 3000 } });
  });
});

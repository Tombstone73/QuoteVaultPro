import { pricingChangeRequestFromMessage } from "../services/assistant/productPricingChangeSetParsing";

describe("product pricing change-set parsing", () => {
  it("parses percentage increases and decreases with exact components", () => {
    expect(pricingChangeRequestFromMessage("increase all active Flatbed products by 5% per square foot")).toMatchObject({ selector: { active: true, route: "Flatbed" }, operation: { kind: "percent", field: "perSqftCents", percent: 5 } });
    expect(pricingChangeRequestFromMessage("reduce Roll product minimum charge by 3%")).toMatchObject({ selector: { active: true, route: "Roll" }, operation: { kind: "percent", field: "minimumChargeCents", percent: -3 } });
  });

  it("parses fixed and exact scalar values without confusing amounts", () => {
    expect(pricingChangeRequestFromMessage("add $0.25 per square foot to active Flatbed products")).toMatchObject({ operation: { kind: "fixed", field: "perSqftCents", cents: 25 } });
    expect(pricingChangeRequestFromMessage("subtract $2.00 from the minimum charge on active Roll products")).toMatchObject({ operation: { kind: "fixed", field: "minimumChargeCents", cents: -200 } });
    expect(pricingChangeRequestFromMessage("set minimum charge to $35 on active Roll products")).toMatchObject({ operation: { kind: "set", field: "minimumChargeCents", cents: 3500 } });
    expect(pricingChangeRequestFromMessage("clear the minimum charge on active Roll products")).toMatchObject({ operation: { kind: "set", field: "minimumChargeCents", cents: null } });
  });

  it("fails closed when no scalar component is stated", () => {
    expect(pricingChangeRequestFromMessage("increase all active Flatbed prices by 5%")).toBeNull();
  });
});

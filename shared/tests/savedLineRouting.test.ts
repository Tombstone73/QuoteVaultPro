import { hasSavedLineProductChange, hasSavedLineRoutingChange, savedLineRequirementConflict } from "../savedLineRouting";

const none = { design: false, prepress: false, proof: false };

describe("saved Order line requirement boundaries", () => {
  it("does not reroute a saved line when a full editor payload repeats its Product and requirements", () => {
    expect(hasSavedLineProductChange("product-a", "product-a")).toBe(false);
    expect(hasSavedLineProductChange("product-a")).toBe(false);
    expect(hasSavedLineProductChange("product-a", "product-b")).toBe(true);
    expect(hasSavedLineRoutingChange({ previousProductId: "product-a", submittedProductId: "product-a", previous: none, submitted: none })).toBe(false);
    expect(hasSavedLineRoutingChange({ previousProductId: "product-a", previous: none, submitted: {} })).toBe(false);
    expect(hasSavedLineRoutingChange({ previousProductId: "product-a", submittedProductId: "product-b", previous: none, submitted: none })).toBe(true);
  });

  it("permits adding each requirement to an ownerless saved line", () => {
    for (const field of ["design", "prepress", "proof"] as const) {
      expect(savedLineRequirementConflict({ previous: none, next: { ...none, [field]: true }, activeStation: null })).toBeNull();
    }
  });

  it("requires a reasoned return before adding an upstream stage to production", () => {
    for (const station of ["roll", "wide_roll", "flatbed"]) {
      expect(savedLineRequirementConflict({ previous: none, next: { ...none, design: true }, activeStation: station })).toMatch(/Return for Correction → Design/);
      expect(savedLineRequirementConflict({ previous: none, next: { ...none, prepress: true }, activeStation: station })).toMatch(/Return for Correction → Prepress/);
      expect(savedLineRequirementConflict({ previous: none, next: { ...none, proof: true }, activeStation: station })).toBeNull();
    }
  });

  it("preserves a currently owned stage and permits unrelated downstream planning", () => {
    expect(savedLineRequirementConflict({ previous: { ...none, design: true }, next: none, activeStation: "design" })).toMatch(/Design owns/);
    expect(savedLineRequirementConflict({ previous: { ...none, design: true }, next: { ...none, design: true, prepress: true }, activeStation: "design" })).toBeNull();
    expect(savedLineRequirementConflict({ previous: { ...none, prepress: true }, next: none, activeStation: "prepress" })).toMatch(/Prepress owns/);
    expect(savedLineRequirementConflict({ previous: { ...none, prepress: true }, next: { ...none, prepress: true, proof: true }, activeStation: "prepress" })).toBeNull();
    expect(savedLineRequirementConflict({ previous: { ...none, design: true }, next: none, activeStation: "roll" })).toBeNull();
  });
});

import { applyComplexProductConversationEdit, createInitialComplexProductSpecification, routeComplexProductMessage } from "../services/assistant/complexProductConversation";
import { specificationFingerprint } from "../services/assistant/complexProductSpecification";

const matrix = `| Thickness | Single-sided | Double-sided |
| --- | --- | --- |
| 3mm | $4.50 | $5.75 |
| 6mm | $6.25 | $7.75 |`;

describe("configurable-product conversation integration helpers", () => {
  it("routes configurable messages ahead of scalar pricing wording and keeps unrelated routes distinct", () => {
    expect(routeComplexProductMessage(`Create a PVC product with thickness options and set this pricing matrix:\n${matrix}`)).toBe("configurable");
    expect(routeComplexProductMessage("increase product pricing by 5 percent")).toBe("pricing");
    expect(routeComplexProductMessage("create separate PVC products with thickness options")).toBe("standalone");
  });

  it("creates one blocked proposal shape, preserves omitted fields, and clears the pricing blocker when a complete matrix arrives", () => {
    const first = createInitialComplexProductSpecification("Create a PVC product in category Rigid Substrates with 3mm and 6mm thickness options.");
    expect(first.review.blockers).toHaveLength(1);
    expect(first.category).toBe("Rigid Substrates");
    const before = specificationFingerprint(first);
    const complete = applyComplexProductConversationEdit(first, `Use this matrix:\n${matrix}`);
    expect(complete.sheet).toEqual(first.sheet);
    expect(complete.review.blockers).toEqual([]);
    expect(complete.pricing.cells["3mm:Double-sided"]).toBe(575);
    expect(specificationFingerprint(complete)).not.toBe(before);
  });

  it("keeps an unquoted requested product name and permits a later explicit correction", () => {
    const initial = createInitialComplexProductSpecification("Create a configurable product draft named AI VALIDATION 19K PVC in category Rigid Substrates with Thickness options.");
    expect(initial.name).toBe("AI VALIDATION 19K PVC");
    const corrected = applyComplexProductConversationEdit(initial, "Set name to AI VALIDATION 19K PVC Revised.");
    expect(corrected.name).toBe("AI VALIDATION 19K PVC Revised");
    expect(corrected.category).toBe("Rigid Substrates");
    expect(specificationFingerprint(corrected)).not.toBe(specificationFingerprint(initial));
  });

  it("applies only explicit corrections and changes the bound proposal fingerprint", () => {
    const initial = applyComplexProductConversationEdit(createInitialComplexProductSpecification(`Create PVC product.\n${matrix}`), `Create PVC product.\n${matrix}`);
    const corrected = applyComplexProductConversationEdit(initial, "Set category to Rigid Substrates, minimum charge to $25, and allow rotation.");
    expect(corrected.category).toBe("Rigid Substrates");
    expect(corrected.minimumChargeCents).toBe(2500);
    expect(corrected.sheet.allowRotation).toBe(true);
    expect(corrected.route).toBe(initial.route);
    expect(specificationFingerprint(corrected)).not.toBe(specificationFingerprint(initial));
  });

  it("accepts amount-first minimum-charge corrections used in a settings-only continuation", () => {
    const initial = createInitialComplexProductSpecification("Create a PVC product with thickness options.");
    const corrected = applyComplexProductConversationEdit(initial, "Use 48×96 sheets, Flatbed routing, allow rotation, and set a $25 minimum.");
    expect(corrected.minimumChargeCents).toBe(2500);
    expect(corrected.sheet).toMatchObject({ widthIn: 48, heightIn: 96, allowRotation: true });
    expect(corrected.route).toBe("Flatbed");
  });

  it("treats paired thickness and printed-side prices as a two-dimensional product matrix", () => {
    const initial = createInitialComplexProductSpecification("I want to add a new product called Yard Signs. It has two thicknesses, 3mm and 6mm, and each thickness is available single-sided or double-sided. The prices are $12/$18 for 3mm and $16/$22 for 6mm.");
    expect(initial.pricing.kind).toBe("two_dimensional_per_sqft");
    expect(initial.pricing.rowValues).toEqual(["3mm", "6mm"]);
    expect(initial.pricing.columnValues).toEqual(["single_sided", "double_sided"]);
    expect(initial.pricing.cells).toMatchObject({ "3mm:single_sided": 1200, "3mm:double_sided": 1800, "6mm:single_sided": 1600, "6mm:double_sided": 2200 });
    expect(initial.review.blockers).toEqual([]);
  });
});

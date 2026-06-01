import { planMaterialProductLinkReplacement } from "../materialProductLinks";

describe("material product link planning", () => {
  it("creates material links only for active valid products", () => {
    const plan = planMaterialProductLinkReplacement(["prod_active", "prod_inactive", "missing"], [
      { id: "prod_active", isActive: true },
      { id: "prod_inactive", isActive: false },
    ]);

    expect(plan.linkedProductIds).toEqual(["prod_active"]);
    expect(plan.ignoredProductIds).toEqual(["prod_inactive", "missing"]);
    expect(plan.productIdsToActivate).toEqual(["prod_active"]);
  });

  it("edits linked products by keeping requested active links and removing omitted links", () => {
    const plan = planMaterialProductLinkReplacement(["prod_b"], [
      { id: "prod_b", isActive: true },
    ], [
      { productId: "prod_a", removedAt: null },
      { productId: "prod_b", removedAt: null },
    ]);

    expect(plan.linkedProductIds).toEqual(["prod_b"]);
    expect(plan.productIdsToRemove).toEqual(["prod_a"]);
  });

  it("removes all active links when the replacement list is empty", () => {
    const plan = planMaterialProductLinkReplacement([], [], [
      { productId: "prod_a", removedAt: null },
      { productId: "prod_removed", removedAt: new Date("2026-01-01T00:00:00Z") },
    ]);

    expect(plan.linkedProductIds).toEqual([]);
    expect(plan.productIdsToRemove).toEqual(["prod_a"]);
  });

  it("ignores invalid product ids without preventing material save callers from continuing", () => {
    const plan = planMaterialProductLinkReplacement(["missing"], []);

    expect(plan.linkedProductIds).toEqual([]);
    expect(plan.ignoredProductIds).toEqual(["missing"]);
  });
});

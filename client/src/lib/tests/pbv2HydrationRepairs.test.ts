import { describe, expect, test } from "@jest/globals";
import { planPbv2Hydration } from "../pbv2/hydrationRepairs";
import { normalizeTreePricingImpacts } from "../pbv2/pricing/pricingImpact";
import { sanitizePbv2PricingMatrix } from "@shared/pbv2/pricingMatrixSanitizer";

describe("PBV2 hydration repair planning", () => {
  test("an unchanged tree is clean and object key order is equivalent formatting", () => {
    const persisted = { nodes: { a: { id: "a", pricingImpact: [{ mode: "addCents", cents: 50 }] } }, meta: { pricingV2: { tiers: [1, 10] } } };
    const reordered = { meta: { pricingV2: { tiers: [1, 10] } }, nodes: { a: { pricingImpact: [{ cents: 50, mode: "addCents" }], id: "a" } } };
    const plan = planPbv2Hydration(persisted, reordered);
    expect(plan.repairs).toEqual([]);
    expect(plan.hasUserChanges).toBe(false);
  });

  test("a legacy impact remains unsaved and its exact changed fields are listed", () => {
    const persisted = { nodes: { option: { id: "option", choices: [{ value: "Yes", pricingImpact: [{ mode: "addPercent", percent: 10, basis: "base", legacyCents: 50 }] }] } } };
    const normalized = normalizeTreePricingImpacts(persisted).tree;
    const plan = planPbv2Hydration(persisted, normalized);
    expect(plan.tree).toBe(persisted);
    expect(plan.hasUserChanges).toBe(false);
    expect(plan.repairs).toEqual([{ path: "tree.nodes.option.choices[0].pricingImpact[0].legacyCents", before: 50, after: undefined }]);
    expect((persisted.nodes.option.choices[0].pricingImpact[0] as any).legacyCents).toBe(50);
    expect(persisted.nodes.option.choices[0].pricingImpact[0].percent).toBe(10);
  });

  test("matrix removal is proposed while persisted rows and quantity tiers stay intact", () => {
    const persisted = {
      nodes: { option: { id: "option", type: "INPUT", input: { selectionKey: "size", type: "select" }, choices: [{ value: "Small" }] } },
      pricingMatrix: { dimensions: ["size"], rows: [
        { id: "valid", when: { size: "Small" }, priceCents: 440 },
        { id: "stale", when: { size: "Deleted" }, priceCents: 999 },
      ] },
      meta: { pricingV2: { tiers: [{ minQty: 1, priceCents: 440 }, { minQty: 10, priceCents: 350 }] } },
    };
    const sanitized = sanitizePbv2PricingMatrix(persisted, { allowIncompleteMatrix: true });
    const plan = planPbv2Hydration(persisted, sanitized.tree);
    expect(plan.tree).toBe(persisted);
    expect(plan.repairs.some((repair) => repair.path.includes("pricingMatrix.rows"))).toBe(true);
    expect(persisted.pricingMatrix.rows).toHaveLength(2);
    expect((plan.tree as typeof persisted).meta.pricingV2.tiers).toEqual(persisted.meta.pricingV2.tiers);
  });

  test("an ACTIVE fallback is a proposed draft repair, never a manual edit", () => {
    const active = { status: "ACTIVE", nodes: {} };
    const plan = planPbv2Hydration(active, { ...active, status: "DRAFT" }, true);
    expect(plan.tree).toBe(active);
    expect(plan.repairs.map((repair) => repair.path)).toEqual(["draft.treeJson", "tree.status"]);
    expect(plan.hasUserChanges).toBe(false);
  });

  test("an equivalent percentage basis default does not require a save", () => {
    const persisted = {
      nodes: { option: { id: "option", choices: [{ value: "Yes", pricingImpact: [{ mode: "addPercent", percent: 10 }] }] } },
      meta: { pricingV2: { qtyTiers: [{ minQty: 1, perPieceCents: 440 }, { minQty: 10, perPieceCents: 350 }] } },
    };
    const proposed = normalizeTreePricingImpacts(persisted).tree;
    expect(planPbv2Hydration(persisted, proposed).repairs).toEqual([]);
    const reloaded = planPbv2Hydration(proposed, normalizeTreePricingImpacts(proposed).tree);
    expect(reloaded.repairs).toEqual([]);
    expect((reloaded.tree as typeof persisted).meta.pricingV2.qtyTiers).toEqual(persisted.meta.pricingV2.qtyTiers);
  });
});

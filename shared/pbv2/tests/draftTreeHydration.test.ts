import { describe, expect, test } from "@jest/globals";
import {
  choosePbv2BuilderTreeSource,
  countPbv2BuilderGroups,
  countPbv2RuntimeInputs,
  normalizePbv2ProductIdentity,
  shouldBlockPbv2TreeHydration,
} from "../draftTreeHydration";

describe("PBV2 draft tree hydration guard", () => {
  test("normalizes missing product ids to one stable new-product identity", () => {
    expect(normalizePbv2ProductIdentity(undefined)).toBeNull();
    expect(normalizePbv2ProductIdentity(null)).toBeNull();
    expect(normalizePbv2ProductIdentity("")).toBeNull();
    expect(normalizePbv2ProductIdentity("product_123")).toBe("product_123");
  });

  test("blocks new-product reseed after local edits when productId is undefined", () => {
    expect(shouldBlockPbv2TreeHydration({
      isLocalDirty: true,
      hasLocalTree: true,
      lastLoadedProductId: null,
      productId: undefined,
    })).toBe(true);
  });

  test("does not block initial hydration before a local tree exists", () => {
    expect(shouldBlockPbv2TreeHydration({
      isLocalDirty: true,
      hasLocalTree: false,
      lastLoadedProductId: null,
      productId: undefined,
    })).toBe(false);
  });

  test("does not block when navigating to another product", () => {
    expect(shouldBlockPbv2TreeHydration({
      isLocalDirty: true,
      hasLocalTree: true,
      lastLoadedProductId: "product_a",
      productId: "product_b",
    })).toBe(false);
  });

  test("detects builder groups and runtime inputs in object-shaped trees", () => {
    const tree = {
      nodes: {
        group_banner: { id: "group_banner", type: "GROUP", kind: "group" },
        banner_weight: { id: "banner_weight", type: "INPUT", kind: "question" },
      },
    };

    expect(countPbv2BuilderGroups(tree)).toBe(1);
    expect(countPbv2RuntimeInputs(tree)).toBe(1);
  });

  test("normal editing hydrates ACTIVE even when an empty draft exists", () => {
    const emptyDraft = {
      id: "draft_empty",
      treeJson: {
        nodes: {
          base: { id: "base", type: "COMPUTE", kind: "computed" },
        },
      },
    };
    const active = {
      id: "active_banner",
      treeJson: {
        nodes: {
          group_banner: { id: "group_banner", type: "GROUP", kind: "group" },
          banner_weight: { id: "banner_weight", type: "INPUT", kind: "question" },
        },
      },
    };

    expect(choosePbv2BuilderTreeSource({ draft: emptyDraft, active })).toEqual({
      source: active,
      sourceKind: "ACTIVE",
      repairedFromActive: false,
      reason: "active",
    });
  });

  test("normal editing keeps a usable draft separate from ACTIVE", () => {
    const draft = {
      id: "draft_banner",
      treeJson: {
        nodes: {
          group_banner: { id: "group_banner", type: "GROUP", kind: "group" },
          banner_weight: { id: "banner_weight", type: "INPUT", kind: "question" },
        },
      },
    };
    const active = {
      id: "active_banner",
      treeJson: {
        nodes: {
          group_active: { id: "group_active", type: "GROUP", kind: "group" },
        },
      },
    };

    expect(choosePbv2BuilderTreeSource({ draft, active })).toEqual({
      source: active,
      sourceKind: "ACTIVE",
      repairedFromActive: false,
      reason: "active",
    });
    expect(choosePbv2BuilderTreeSource({ draft, active, preferDraft: true }).source).toBe(draft);
    expect(choosePbv2BuilderTreeSource({ draft, active, preferExistingDraft: true }).source).toBe(draft);
  });

  test("Stickers normal edit retains the ACTIVE $1 Weed impact instead of the unpublished percent", () => {
    const weedNode = "opt_dfa265fa-f1fc-4fdd-afde-a12274db2aec";
    const active = { id: "9868ce72-ad9a-4353-80de-e0d02e75f064", treeJson: {
      nodes: { [weedNode]: { id: weedNode, type: "INPUT", choices: [
        { value: "choice_1", label: "No" },
        { value: "choice_2", label: "Yes", pricingImpact: [{ mode: "addCents", cents: 100 }] },
      ] } },
    } };
    const draft = { id: "af0a4d57-83ca-4819-92f5-d7bedde04010", treeJson: {
      nodes: { [weedNode]: { id: weedNode, type: "INPUT", choices: [
        { value: "choice_1", label: "No" },
        { value: "choice_2", label: "Yes", pricingImpact: [{ mode: "addPercent", percent: 25.01, cents: 100 }] },
      ] } },
    } };
    const normal = choosePbv2BuilderTreeSource({ active, draft });
    expect(normal.source?.id).toBe(active.id);
    expect((normal.source?.treeJson as any).nodes[weedNode].choices[1].pricingImpact[0]).toEqual({ mode: "addCents", cents: 100 });
    expect(choosePbv2BuilderTreeSource({ active, draft, preferDraft: true }).source?.id).toBe(draft.id);
  });
});

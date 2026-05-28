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

  test("hydrates builder state from active tree when draft is empty", () => {
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
      repairedFromActive: true,
      reason: "active_fallback_empty_draft",
    });
  });

  test("keeps usable draft ahead of active tree", () => {
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
      source: draft,
      sourceKind: "DRAFT",
      repairedFromActive: false,
      reason: "draft",
    });
  });
});

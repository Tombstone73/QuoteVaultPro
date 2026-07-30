import { describe, expect, test } from "@jest/globals";
import {
  choosePbv2BuilderTreeSource,
  normalizePbv2TreeLoadIdentity,
  shouldBlockPbv2TreeHydration,
  shouldWaitForPbv2TreeLoad,
} from "../pbv2/draftTreeHydration";

const active = { id: "active", treeJson: { nodes: { group: { id: "group", type: "GROUP" } } } };
const emptyDraft = { id: "draft", treeJson: { nodes: {} } };
const requestedDraft = { id: "draft", treeJson: { nodes: { group: { id: "group", type: "GROUP" } } } };

describe("PBV2 requested draft hydration", () => {
  test("waits for an existing product tree instead of seeding during the initial request", () => {
    expect(shouldWaitForPbv2TreeLoad({ productId: "product", isTreeLoading: true })).toBe(true);
    expect(shouldWaitForPbv2TreeLoad({ productId: "product", isTreeLoading: false })).toBe(false);
    expect(shouldWaitForPbv2TreeLoad({ productId: null, isTreeLoading: true })).toBe(false);
  });

  test("uses an explicit requested DRAFT tree instead of falling back to ACTIVE", () => {
    expect(choosePbv2BuilderTreeSource({ draft: requestedDraft, active, preferDraft: true })).toMatchObject({
      source: requestedDraft,
      sourceKind: "DRAFT",
      repairedFromActive: false,
    });
    expect(choosePbv2BuilderTreeSource({ draft: emptyDraft, active, preferDraft: true })).toMatchObject({
      source: emptyDraft,
      sourceKind: "DRAFT",
      repairedFromActive: false,
      reason: "empty_draft",
    });
  });

  test("keeps normal active fallback and scopes the dirty lock to the exact requested tree", () => {
    expect(choosePbv2BuilderTreeSource({ draft: emptyDraft, active })).toMatchObject({
      source: active,
      sourceKind: "ACTIVE",
      repairedFromActive: true,
    });
    const first = normalizePbv2TreeLoadIdentity({ productId: "product", requestedDraftTreeVersionId: "draft-a" });
    const second = normalizePbv2TreeLoadIdentity({ productId: "product", requestedDraftTreeVersionId: "draft-b" });
    expect(shouldBlockPbv2TreeHydration({ isLocalDirty: true, hasLocalTree: true, lastLoadedTreeIdentity: first, treeIdentity: first })).toBe(true);
    expect(shouldBlockPbv2TreeHydration({ isLocalDirty: true, hasLocalTree: true, lastLoadedTreeIdentity: first, treeIdentity: second })).toBe(false);
  });
});

import { describe, expect, test } from "@jest/globals";
import { requiresPublishedPbv2BeforeActivation } from "../pbv2/productionLifecycle";

describe("PBV2 production lifecycle", () => {
  test("blocks activation of a product that only has a PBV2 DRAFT", () => {
    expect(requiresPublishedPbv2BeforeActivation({
      currentlyActive: false,
      requestedActive: true,
      activeTreeVersionId: null,
      draftTreeVersionId: "draft_1",
    })).toBe(true);
  });

  test("allows activation once an ACTIVE PBV2 tree is assigned", () => {
    expect(requiresPublishedPbv2BeforeActivation({
      currentlyActive: false,
      requestedActive: true,
      activeTreeVersionId: "active_1",
      draftTreeVersionId: "draft_2",
    })).toBe(false);
  });

  test("does not apply to an unchanged active product or a legacy product", () => {
    expect(requiresPublishedPbv2BeforeActivation({ currentlyActive: true, requestedActive: true, activeTreeVersionId: null, draftTreeVersionId: "draft_1" })).toBe(false);
    expect(requiresPublishedPbv2BeforeActivation({ currentlyActive: false, requestedActive: true, activeTreeVersionId: null, draftTreeVersionId: null })).toBe(false);
  });
});

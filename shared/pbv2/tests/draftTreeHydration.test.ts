import { describe, expect, test } from "@jest/globals";
import { normalizePbv2ProductIdentity, shouldBlockPbv2TreeHydration } from "../draftTreeHydration";

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
});

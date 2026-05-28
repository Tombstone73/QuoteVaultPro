import { describe, expect, test } from "@jest/globals";

import { filterProductsForCatalog } from "../productCatalogVisibility";

describe("product catalog visibility", () => {
  test("staff/admin catalog includes active draft PBV2 products", () => {
    const banner = {
      id: "product_banner",
      name: "Banner",
      isActive: true,
      pbv2ActiveTreeVersionId: null,
    };

    expect(filterProductsForCatalog([banner], { activeOnly: false })).toEqual([banner]);
  });

  test("active-only catalog includes seeded active Banner even before PBV2 publish", () => {
    const banner = {
      id: "product_banner",
      name: "Banner",
      isActive: true,
      pbv2ActiveTreeVersionId: null,
    };

    expect(filterProductsForCatalog([banner], { activeOnly: true })).toEqual([banner]);
  });

  test("active-only catalog excludes inactive legacy banner products", () => {
    const activeBanner = { id: "product_banner", name: "Banner", isActive: true };
    const inactiveLegacyBanner = { id: "legacy_banner", name: "zLegacy 13oz Banner", isActive: false };

    expect(filterProductsForCatalog([activeBanner, inactiveLegacyBanner], { activeOnly: true })).toEqual([
      activeBanner,
    ]);
  });
});

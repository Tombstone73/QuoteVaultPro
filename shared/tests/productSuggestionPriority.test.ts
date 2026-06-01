import { filterAndPrioritizeProductsForMaterial } from "../../client/src/components/orders/productSuggestionPriority";

describe("filterAndPrioritizeProductsForMaterial", () => {
  const products = [
    { id: "general", name: "General Banner", isActive: true },
    { id: "linked", name: "Vinyl Banner", isActive: true, linkedMaterialIds: ["mat_vinyl"] },
    { id: "primary", name: "Primary Vinyl", isActive: true, primaryMaterialId: "mat_vinyl" },
    { id: "inactive", name: "Inactive Vinyl", isActive: false, linkedMaterialIds: ["mat_vinyl"] },
  ];

  it("prioritizes products linked to a known material", () => {
    const result = filterAndPrioritizeProductsForMaterial(products, "", "mat_vinyl");

    expect(result.map((product) => product.id).slice(0, 2).sort()).toEqual(["linked", "primary"]);
  });

  it("does not suggest inactive products by default", () => {
    const result = filterAndPrioritizeProductsForMaterial(products, "vinyl", "mat_vinyl");

    expect(result.map((product) => product.id)).not.toContain("inactive");
  });

  it("still applies text filtering while preserving material priority", () => {
    const result = filterAndPrioritizeProductsForMaterial(products, "banner", "mat_vinyl");

    expect(result.map((product) => product.id)).toEqual(["linked", "general"]);
  });
});

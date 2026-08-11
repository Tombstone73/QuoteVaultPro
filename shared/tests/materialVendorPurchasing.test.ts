import { insertMaterialSchema, updateMaterialSchema } from "../schema";

const baseMaterialPayload = {
  name: "13oz Banner Vinyl",
  sku: "VINYL-13",
  materialForm: "roll",
  inventoryUnit: "square_foot",
  consumptionUnit: "square_foot",
  costPerUnit: "1.25",
  stockQuantity: "0",
  minStockAlert: "0",
  width: "54",
  rollLengthFt: "150",
  costPerRoll: "250",
};

describe("material vendor purchasing fields", () => {
  it("creates a material with vendor purchasing fields", () => {
    const parsed = insertMaterialSchema.parse({
      ...baseMaterialPayload,
      preferredVendorName: "Grimco",
      vendorSku: "GR-13OZ",
      vendorProductUrl: "vendor.example.com/materials/13oz",
      vendorNotes: "Order by the full roll.",
      vendorLastPriceCents: "24999",
      vendorLastPriceUpdatedAt: "2026-06-01",
      linkedProductIds: ["prod_banner"],
    });

    expect(parsed.preferredVendorName).toBe("Grimco");
    expect(parsed.vendorSku).toBe("GR-13OZ");
    expect(parsed.vendorProductUrl).toBe("https://vendor.example.com/materials/13oz");
    expect(parsed.vendorNotes).toBe("Order by the full roll.");
    expect(parsed.vendorLastPriceCents).toBe(24999);
    expect(parsed.vendorLastPriceUpdatedAt).toBeInstanceOf(Date);
    expect(parsed.linkedProductIds).toEqual(["prod_banner"]);
  });

  it("updates material vendor fields", () => {
    const parsed = updateMaterialSchema.parse({
      preferredVendorName: "Updated Supplier",
      vendorProductUrl: "https://vendor.example.com/new-page",
      vendorLastPriceCents: 12500,
      vendorLastPriceUpdatedAt: "2026-06-02T00:00:00.000Z",
    });

    expect(parsed.preferredVendorName).toBe("Updated Supplier");
    expect(parsed.vendorProductUrl).toBe("https://vendor.example.com/new-page");
    expect(parsed.vendorLastPriceCents).toBe(12500);
    expect(parsed.vendorLastPriceUpdatedAt).toBeInstanceOf(Date);
  });

  it("normalizes a legacy vendor cost unit alias on create and edit", () => {
    const created = insertMaterialSchema.parse({
      ...baseMaterialPayload,
      vendorCostUnit: "ea",
    });
    const updated = updateMaterialSchema.parse({ vendorCostUnit: "ea" });

    expect(created.vendorCostUnit).toBe("each");
    expect(updated.vendorCostUnit).toBe("each");
  });

  it("clears material vendor fields with blank or null values", () => {
    const parsed = updateMaterialSchema.parse({
      preferredVendorName: "",
      vendorSku: "",
      vendorProductUrl: "",
      vendorNotes: "",
      vendorLastPriceCents: null,
      vendorLastPriceUpdatedAt: null,
    });

    expect(parsed.preferredVendorName).toBeNull();
    expect(parsed.vendorSku).toBeNull();
    expect(parsed.vendorProductUrl).toBeNull();
    expect(parsed.vendorNotes).toBeNull();
    expect(parsed.vendorLastPriceCents).toBeNull();
    expect(parsed.vendorLastPriceUpdatedAt).toBeNull();
  });

  it("rejects unsafe vendor URL protocols", () => {
    const result = insertMaterialSchema.safeParse({
      ...baseMaterialPayload,
      vendorProductUrl: "javascript:alert(1)",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("http:// or https://"))).toBe(true);
    }
  });

  it("stores blank vendor URL as null while preserving linked product ids", () => {
    const parsed = insertMaterialSchema.parse({
      ...baseMaterialPayload,
      vendorProductUrl: "   ",
      linkedProductIds: ["prod_a", "prod_b"],
    });

    expect(parsed.vendorProductUrl).toBeNull();
    expect(parsed.linkedProductIds).toEqual(["prod_a", "prod_b"]);
  });
});

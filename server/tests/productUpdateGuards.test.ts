import { describe, expect, test } from "@jest/globals";
import { applyProductTypeIdUpdateGuard } from "../lib/productUpdateGuards";

const knownProductTypeIds = ["pt_roll", "pt_sheet", "pt_digital"];

describe("applyProductTypeIdUpdateGuard", () => {
  test("leaves omitted productTypeId unchanged", () => {
    const result = applyProductTypeIdUpdateGuard({
      productData: { name: "Foam Board" },
      existingProductTypeId: "pt_sheet",
      knownProductTypeIds,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.productData).toEqual({ name: "Foam Board" });
      expect(Object.prototype.hasOwnProperty.call(result.productData, "productTypeId")).toBe(false);
    }
  });

  test("preserves an existing productTypeId when a blank update is attempted", () => {
    const result = applyProductTypeIdUpdateGuard({
      productData: { productTypeId: "" },
      existingProductTypeId: "pt_sheet",
      knownProductTypeIds,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.productData.productTypeId).toBe("pt_sheet");
      expect(result.warning?.code).toBe("PRODUCT_TYPE_BLANK_PRESERVED");
    }
  });

  test("allows null when there is no existing productTypeId to preserve", () => {
    const result = applyProductTypeIdUpdateGuard({
      productData: { productTypeId: null },
      existingProductTypeId: null,
      knownProductTypeIds,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.productData.productTypeId).toBeNull();
    }
  });

  test("allows known non-empty productTypeId updates", () => {
    const result = applyProductTypeIdUpdateGuard({
      productData: { productTypeId: "pt_roll" },
      existingProductTypeId: "pt_sheet",
      knownProductTypeIds,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.productData.productTypeId).toBe("pt_roll");
    }
  });

  test("rejects unknown non-empty productTypeId updates", () => {
    const result = applyProductTypeIdUpdateGuard({
      productData: { productTypeId: "sheet" },
      existingProductTypeId: "pt_sheet",
      knownProductTypeIds,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.code).toBe("UNKNOWN_PRODUCT_TYPE_ID");
    }
  });
});

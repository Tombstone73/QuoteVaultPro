import { describe, expect, jest, test } from "@jest/globals";
import {
  buildMaterialsApiUrl,
  fetchMaterials,
  parseMaterialsApiResponse,
  type Material,
} from "./useMaterials";

const legacyMaterial: Material = {
  id: "material-legacy",
  name: "Legacy Coroplast",
  sku: "COR-040",
  type: "sheet",
  inventoryUnit: "sheet",
  costPerUnit: "26.91",
  stockQuantity: "10",
  minStockAlert: "0",
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  inventoryUnitsPerPurchaseUnit: null,
  minimumPurchaseQuantity: null,
};

describe("material list loading", () => {
  test("keeps legacy rows with null vendor-purchase fields selectable", () => {
    expect(parseMaterialsApiResponse({ success: true, data: [legacyMaterial] })).toEqual([legacyMaterial]);
    expect(buildMaterialsApiUrl()).toBe("/api/materials");
    expect(buildMaterialsApiUrl({ includeInactive: true })).toBe("/api/materials?includeInactive=true");
  });

  test("rejects a failed endpoint response instead of treating it as an empty list", async () => {
    const request = jest.fn().mockResolvedValue({ ok: false, json: jest.fn() });

    await expect(fetchMaterials(undefined, request)).rejects.toThrow("Failed to fetch materials");
    expect(request).toHaveBeenCalledWith("/api/materials", { credentials: "include" });
  });
});

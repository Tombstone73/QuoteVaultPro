import { describe, expect, jest, test } from "@jest/globals";
import {
  buildMaterialsApiUrl,
  fetchMaterials,
  filterMaterialsForClient,
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

  test("searches family names, dimension values, and vendor SKUs before type and low-stock filters", () => {
    const cyan = { ...legacyMaterial, id: "cyan", name: "Canon M5 Ink - Cyan", sku: "CANON-C", familyName: "Canon M5 Ink", vendorSku: "VENDOR-C", variantValues: [{ dimensionId: "color", value: "Cyan" }], type: "ink", stockQuantity: "2", minStockAlert: "4" };
    const magenta = { ...cyan, id: "magenta", name: "Canon M5 Ink - Magenta", sku: "CANON-M", vendorSku: "VENDOR-M", variantValues: [{ dimensionId: "color", value: "Magenta" }], stockQuantity: "8" };
    const list = [cyan, magenta, legacyMaterial];

    expect(filterMaterialsForClient(list, { search: "canon m5" }).map((m) => m.id)).toEqual(["cyan", "magenta"]);
    expect(filterMaterialsForClient(list, { search: "cyan" }).map((m) => m.id)).toEqual(["cyan"]);
    expect(filterMaterialsForClient(list, { search: "vendor-m" }).map((m) => m.id)).toEqual(["magenta"]);
    expect(filterMaterialsForClient(list, { search: "canon-c" }).map((m) => m.id)).toEqual(["cyan"]);
    expect(filterMaterialsForClient(list, { lowStockOnly: true, type: "ink" }).map((m) => m.id)).toEqual(["cyan"]);
  });
});

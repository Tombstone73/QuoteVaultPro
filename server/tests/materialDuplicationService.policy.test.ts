import { describe, expect, test } from "@jest/globals";

import {
  buildDuplicateMaterialIdentity,
  buildDuplicateMaterialPayload,
  DuplicateMaterialError,
} from "../services/materialDuplicationService";

const sourceMaterial = {
  id: "mat-source",
  organizationId: "org-source",
  name: "Foam Board",
  sku: "FOAM",
  type: "sheet",
  materialForm: "sheet",
  category: "Rigid",
  inventoryUnit: "sheet",
  vendorCostUnit: "sheet",
  consumptionUnit: "sheet",
  weightValue: null,
  weightUnit: null,
  weightBasis: null,
  weightOzPerBasis: null,
  width: "48",
  height: "96",
  thickness: "0.1875",
  thicknessUnit: "in",
  color: "White",
  costPerUnit: "12.5000",
  stockQuantity: "27",
  minStockAlert: "4",
  isActive: false,
  preferredVendorId: "vendor-1",
  preferredVendorName: "Vendor One",
  vendorSku: "V-FOAM",
  vendorCostPerUnit: "9.2500",
  vendorProductUrl: "https://vendor.example/material",
  vendorNotes: "Pack flat",
  vendorLastPriceCents: 925,
  vendorLastPriceUpdatedAt: new Date("2026-01-02T00:00:00Z"),
  specsJson: { faces: "paper" },
  rollLengthFt: null,
  costPerRoll: null,
  edgeWasteInPerSide: null,
  leadWasteFt: null,
  tailWasteFt: null,
  aiParsingDescription: "foamcore",
  aiParsingDescriptionLinkedToDescription: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
} as any;

describe("material duplication policy helpers", () => {
  test("preserves the existing copy naming convention and avoids collisions", () => {
    expect(buildDuplicateMaterialIdentity(sourceMaterial, [])).toEqual({
      name: "Foam Board (Copy)",
      sku: "FOAM-COPY",
    });

    expect(buildDuplicateMaterialIdentity(sourceMaterial, [
      { name: "Foam Board (Copy)", sku: "FOAM-COPY" },
      { name: "Foam Board (Copy 2)", sku: "FOAM-COPY-2" },
    ])).toEqual({
      name: "Foam Board (Copy 3)",
      sku: "FOAM-COPY-3",
    });
  });

  test("copies editable material configuration while regenerating identity and stock state", () => {
    const payload = buildDuplicateMaterialPayload(sourceMaterial, {
      name: "Foam Board (Copy)",
      sku: "FOAM-COPY",
    }, {
      preferredVendorId: "vendor-1",
      linkedProductIds: ["product-1"],
    });

    expect(payload).toMatchObject({
      name: "Foam Board (Copy)",
      sku: "FOAM-COPY",
      materialForm: "sheet",
      category: "Rigid",
      inventoryUnit: "sheet",
      consumptionUnit: "sheet",
      costPerUnit: 12.5,
      stockQuantity: 0,
      minStockAlert: 4,
      isActive: true,
      preferredVendorId: "vendor-1",
      vendorSku: "V-FOAM",
      linkedProductIds: ["product-1"],
    });
    expect(payload).not.toHaveProperty("id");
    expect(payload).not.toHaveProperty("organizationId");
    expect(payload).not.toHaveProperty("createdAt");
    expect(payload).not.toHaveProperty("updatedAt");
  });

  test("fails clearly when legacy material rows lack required operational form data", () => {
    expect(() => buildDuplicateMaterialPayload({
      ...sourceMaterial,
      type: "",
      materialForm: null,
    }, {
      name: "Legacy (Copy)",
      sku: "LEG-COPY",
    })).toThrow(DuplicateMaterialError);
  });
});

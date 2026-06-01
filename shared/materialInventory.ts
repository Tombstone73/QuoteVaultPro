export const materialInventoryStatusValues = [
  "inactive",
  "needs_configuration",
  "out_of_stock",
  "low_stock",
  "healthy",
  "on_order",
] as const;

export type MaterialInventoryStatus = (typeof materialInventoryStatusValues)[number];

export const inventoryMovementTypeValues = ["usage", "adjustment", "receipt"] as const;
export type InventoryMovementType = (typeof inventoryMovementTypeValues)[number];

export const materialReorderRequestStatusValues = ["requested", "ordered", "received", "cancelled"] as const;
export type MaterialReorderRequestStatus = (typeof materialReorderRequestStatusValues)[number];

export type MaterialInventoryShape = {
  isActive?: boolean | null;
  name?: string | null;
  unitOfMeasure?: string | null;
  type?: string | null;
  stockQuantity?: string | number | null;
  minStockAlert?: string | number | null;
  costPerUnit?: string | number | null;
  width?: string | number | null;
  height?: string | number | null;
  rollLengthFt?: string | number | null;
  costPerRoll?: string | number | null;
  preferredVendorId?: string | null;
  preferredVendorName?: string | null;
  vendorSku?: string | null;
  vendorCostPerUnit?: string | number | null;
  vendorProductUrl?: string | null;
  vendorNotes?: string | null;
  vendorLastPriceCents?: string | number | null;
};

export type MaterialConfigurationStatus = {
  needsConfiguration: boolean;
  missing: string[];
};

function asTrimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function deriveMaterialConfigurationStatus(material: MaterialInventoryShape): MaterialConfigurationStatus {
  const missing = new Set<string>();
  const stockQuantity = asNumber(material.stockQuantity) ?? 0;
  const minStockAlert = asNumber(material.minStockAlert);
  const type = asTrimmed(material.type).toLowerCase();

  if (!asTrimmed(material.name)) {
    missing.add("name");
  }

  if (!asTrimmed(material.unitOfMeasure)) {
    missing.add("unit_of_measure");
  }

  if ((asNumber(material.costPerUnit) ?? null) == null) {
    missing.add("cost_per_unit");
  }

  if (type === "sheet") {
    if ((asNumber(material.width) ?? 0) <= 0) {
      missing.add("width");
    }
    if ((asNumber(material.height) ?? 0) <= 0) {
      missing.add("height");
    }
  }

  if (type === "roll") {
    if ((asNumber(material.width) ?? 0) <= 0) {
      missing.add("width");
    }
    if ((asNumber(material.rollLengthFt) ?? 0) <= 0) {
      missing.add("roll_length_ft");
    }
    if ((asNumber(material.costPerRoll) ?? 0) <= 0) {
      missing.add("cost_per_roll");
    }
  }

  if (stockQuantity > 0 && ((minStockAlert ?? 0) <= 0)) {
    missing.add("min_stock_alert");
  }

  const hasVendorDetail =
    Boolean(asTrimmed(material.vendorSku)) ||
    Boolean(asTrimmed(material.vendorProductUrl)) ||
    Boolean(asTrimmed(material.vendorNotes)) ||
    (asNumber(material.vendorCostPerUnit) ?? null) != null ||
    (asNumber(material.vendorLastPriceCents) ?? null) != null;
  if (hasVendorDetail && !asTrimmed(material.preferredVendorId) && !asTrimmed(material.preferredVendorName)) {
    missing.add("preferred_vendor");
  }

  return {
    needsConfiguration: missing.size > 0,
    missing: Array.from(missing),
  };
}

export function deriveMaterialInventoryStatus(
  material: MaterialInventoryShape,
  openReorderRequests: number | boolean = 0,
): MaterialInventoryStatus {
  if (material.isActive === false) {
    return "inactive";
  }

  if (deriveMaterialConfigurationStatus(material).needsConfiguration) {
    return "needs_configuration";
  }

  const hasOpenReorder = typeof openReorderRequests === "boolean"
    ? openReorderRequests
    : openReorderRequests > 0;

  if (hasOpenReorder) {
    return "on_order";
  }

  const stockQuantity = asNumber(material.stockQuantity) ?? 0;
  const minStockAlert = asNumber(material.minStockAlert);

  if (stockQuantity <= 0) {
    return "out_of_stock";
  }

  if (minStockAlert != null && minStockAlert > 0 && stockQuantity <= minStockAlert) {
    return "low_stock";
  }

  return "healthy";
}

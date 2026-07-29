export type PrepressCombinedRunItem = {
  lineItemId: string;
  orderId: string;
  productName?: string | null;
  activeOwnerJobId?: string | null;
  selectedProductionDestination?: "roll" | "flatbed" | null;
  materialId?: string | null;
  materialName?: string | null;
  finalFileCount?: number | null;
  fileCounts?: { finals?: number | null } | null;
  quantity?: number | null;
  status?: string | null;
  workflowState?: string | null;
  productionReleaseBlockedReason?: string | null;
};

export type PrepressCombinedRunValidation = {
  canCreate: boolean;
  reason: string | null;
  orderId: string | null;
  stationKey: "roll" | "flatbed" | null;
  hasStationConflict: boolean;
  hasMaterialConflict: boolean;
  totalAllocatedQuantity: number;
};

const terminalValues = new Set(["done", "complete", "completed", "void", "canceled", "cancelled"]);

export function getPrepressCombinedRunItemIssue(item: PrepressCombinedRunItem): string | null {
  if (item.productionReleaseBlockedReason) return item.productionReleaseBlockedReason;
  if (!item.activeOwnerJobId) return "Selected items must have an active Prepress production job.";
  if (!item.orderId) return "Selected items must belong to an order.";
  if (!item.selectedProductionDestination) return "Selected items need a production destination.";
  if ((Number(item.quantity) || 0) <= 0) return "Selected items must have remaining quantity.";
  const finalFileCount = Number(item.finalFileCount ?? item.fileCounts?.finals ?? 0);
  if (finalFileCount <= 0) return "Assign production artwork before adding this job to a combined run.";
  if (terminalValues.has(String(item.status || "").toLowerCase()) || terminalValues.has(String(item.workflowState || "").toLowerCase())) {
    return "Canceled or terminal items cannot be combined.";
  }
  return null;
}

export function validatePrepressCombinedRunSelection(
  items: PrepressCombinedRunItem[],
  allocations: Record<string, number | string | null | undefined>,
  compatibilityOverrideReason: string,
): PrepressCombinedRunValidation {
  if (items.length === 0) {
    return { canCreate: false, reason: "Select at least two eligible Prepress items.", orderId: null, stationKey: null, hasStationConflict: false, hasMaterialConflict: false, totalAllocatedQuantity: 0 };
  }
  if (items.length === 1) {
    return { canCreate: false, reason: "Select at least two eligible Prepress items.", orderId: items[0]?.orderId ?? null, stationKey: items[0]?.selectedProductionDestination ?? null, hasStationConflict: false, hasMaterialConflict: false, totalAllocatedQuantity: 0 };
  }

  const itemIssue = items.map(getPrepressCombinedRunItemIssue).find(Boolean);
  const orderIds = Array.from(new Set(items.map((item) => item.orderId).filter(Boolean)));
  const stationKeys = Array.from(new Set(items.map((item) => item.selectedProductionDestination).filter(Boolean)));
  const materialKeys = Array.from(new Set(items.map((item) => item.materialId || item.materialName || "").filter(Boolean)));
  const hasStationConflict = stationKeys.length > 1;
  const hasMaterialConflict = materialKeys.length > 1;

  if (itemIssue) {
    return { canCreate: false, reason: itemIssue, orderId: orderIds[0] ?? null, stationKey: stationKeys[0] ?? null, hasStationConflict, hasMaterialConflict, totalAllocatedQuantity: 0 };
  }
  if (orderIds.length !== 1) {
    return { canCreate: false, reason: "Combined runs must use items from one order.", orderId: null, stationKey: stationKeys[0] ?? null, hasStationConflict, hasMaterialConflict, totalAllocatedQuantity: 0 };
  }

  let totalAllocatedQuantity = 0;
  for (const item of items) {
    const max = Number(item.quantity) || 0;
    const raw = allocations[item.lineItemId] ?? max;
    const value = typeof raw === "string" ? Number(raw) : Number(raw);
    if (!Number.isInteger(value) || value <= 0 || value > max) {
      return {
        canCreate: false,
        reason: `Allocation for ${item.productName || "a selected item"} must be between 1 and ${max}.`,
        orderId: orderIds[0] ?? null,
        stationKey: stationKeys[0] ?? null,
        hasStationConflict,
        hasMaterialConflict,
        totalAllocatedQuantity,
      };
    }
    totalAllocatedQuantity += value;
  }

  if ((hasStationConflict || hasMaterialConflict) && !compatibilityOverrideReason.trim()) {
    return {
      canCreate: false,
      reason: "Mixed production destination or material requires an authorized override reason.",
      orderId: orderIds[0] ?? null,
      stationKey: stationKeys[0] ?? null,
      hasStationConflict,
      hasMaterialConflict,
      totalAllocatedQuantity,
    };
  }

  return {
    canCreate: true,
    reason: null,
    orderId: orderIds[0] ?? null,
    stationKey: stationKeys[0] ?? null,
    hasStationConflict,
    hasMaterialConflict,
    totalAllocatedQuantity,
  };
}

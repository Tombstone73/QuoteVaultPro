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

export type PrepressCombinedRunBlockerCode =
  | "resolvable_missing_production_artwork"
  | "hard_missing_prepress_job"
  | "hard_missing_order"
  | "hard_wrong_station"
  | "hard_invalid_quantity"
  | "hard_invalid_state"
  | "hard_proof_blocked";

export type PrepressCombinedRunItemBlocker = {
  code: PrepressCombinedRunBlockerCode;
  message: string;
  resolvable: boolean;
};

export type PrepressCombinedRunValidation = {
  canCreate: boolean;
  reason: string | null;
  orderId: string | null;
  orderIds: string[];
  stationKey: "roll" | "flatbed" | null;
  hasStationConflict: boolean;
  hasMaterialConflict: boolean;
  totalAllocatedQuantity: number;
  requiresArtworkResolution: boolean;
  resolvableBlockers: Array<{ lineItemId: string; code: PrepressCombinedRunBlockerCode; message: string }>;
  hardBlockers: Array<{ lineItemId: string; code: PrepressCombinedRunBlockerCode; message: string }>;
};

const terminalValues = new Set(["done", "complete", "completed", "void", "canceled", "cancelled"]);

export function getPrepressCombinedRunItemBlocker(item: PrepressCombinedRunItem): PrepressCombinedRunItemBlocker | null {
  if (item.productionReleaseBlockedReason) return { code: "hard_proof_blocked", message: item.productionReleaseBlockedReason, resolvable: false };
  if (!item.activeOwnerJobId) return { code: "hard_missing_prepress_job", message: "Selected items must have an active Prepress production job.", resolvable: false };
  if (!item.orderId) return { code: "hard_missing_order", message: "Selected items must belong to an order.", resolvable: false };
  if (!item.selectedProductionDestination) return { code: "hard_wrong_station", message: "Selected items need a production destination.", resolvable: false };
  if ((Number(item.quantity) || 0) <= 0) return { code: "hard_invalid_quantity", message: "Selected items must have remaining quantity.", resolvable: false };
  const finalFileCount = Number(item.finalFileCount ?? item.fileCounts?.finals ?? 0);
  if (finalFileCount <= 0) return { code: "resolvable_missing_production_artwork", message: "Needs production artwork assignment.", resolvable: true };
  if (terminalValues.has(String(item.status || "").toLowerCase()) || terminalValues.has(String(item.workflowState || "").toLowerCase())) {
    return { code: "hard_invalid_state", message: "Canceled or terminal items cannot be combined.", resolvable: false };
  }
  return null;
}

export function getPrepressCombinedRunItemIssue(item: PrepressCombinedRunItem): string | null {
  return getPrepressCombinedRunItemBlocker(item)?.message ?? null;
}

export function canSelectPrepressCombinedRunItem(item: PrepressCombinedRunItem): boolean {
  const blocker = getPrepressCombinedRunItemBlocker(item);
  return !blocker || blocker.resolvable;
}

function baseValidation(args: Partial<PrepressCombinedRunValidation>): PrepressCombinedRunValidation {
  return {
    canCreate: false,
    reason: null,
    orderId: null,
    orderIds: [],
    stationKey: null,
    hasStationConflict: false,
    hasMaterialConflict: false,
    totalAllocatedQuantity: 0,
    requiresArtworkResolution: false,
    resolvableBlockers: [],
    hardBlockers: [],
    ...args,
  };
}

export function validatePrepressCombinedRunSelection(
  items: PrepressCombinedRunItem[],
  allocations: Record<string, number | string | null | undefined>,
  compatibilityOverrideReason: string,
): PrepressCombinedRunValidation {
  if (items.length === 0) {
    return baseValidation({ reason: "Select at least two eligible Prepress items." });
  }
  if (items.length === 1) {
    return baseValidation({ reason: "Select at least two eligible Prepress items.", orderId: items[0]?.orderId ?? null, orderIds: items[0]?.orderId ? [items[0].orderId] : [], stationKey: items[0]?.selectedProductionDestination ?? null });
  }

  const orderIds = Array.from(new Set(items.map((item) => item.orderId).filter(Boolean)));
  const stationKeys = Array.from(new Set(items.map((item) => item.selectedProductionDestination).filter(Boolean)));
  const materialKeys = Array.from(new Set(items.map((item) => item.materialId || item.materialName || "").filter(Boolean)));
  const hasStationConflict = stationKeys.length > 1;
  const hasMaterialConflict = materialKeys.length > 1;
  const blockers = items
    .map((item) => ({ item, blocker: getPrepressCombinedRunItemBlocker(item) }))
    .filter((entry): entry is { item: PrepressCombinedRunItem; blocker: PrepressCombinedRunItemBlocker } => Boolean(entry.blocker));
  const hardBlockers = blockers
    .filter((entry) => !entry.blocker.resolvable)
    .map((entry) => ({ lineItemId: entry.item.lineItemId, code: entry.blocker.code, message: entry.blocker.message }));
  const resolvableBlockers = blockers
    .filter((entry) => entry.blocker.resolvable)
    .map((entry) => ({ lineItemId: entry.item.lineItemId, code: entry.blocker.code, message: entry.blocker.message }));
  const requiresArtworkResolution = resolvableBlockers.some((blocker) => blocker.code === "resolvable_missing_production_artwork");

  if (hardBlockers.length > 0) {
    return baseValidation({
      reason: hardBlockers[0].message,
      orderId: orderIds.length === 1 ? orderIds[0] : null,
      orderIds,
      stationKey: stationKeys[0] ?? null,
      hasStationConflict,
      hasMaterialConflict,
      requiresArtworkResolution,
      resolvableBlockers,
      hardBlockers,
    });
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
        orderId: orderIds.length === 1 ? orderIds[0] : null,
        orderIds,
        stationKey: stationKeys[0] ?? null,
        hasStationConflict,
        hasMaterialConflict,
        totalAllocatedQuantity,
        requiresArtworkResolution,
        resolvableBlockers,
        hardBlockers,
      };
    }
    totalAllocatedQuantity += value;
  }

  if (requiresArtworkResolution) {
    return {
      canCreate: false,
      reason: `${resolvableBlockers.length} selected ${resolvableBlockers.length === 1 ? "job needs" : "jobs need"} production artwork before the run can be created.`,
      orderId: orderIds.length === 1 ? orderIds[0] : null,
      orderIds,
      stationKey: stationKeys[0] ?? null,
      hasStationConflict,
      hasMaterialConflict,
      totalAllocatedQuantity,
      requiresArtworkResolution,
      resolvableBlockers,
      hardBlockers,
    };
  }

  if ((hasStationConflict || hasMaterialConflict) && !compatibilityOverrideReason.trim()) {
    return {
      canCreate: false,
      reason: "Mixed production destination or material requires an authorized override reason.",
      orderId: orderIds.length === 1 ? orderIds[0] : null,
      orderIds,
      stationKey: stationKeys[0] ?? null,
      hasStationConflict,
      hasMaterialConflict,
      totalAllocatedQuantity,
      requiresArtworkResolution,
      resolvableBlockers,
      hardBlockers,
    };
  }

  return {
    canCreate: true,
    reason: null,
    orderId: orderIds.length === 1 ? orderIds[0] : null,
    orderIds,
    stationKey: stationKeys[0] ?? null,
    hasStationConflict,
    hasMaterialConflict,
    totalAllocatedQuantity,
    requiresArtworkResolution,
    resolvableBlockers,
    hardBlockers,
  };
}

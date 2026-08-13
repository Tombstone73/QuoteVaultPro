/**
 * Canonical line-item readiness for fulfillment. A queued Fulfillment job is
 * an ownership handoff after production, not unfinished production.
 */
export type FulfillmentLineReadiness = {
  eligible: boolean;
  status: "production_complete" | "awaiting_production";
  label: string;
  reason: "completed_lifecycle" | "fulfillment_handoff" | "active_production" | "incomplete_lifecycle";
};

export type FulfillmentLineQuantityStatus =
  | "excluded"
  | "waiting_on_production"
  | "partially_ready"
  | "ready"
  | "fulfilled";

export type FulfillmentLineQuantityProjection = {
  requiresFulfillment: boolean;
  productionRequired: boolean;
  status: FulfillmentLineQuantityStatus;
  label: string;
  orderedQuantity: number;
  productionCompleteQuantity: number;
  /** All terminal physical handoffs, across shipment and pickup. */
  fulfilledQuantity: number;
  /** Retained for API compatibility; shipped is only one fulfillment channel. */
  shippedQuantity: number;
  pickedUpQuantity: number;
  eligibleQuantity: number;
  blockedQuantity: number;
  remainingQuantity: number;
  exclusionReason: "service_fee" | "bundle_parent" | "cancelled" | null;
};

export type FulfillmentOrderQuantitySummary = {
  physicalLineCount: number;
  orderedQuantity: number;
  productionCompleteQuantity: number;
  fulfilledQuantity: number;
  eligibleQuantity: number;
  blockedQuantity: number;
  shippedQuantity: number;
  pickedUpQuantity: number;
  remainingQuantity: number;
  status: "WAITING_ON_PRODUCTION" | "PARTIALLY_READY" | "READY" | "PARTIALLY_SHIPPED" | "SHIPPED";
};

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function resolveFulfillmentLineReadiness(input: {
  workflowState?: string | null;
  lifecycleStatus?: string | null;
  activeOwnerStationKey?: string | null;
  activeOwnerStepKey?: string | null;
  activeOwnerStatus?: string | null;
}): FulfillmentLineReadiness {
  const workflowState = normalize(input.workflowState);
  const lifecycleStatus = normalize(input.lifecycleStatus);
  const ownerStation = normalize(input.activeOwnerStationKey);
  const ownerStep = normalize(input.activeOwnerStepKey);
  const hasActiveOwner = Boolean(ownerStation || ownerStep || normalize(input.activeOwnerStatus));
  const isFulfillmentHandoff = ownerStation === "fulfillment" || ownerStep === "fulfillment";
  const completedLifecycle = workflowState === "completed" || lifecycleStatus === "complete" || lifecycleStatus === "completed";

  if (completedLifecycle && (!hasActiveOwner || isFulfillmentHandoff)) {
    return {
      eligible: true,
      status: "production_complete",
      label: "Production complete, awaiting fulfillment",
      reason: isFulfillmentHandoff ? "fulfillment_handoff" : "completed_lifecycle",
    };
  }
  if (hasActiveOwner && !isFulfillmentHandoff) {
    return { eligible: false, status: "awaiting_production", label: "Production in progress", reason: "active_production" };
  }
  return { eligible: false, status: "awaiting_production", label: "Awaiting production", reason: "incomplete_lifecycle" };
}

function quantity(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

/**
 * Canonical physical-fulfillment projection. The lifecycle resolver above
 * remains authoritative for standard production; this layer adds intent,
 * bundle, shipped, and partial-production quantity semantics.
 */
export function resolveFulfillmentLineQuantity(input: {
  workflowIntent?: string | null;
  requiresProductionJob?: boolean | null;
  lineItemRole?: string | null;
  productionBypassed?: boolean | null;
  workflowState?: string | null;
  lifecycleStatus?: string | null;
  activeOwnerStationKey?: string | null;
  activeOwnerStepKey?: string | null;
  activeOwnerStatus?: string | null;
  orderedQuantity?: number | null;
  productionCompleteQuantity?: number | null;
  shippedQuantity?: number | null;
  pickedUpQuantity?: number | null;
}): FulfillmentLineQuantityProjection {
  const orderedQuantity = quantity(input.orderedQuantity);
  const shippedQuantity = Math.min(orderedQuantity, quantity(input.shippedQuantity));
  const pickedUpQuantity = Math.min(Math.max(0, orderedQuantity - shippedQuantity), quantity(input.pickedUpQuantity));
  const fulfilledQuantity = Math.min(orderedQuantity, shippedQuantity + pickedUpQuantity);
  const remainingQuantity = Math.max(0, orderedQuantity - fulfilledQuantity);
  const workflowIntent = normalize(input.workflowIntent);
  const role = normalize(input.lineItemRole);
  const cancelled = [normalize(input.workflowState), normalize(input.lifecycleStatus)].some((value) => value === "canceled" || value === "cancelled");
  const exclusionReason = cancelled
    ? "cancelled" as const
    : role === "parent"
      ? "bundle_parent" as const
      : workflowIntent === "service_fee"
        ? "service_fee" as const
        : null;

  if (exclusionReason || orderedQuantity <= 0) {
    return {
      requiresFulfillment: false,
      productionRequired: false,
      status: "excluded",
      label: exclusionReason === "service_fee" ? "Billing-only service" : exclusionReason === "bundle_parent" ? "Bundle summary" : "Not fulfillable",
      orderedQuantity,
      productionCompleteQuantity: 0,
      fulfilledQuantity,
      shippedQuantity,
      pickedUpQuantity,
      eligibleQuantity: 0,
      blockedQuantity: 0,
      remainingQuantity: 0,
      exclusionReason,
    };
  }

  const productionRequired = workflowIntent !== "fulfillment_only" && input.requiresProductionJob !== false && input.productionBypassed !== true;
  const lifecycleReadiness = resolveFulfillmentLineReadiness(input);
  const productionCompleteQuantity = productionRequired
    // Successful production-run quantity is the physical ceiling.  Lifecycle
    // state can explain why a line is eligible, but must never manufacture the
    // missing quantity when a run is only partially complete.
    ? Math.min(orderedQuantity, quantity(input.productionCompleteQuantity))
    : orderedQuantity;
  const eligibleQuantity = Math.max(0, productionCompleteQuantity - fulfilledQuantity);
  const blockedQuantity = Math.max(0, remainingQuantity - eligibleQuantity);
  const status: FulfillmentLineQuantityStatus = remainingQuantity === 0
    ? "fulfilled"
    : eligibleQuantity > 0 && blockedQuantity > 0
      ? "partially_ready"
      : eligibleQuantity > 0
        ? "ready"
        : "waiting_on_production";
  const label = status === "fulfilled"
    ? "Fulfilled"
    : status === "partially_ready"
      ? `Ready ${eligibleQuantity} / ${remainingQuantity}`
      : status === "ready"
        ? productionRequired ? "Production complete, awaiting fulfillment" : "Ready for fulfillment"
        : lifecycleReadiness.label;

  return {
    requiresFulfillment: true,
    productionRequired,
    status,
    label,
    orderedQuantity,
    productionCompleteQuantity,
    fulfilledQuantity,
    shippedQuantity,
    pickedUpQuantity,
    eligibleQuantity,
    blockedQuantity,
    remainingQuantity,
    exclusionReason: null,
  };
}

export function summarizeFulfillmentOrderQuantities(
  lines: FulfillmentLineQuantityProjection[],
): FulfillmentOrderQuantitySummary {
  const physical = lines.filter((line) => line.requiresFulfillment);
  const sum = (field: keyof FulfillmentLineQuantityProjection) => physical.reduce((total, line) => total + Number(line[field] || 0), 0);
  const orderedQuantity = sum("orderedQuantity");
  const productionCompleteQuantity = sum("productionCompleteQuantity");
  const fulfilledQuantity = sum("fulfilledQuantity");
  const eligibleQuantity = sum("eligibleQuantity");
  const blockedQuantity = sum("blockedQuantity");
  const shippedQuantity = sum("shippedQuantity");
  const pickedUpQuantity = sum("pickedUpQuantity");
  const remainingQuantity = sum("remainingQuantity");
  const status = remainingQuantity <= 0 && orderedQuantity > 0
    ? "SHIPPED" as const
    : shippedQuantity > 0
      ? "PARTIALLY_SHIPPED" as const
      : eligibleQuantity > 0 && blockedQuantity > 0
        ? "PARTIALLY_READY" as const
        : eligibleQuantity > 0
          ? "READY" as const
          : "WAITING_ON_PRODUCTION" as const;
  return {
    physicalLineCount: physical.length,
    orderedQuantity,
    productionCompleteQuantity,
    fulfilledQuantity,
    eligibleQuantity,
    blockedQuantity,
    shippedQuantity,
    pickedUpQuantity,
    remainingQuantity,
    status,
  };
}

/** Maximum quantity a new shipment may allocate from this line right now. */
export function resolveFulfillmentAllocatableQuantity(
  line: FulfillmentLineQuantityProjection,
  verifiedCumulativeQuantity: number,
): number {
  const verifiedRemaining = Math.max(0, quantity(verifiedCumulativeQuantity) - line.fulfilledQuantity);
  return Math.min(line.eligibleQuantity, verifiedRemaining);
}

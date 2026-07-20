export type OrderLineItemActiveWorkWarning = {
  title: string;
  description: string;
} | null;

export type OrderLineItemSelectionState = false | true | "indeterminate";

export function sortOrderLineItemsByPersistedOrder<T extends {
  id: string;
  sortOrder?: number | null;
  createdAt?: string | Date | null;
}>(lineItems: readonly T[]): T[] {
  return [...lineItems].sort((left, right) => {
    const sortDelta = (Number(left.sortOrder) || 0) - (Number(right.sortOrder) || 0);
    if (sortDelta !== 0) return sortDelta;
    const createdDelta = String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? ""));
    return createdDelta !== 0 ? createdDelta : String(left.id).localeCompare(String(right.id));
  });
}

export function buildOrderLineNumberMap(lineItemIds: readonly string[]): Map<string, number> {
  return new Map(lineItemIds.map((id, index) => [String(id), index + 1]));
}

export type OrderLineItemReorderEntry = {
  id: string;
  sortOrder: number;
};

export function buildOrderLineItemReorderPayload(lineItemIds: readonly string[]): {
  items: OrderLineItemReorderEntry[];
} {
  return {
    items: lineItemIds.map((id, sortOrder) => ({ id: String(id), sortOrder })),
  };
}

export function moveOrderLineItemIds(
  lineItemIds: readonly string[],
  activeId: string,
  overId: string,
): string[] {
  const oldIndex = lineItemIds.indexOf(String(activeId));
  const newIndex = lineItemIds.indexOf(String(overId));
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return [...lineItemIds];
  const next = [...lineItemIds];
  const [moved] = next.splice(oldIndex, 1);
  next.splice(newIndex, 0, moved);
  return next;
}

export function applyOrderLineItemReorder<T extends { id: string; sortOrder?: number | null }>(
  lineItems: readonly T[],
  entries: readonly OrderLineItemReorderEntry[],
): T[] {
  const sortOrderById = new Map(entries.map((entry) => [String(entry.id), entry.sortOrder]));
  return lineItems
    .map((lineItem) => {
      const sortOrder = sortOrderById.get(String(lineItem.id));
      return sortOrder === undefined ? lineItem : { ...lineItem, sortOrder };
    })
    .sort((left, right) => {
      const leftOrder = sortOrderById.get(String(left.id));
      const rightOrder = sortOrderById.get(String(right.id));
      if (leftOrder === undefined && rightOrder === undefined) return 0;
      if (leftOrder === undefined) return 1;
      if (rightOrder === undefined) return -1;
      return leftOrder - rightOrder;
    });
}

export async function persistOrderLineItemReorder(
  orderId: string,
  lineItemIds: readonly string[],
  fetcher: typeof fetch = fetch,
): Promise<OrderLineItemReorderEntry[]> {
  const payload = buildOrderLineItemReorderPayload(lineItemIds);
  const response = await fetcher(`/api/orders/${orderId}/line-items/reorder`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result?.message || "Could not save line item order.");
  }
  return Array.isArray(result?.items) ? result.items : payload.items;
}

export function getOrderLineItemSelectAllState(
  selectedIds: ReadonlySet<string>,
  selectableIds: readonly string[],
): OrderLineItemSelectionState {
  if (selectableIds.length === 0) return false;
  const selectedCount = selectableIds.reduce(
    (count, id) => count + (selectedIds.has(id) ? 1 : 0),
    0,
  );
  if (selectedCount === 0) return false;
  if (selectedCount === selectableIds.length) return true;
  return "indeterminate";
}

export function toggleAllOrderLineItemSelections(
  selectedIds: ReadonlySet<string>,
  selectableIds: readonly string[],
): Set<string> {
  const allSelected = getOrderLineItemSelectAllState(selectedIds, selectableIds) === true;
  if (allSelected) {
    const next = new Set(selectedIds);
    selectableIds.forEach((id) => next.delete(id));
    return next;
  }
  return new Set([...Array.from(selectedIds), ...selectableIds]);
}

export function getSelectableProductionLineItemIds(
  lineItems: ReadonlyArray<{
    id: string;
    productId: string;
    status?: string | null;
    activeOwnerJobId?: string | null;
    activeOwnerStationKey?: string | null;
    activeOwnerStepKey?: string | null;
  }>,
  products: ReadonlyArray<{
    id: string;
    requiresProductionJob?: boolean | null;
    workflowIntent?: string | null;
  }>,
): string[] {
  const productsById = new Map(products.map((product) => [String(product.id), product]));
  return lineItems
    .filter((lineItem) => {
      if (lineItem.status === "canceled") return false;
      if (lineItem.activeOwnerJobId || lineItem.activeOwnerStationKey || lineItem.activeOwnerStepKey) return false;
      const product = productsById.get(String(lineItem.productId));
      return product?.requiresProductionJob === true && product.workflowIntent !== "service_fee";
    })
    .map((lineItem) => String(lineItem.id));
}

export type OrderLineItemOperationalDisplay = {
  statusLabel: string;
  nextStepLabel: string;
  ownerLabel: string | null;
  isProductionOwned: boolean;
};

const PREPRODUCTION_OWNER_KEYS = new Set(["design", "proof", "proofing", "prepress"]);

function normalizedOwnerKey(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

export function isLineItemOwnedByProduction(input: {
  activeOwnerJobId?: string | null;
  activeOwnerStationKey?: string | null;
  activeOwnerStepKey?: string | null;
}): boolean {
  if (!input.activeOwnerJobId && !input.activeOwnerStationKey && !input.activeOwnerStepKey) return false;
  const station = normalizedOwnerKey(input.activeOwnerStationKey);
  const step = normalizedOwnerKey(input.activeOwnerStepKey);
  return !PREPRODUCTION_OWNER_KEYS.has(station) && !PREPRODUCTION_OWNER_KEYS.has(step);
}

export function resolveOrderLineItemOperationalDisplay(input: {
  workflowState?: string | null;
  activeOwnerJobId?: string | null;
  activeOwnerStationKey?: string | null;
  activeOwnerStepKey?: string | null;
  activeOwnerStatus?: string | null;
}): OrderLineItemOperationalDisplay {
  const isProductionOwned = isLineItemOwnedByProduction(input);
  const ownerKey = normalizedOwnerKey(input.activeOwnerStationKey || input.activeOwnerStepKey);
  const ownerLabel = ownerKey ? ownerKey.replace(/_/g, " ").replace(/\b\w/g, (value) => value.toUpperCase()) : null;
  const ownerStatus = normalizedOwnerKey(input.activeOwnerStatus);

  if (isProductionOwned) {
    if (ownerStatus === "paused") {
      return { statusLabel: "Production on hold", nextStepLabel: "Resume production", ownerLabel, isProductionOwned };
    }
    if (ownerStatus === "queued") {
      return {
        statusLabel: ownerLabel ? `Scheduled for ${ownerLabel}` : "Scheduled for production",
        nextStepLabel: "Start production",
        ownerLabel,
        isProductionOwned,
      };
    }
    return {
      statusLabel: "In Production",
      nextStepLabel: ownerLabel ? `${ownerLabel} in progress` : "Production in progress",
      ownerLabel,
      isProductionOwned,
    };
  }

  const workflowState = normalizedOwnerKey(input.workflowState) || "new";
  const labels: Record<string, [string, string]> = {
    new: ["New", "Review routing"],
    needs_design: ["Needs Design", "Start design"],
    in_design: ["In Design", "Finish design"],
    ready_for_prepress: ["Ready for Prepress", "Start prepress"],
    in_prepress: ["In Prepress", "Finish prepress"],
    ready_for_production: ["Ready for Production", "Send to production"],
    in_production: ["In Production", "Production in progress"],
    completed: ["Completed", "None"],
    on_hold: ["On Hold", "Review hold"],
    canceled: ["Canceled", "None"],
  };
  const [statusLabel, nextStepLabel] = labels[workflowState] ?? [workflowState, "Review item"];
  return { statusLabel, nextStepLabel, ownerLabel, isProductionOwned };
}

export type OrderLineItemProductionAction = "start" | "resume" | "hold" | "complete" | "return_to_prepress";

export type OrderLineItemProductionActionRequest = {
  url: string;
  method: "POST" | "PATCH";
  body?: Record<string, unknown>;
};

export function buildOrderLineItemProductionActionRequests(input: {
  action: OrderLineItemProductionAction;
  lineItemId: string;
  jobId: string;
}): OrderLineItemProductionActionRequest[] {
  if (input.action === "hold") {
    return [
      { url: `/api/production/jobs/${input.jobId}/stop`, method: "POST" },
      { url: `/api/production/jobs/${input.jobId}/status`, method: "PATCH", body: { status: "paused" } },
    ];
  }
  if (input.action === "resume") {
    return [
      { url: `/api/production/jobs/${input.jobId}/status`, method: "PATCH", body: { status: "in_progress" } },
      { url: `/api/production/jobs/${input.jobId}/start`, method: "POST" },
    ];
  }
  if (input.action === "return_to_prepress") {
    return [{
      url: `/api/production/line-item/${input.lineItemId}/send-to-prepress`,
      method: "POST",
      body: { note: "Returned to prepress from the order line item.", noPrintsCompletedYet: false },
    }];
  }
  if (input.action === "complete") {
    return [{ url: `/api/production/jobs/${input.jobId}/complete`, method: "POST" }];
  }
  return [{ url: `/api/production/jobs/${input.jobId}/start`, method: "POST" }];
}

export function getOrderLineItemProductionActions(input: {
  activeOwnerJobId?: string | null;
  activeOwnerStationKey?: string | null;
  activeOwnerStepKey?: string | null;
  activeOwnerStatus?: string | null;
}): OrderLineItemProductionAction[] {
  if (!isLineItemOwnedByProduction(input) || !input.activeOwnerJobId) return [];
  const status = normalizedOwnerKey(input.activeOwnerStatus) || "queued";
  if (status === "done" || status === "void" || status === "canceled" || status === "cancelled") return [];
  if (status === "paused") return ["resume", "return_to_prepress"];
  if (status === "queued") return ["start", "hold", "return_to_prepress"];
  return ["hold", "complete", "return_to_prepress"];
}

const PRODUCTION_WARNING_STATES = new Set([
  "ready_for_prepress",
  "in_prepress",
  "ready_for_production",
  "in_production",
  "awaiting_proof_approval",
  "in_design",
  "on_hold",
]);

/** The generic `in_production` state also represents active pick/pack work. */
export function getOrderLineItemActiveWorkWarning(input: {
  fulfillmentOnly: boolean;
  serviceFee?: boolean;
  workflowState: string;
  hasActiveOwner: boolean;
}): OrderLineItemActiveWorkWarning {
  const workflowState = String(input.workflowState || "new").trim().toLowerCase();

  if (input.serviceFee) return null;

  if (input.fulfillmentOnly) {
    if (!input.hasActiveOwner && workflowState !== "in_production") return null;
    return {
      title: "Active fulfillment work",
      description: "This line item is being picked or packed. Changes may require fulfillment staff review.",
    };
  }

  if (!input.hasActiveOwner && !PRODUCTION_WARNING_STATES.has(workflowState)) return null;
  return {
    title: "Active work warning",
    description: "This line item is already in production/prepress. Changes may require rework, updated files, or operator review.",
  };
}

export function getOrderLineItemEditorUiPolicy(input: {
  fulfillmentOnly: boolean;
  internalNoteCount: number;
  requiresDesign: boolean;
  requiresPrepress: boolean | null;
  requiresProofApproval: boolean;
}) {
  const routingOverrideEnabled =
    input.requiresDesign || input.requiresPrepress === true || input.requiresProofApproval;

  return {
    operationsNotesLabel: input.fulfillmentOnly ? "Fulfillment Notes (internal)" : "Production Notes (internal)",
    operationsNotesPlaceholder: input.fulfillmentOnly
      ? "Internal pick, pack, or fulfillment instructions (not shown to customers)..."
      : "Internal production notes (not shown to customers)...",
    hideRoutingByDefault: input.fulfillmentOnly && !routingOverrideEnabled,
    // Notes remain a compact disclosure even when records exist; the caller shows a count.
    internalNotesInitiallyOpen: false,
  };
}

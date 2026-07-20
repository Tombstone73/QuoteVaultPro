export type OrderLineItemActiveWorkWarning = {
  title: string;
  description: string;
} | null;

export type OrderLineItemSelectionState = false | true | "indeterminate";

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
  lineItems: ReadonlyArray<{ id: string; productId: string; status?: string | null }>,
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
      const product = productsById.get(String(lineItem.productId));
      return product?.requiresProductionJob === true && product.workflowIntent !== "service_fee";
    })
    .map((lineItem) => String(lineItem.id));
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

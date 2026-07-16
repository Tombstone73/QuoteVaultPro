export type OrderLineItemActiveWorkWarning = {
  title: string;
  description: string;
} | null;

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

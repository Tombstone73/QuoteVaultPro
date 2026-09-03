/**
 * Commercial corrections intentionally have a narrower lifecycle policy than
 * operational editing. Completing production or an Order does not erase the
 * need to correct its authoritative commercial facts; cancellation and void
 * states do, because they require their dedicated recovery workflows.
 */
const COMMERCIAL_EDIT_BLOCKING_STATES = new Set([
  "void",
  "voided",
  "canceled",
  "cancelled",
]);

function normalized(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function isOrderCommerciallyEditable(order: {
  state?: string | null;
  status?: string | null;
  canceledAt?: string | Date | null;
} | null | undefined): boolean {
  if (!order) return false;
  return !(
    COMMERCIAL_EDIT_BLOCKING_STATES.has(normalized(order.state)) ||
    COMMERCIAL_EDIT_BLOCKING_STATES.has(normalized(order.status)) ||
    Boolean(order.canceledAt)
  );
}

export function isLineItemCommerciallyEditable(lineItem: {
  status?: string | null;
  workflowState?: string | null;
} | null | undefined): boolean {
  if (!lineItem) return false;
  return !(
    COMMERCIAL_EDIT_BLOCKING_STATES.has(normalized(lineItem.status)) ||
    COMMERCIAL_EDIT_BLOCKING_STATES.has(normalized(lineItem.workflowState))
  );
}

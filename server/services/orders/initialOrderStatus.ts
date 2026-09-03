export const CANONICAL_NEW_ORDER_STATUS = "new" as const;
export const CANONICAL_NEW_ORDER_STATUS_PILL_KEY = "new" as const;
export const CANONICAL_NEW_ORDER_STATUS_PILL_LABEL = "New" as const;

type NewStatusPillCandidate = {
  id: string;
  key: string;
  name: string;
  isActive: boolean;
} | null | undefined;

/**
 * Canonical persistence projection for a newly created native Order.
 *
 * The legacy lifecycle status and the operator-facing status pill are separate
 * columns, but both start at the same stable `new` identity. Other domains
 * (payment, production, proof, and fulfillment) retain their own defaults.
 * An explicitly supplied non-new lifecycle status is preserved for specialized
 * callers; normal direct, Quote-conversion, Inbound, duplicate, and assistant
 * creation paths all request or default to `new`.
 */
export function buildInitialOrderStatusFields(input: {
  requestedStatus?: string | null;
  canonicalNewPill?: NewStatusPillCandidate;
  actorUserId: string;
  assignedAt?: Date;
}) {
  const requestedStatus = input.requestedStatus?.trim();
  const status = requestedStatus || CANONICAL_NEW_ORDER_STATUS;
  if (status !== CANONICAL_NEW_ORDER_STATUS) return { status };

  const canonicalNewPill = input.canonicalNewPill?.key === CANONICAL_NEW_ORDER_STATUS_PILL_KEY
    && input.canonicalNewPill.isActive
    ? input.canonicalNewPill
    : null;

  return {
    status: CANONICAL_NEW_ORDER_STATUS,
    statusPillId: canonicalNewPill?.id ?? null,
    statusPillValue: canonicalNewPill?.name || CANONICAL_NEW_ORDER_STATUS_PILL_LABEL,
    statusPillAssignedByUserId: input.actorUserId,
    statusPillAssignedAt: input.assignedAt ?? new Date(),
    statusPillReason: "Initial order status",
  };
}

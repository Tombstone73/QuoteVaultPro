type TargetDiagnostic = {
  found: boolean;
  requestedOrderNumber: string;
  reason?: string;
  order?: { id: string; orderNumber: string };
  activeFulfillment?: boolean;
};

type LegacyCandidate = { order: { id: string } };
type TargetSummary = {
  requestedOrderNumber: string;
  found: false;
  candidate: false;
  reason: string;
} | {
  requestedOrderNumber: string;
  found: true;
  orderId: string;
  publicOrderNumber: string;
  activeFulfillment: boolean;
  candidate: boolean;
  reason: string;
};

/** Formats the explicit target-order result without changing any audit data.
 * A target lookup is an inspection aid, not an anomaly predicate. */
export function buildFulfillmentIntegrityTargetSummary(input: {
  requestedOrderNumber: string;
  diagnostic: TargetDiagnostic | null;
  audit: { legacyCloseJobOverrideCandidates: LegacyCandidate[] };
}): TargetSummary {
  const requestedOrderNumber = String(input.requestedOrderNumber ?? "").trim();
  if (!input.diagnostic) {
    return {
      requestedOrderNumber,
      found: false,
      candidate: false,
      reason: "TARGET_NOT_REQUESTED",
    };
  }
  if (!input.diagnostic.found || !input.diagnostic.order) {
    return {
      requestedOrderNumber: input.diagnostic.requestedOrderNumber || requestedOrderNumber,
      found: false,
      candidate: false,
      reason: input.diagnostic.reason ?? "ORDER_NOT_FOUND_IN_SCOPE",
    };
  }
  const candidate = input.audit.legacyCloseJobOverrideCandidates
    .some((item) => item.order.id === input.diagnostic!.order!.id);
  return {
    requestedOrderNumber: input.diagnostic.requestedOrderNumber,
    found: true,
    orderId: input.diagnostic.order.id,
    publicOrderNumber: input.diagnostic.order.orderNumber,
    activeFulfillment: input.diagnostic.activeFulfillment === true,
    candidate,
    reason: candidate
      ? "PROVEN_LEGACY_CLOSE_JOB_OVERRIDE_CANDIDATE"
      : "Order was found in scope but does not meet the proven legacy Close Job Override candidate predicate.",
  };
}

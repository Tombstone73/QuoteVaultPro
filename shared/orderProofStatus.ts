export const lineItemProofStatusValues = [
  "not_required",
  "proof_needed",
  "draft_not_sent",
  "sent_awaiting_approval",
  "approved",
  "rejected_or_changes_requested",
] as const;

export const orderProofStatusValues = [
  "no_proof_required",
  "proof_needed",
  "draft_not_sent",
  "awaiting_customer_approval",
  "approved",
  "proof_issue",
] as const;

export type LineItemProofStatus = (typeof lineItemProofStatusValues)[number];
export type OrderProofStatus = (typeof orderProofStatusValues)[number];
export type ProofVersionStatus = "draft" | "awaiting_response" | "approved" | "rejected" | "revision_requested" | "cancelled" | "superseded" | null;
export type ProofDecision = "approved" | "rejected" | "revision_requested" | null;

export type LineItemProofSummary = {
  lineItemId: string;
  status: LineItemProofStatus;
  label: string;
  proofActionRequired: boolean;
  openProofingAvailable: boolean;
};

export type OrderProofCounts = {
  required: number;
  needed: number;
  draftNotSent: number;
  awaitingApproval: number;
  approved: number;
  issue: number;
};

export type OrderProofSummary = {
  proofStatus: OrderProofStatus;
  proofStatusLabel: string;
  proofActionRequired: boolean;
  openProofingAvailable: boolean;
  proofLineItemId: string | null;
  proofCounts: OrderProofCounts;
};

export type LineItemProofDerivationInput = {
  lineItemId: string;
  requiresProofApproval: boolean;
  approvedProofVersionId?: string | null;
  currentActionableProofVersionStatus?: ProofVersionStatus;
  latestProofVersionStatus?: ProofVersionStatus;
  latestDecision?: ProofDecision;
  hasAnyProofVersion?: boolean;
  hasSentProofVersion?: boolean;
  approvedNormally?: boolean;
  approvedByOverride?: boolean;
};

const lineItemProofStatusLabels: Record<LineItemProofStatus, string> = {
  not_required: "Not Required",
  proof_needed: "Proof Needed",
  draft_not_sent: "Draft Not Sent",
  sent_awaiting_approval: "Sent / Awaiting Approval",
  approved: "Approved",
  rejected_or_changes_requested: "Changes Requested",
};

const orderProofStatusLabels: Record<OrderProofStatus, string> = {
  no_proof_required: "No Proof Needed",
  proof_needed: "Proof Needed",
  draft_not_sent: "Draft Not Sent",
  awaiting_customer_approval: "Awaiting Approval",
  approved: "Proof Approved",
  proof_issue: "Proof Issue",
};

const orderProofPriority: Record<OrderProofStatus, number> = {
  proof_issue: 0,
  proof_needed: 1,
  draft_not_sent: 2,
  awaiting_customer_approval: 3,
  approved: 4,
  no_proof_required: 5,
};

const lineItemPriorityToOrderStatus: Record<Exclude<LineItemProofStatus, "not_required">, OrderProofStatus> = {
  rejected_or_changes_requested: "proof_issue",
  proof_needed: "proof_needed",
  draft_not_sent: "draft_not_sent",
  sent_awaiting_approval: "awaiting_customer_approval",
  approved: "approved",
};

function normalizeId(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

export function getLineItemProofStatusLabel(status: LineItemProofStatus) {
  return lineItemProofStatusLabels[status];
}

export function getOrderProofStatusLabel(status: OrderProofStatus) {
  return orderProofStatusLabels[status];
}

export function isOrderProofActionRequired(status: OrderProofStatus) {
  return status === "proof_needed" || status === "draft_not_sent" || status === "proof_issue";
}

export function canOpenProofingFromOrderStatus(status: OrderProofStatus) {
  return status === "proof_needed" || status === "draft_not_sent" || status === "awaiting_customer_approval" || status === "proof_issue";
}

export function canOpenProofingFromLineItemStatus(status: LineItemProofStatus) {
  return status === "proof_needed" || status === "draft_not_sent" || status === "sent_awaiting_approval" || status === "rejected_or_changes_requested";
}

export function deriveLineItemProofSummary(input: LineItemProofDerivationInput): LineItemProofSummary {
  const approvedProofVersionId = normalizeId(input.approvedProofVersionId);
  const currentActionable = input.currentActionableProofVersionStatus ?? null;
  const latestVersion = input.latestProofVersionStatus ?? null;
  const latestDecision = input.latestDecision ?? null;
  const hasAnyProofVersion = Boolean(input.hasAnyProofVersion);
  const hasSentProofVersion = Boolean(input.hasSentProofVersion);
  const approvedNormally = Boolean(input.approvedNormally);
  const approvedByOverride = Boolean(input.approvedByOverride);

  let status: LineItemProofStatus;

  if (!input.requiresProofApproval) {
    status = "not_required";
  } else if (approvedProofVersionId || approvedNormally || approvedByOverride || latestDecision === "approved" || latestVersion === "approved") {
    status = "approved";
  } else if (currentActionable === "draft" || latestVersion === "draft") {
    status = "draft_not_sent";
  } else if (latestDecision === "rejected" || latestDecision === "revision_requested" || latestVersion === "rejected" || latestVersion === "revision_requested") {
    status = "rejected_or_changes_requested";
  } else if (currentActionable === "awaiting_response" || latestVersion === "awaiting_response" || hasSentProofVersion) {
    status = "sent_awaiting_approval";
  } else if (!hasAnyProofVersion) {
    status = "proof_needed";
  } else {
    status = "proof_needed";
  }

  return {
    lineItemId: input.lineItemId,
    status,
    label: getLineItemProofStatusLabel(status),
    proofActionRequired: status === "proof_needed" || status === "draft_not_sent" || status === "rejected_or_changes_requested",
    openProofingAvailable: canOpenProofingFromLineItemStatus(status),
  };
}

export function deriveOrderProofSummary(lineItems: LineItemProofSummary[]): OrderProofSummary {
  const requiredItems = lineItems.filter((lineItem) => lineItem.status !== "not_required");
  const counts: OrderProofCounts = {
    required: requiredItems.length,
    needed: requiredItems.filter((lineItem) => lineItem.status === "proof_needed").length,
    draftNotSent: requiredItems.filter((lineItem) => lineItem.status === "draft_not_sent").length,
    awaitingApproval: requiredItems.filter((lineItem) => lineItem.status === "sent_awaiting_approval").length,
    approved: requiredItems.filter((lineItem) => lineItem.status === "approved").length,
    issue: requiredItems.filter((lineItem) => lineItem.status === "rejected_or_changes_requested").length,
  };

  let proofStatus: OrderProofStatus;
  if (counts.required === 0) {
    proofStatus = "no_proof_required";
  } else if (counts.issue > 0) {
    proofStatus = "proof_issue";
  } else if (counts.needed > 0) {
    proofStatus = "proof_needed";
  } else if (counts.draftNotSent > 0) {
    proofStatus = "draft_not_sent";
  } else if (counts.awaitingApproval > 0) {
    proofStatus = "awaiting_customer_approval";
  } else if (counts.approved === counts.required) {
    proofStatus = "approved";
  } else {
    proofStatus = "proof_issue";
  }

  const rankedItems = requiredItems
    .filter((lineItem) => lineItem.openProofingAvailable)
    .sort((left, right) => {
      const leftOrderStatus = lineItemPriorityToOrderStatus[left.status as Exclude<LineItemProofStatus, "not_required">];
      const rightOrderStatus = lineItemPriorityToOrderStatus[right.status as Exclude<LineItemProofStatus, "not_required">];
      const priorityDiff = orderProofPriority[leftOrderStatus] - orderProofPriority[rightOrderStatus];
      if (priorityDiff !== 0) return priorityDiff;
      return left.lineItemId.localeCompare(right.lineItemId, undefined, { sensitivity: "base" });
    });

  return {
    proofStatus,
    proofStatusLabel: getOrderProofStatusLabel(proofStatus),
    proofActionRequired: isOrderProofActionRequired(proofStatus),
    openProofingAvailable: canOpenProofingFromOrderStatus(proofStatus),
    proofLineItemId: rankedItems[0]?.lineItemId ?? null,
    proofCounts: counts,
  };
}

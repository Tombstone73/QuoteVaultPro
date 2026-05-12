import { ROUTES } from "../config/routes";
import type { ProofingQueueRow } from "@shared/proofing";

export const PROOF_APPROVAL_REQUIRED_ROUTING_REASON = "proof_approval_required_before_scheduling";

type QueueRowLike = Pick<ProofingQueueRow, "lineItemId">;

function normalizeId(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

export function buildProofingLineItemPath(lineItemId: string, options?: { slice?: string | null }) {
  const normalizedLineItemId = normalizeId(lineItemId);
  if (!normalizedLineItemId) {
    return ROUTES.production.proofing;
  }

  const params = new URLSearchParams({
    lineItemId: normalizedLineItemId,
  });

  const slice = normalizeId(options?.slice) ?? "all";
  params.set("slice", slice);

  return `${ROUTES.production.proofing}?${params.toString()}`;
}

export function hasApprovedProofVersion(approvedProofVersionId?: string | null) {
  return Boolean(normalizeId(approvedProofVersionId));
}

export function shouldOfferProofingNavigation(args: {
  lineItemId?: string | null;
  requiresProofApproval?: boolean | null;
  approvedProofVersionId?: string | null;
}) {
  return Boolean(
    normalizeId(args.lineItemId) &&
      args.requiresProofApproval &&
      !hasApprovedProofVersion(args.approvedProofVersionId),
  );
}

export function isProofApprovalRoutingBlocked(routingReason?: string | null) {
  return normalizeId(routingReason) === PROOF_APPROVAL_REQUIRED_ROUTING_REASON;
}

export function findProofingQueueRowByLineItemId<T extends QueueRowLike>(rows: T[], lineItemId?: string | null) {
  const normalizedLineItemId = normalizeId(lineItemId);
  if (!normalizedLineItemId) return null;
  return rows.find((row) => normalizeId(row.lineItemId) === normalizedLineItemId) ?? null;
}

export function resolveProofingActiveRow<T extends QueueRowLike>(args: {
  requestedLineItemId?: string | null;
  selectedLineItemId?: string | null;
  filteredQueueRows: T[];
  allQueueRows: T[];
}) {
  const requestedLineItemId = normalizeId(args.requestedLineItemId);
  if (requestedLineItemId) {
    return {
      activeLineItemId: requestedLineItemId,
      activeRow: findProofingQueueRowByLineItemId(args.allQueueRows, requestedLineItemId),
    };
  }

  const selectedRow = findProofingQueueRowByLineItemId(args.filteredQueueRows, args.selectedLineItemId);
  const fallbackRow = args.filteredQueueRows[0] ?? null;

  return {
    activeLineItemId: normalizeId(selectedRow?.lineItemId ?? fallbackRow?.lineItemId),
    activeRow: selectedRow ?? fallbackRow,
  };
}

export function isRequestedProofingLineItemMissing(args: {
  requestedLineItemId?: string | null;
  errorStatus?: number | null;
}) {
  return Boolean(normalizeId(args.requestedLineItemId) && args.errorStatus === 404);
}

export const PROOFING_MISSING_LINE_ITEM_MESSAGE =
  "This line item was not found in proofing. It may not require proofing, may already be approved, or may no longer exist.";
export type CombinedProofSelectableLine = {
  lineItemId: string;
  orderId: string;
};

export function isCombinedProofLineSelectable(row: {
  requiresProofApproval: boolean;
  currentQueueStatus: string;
}) {
  return row.requiresProofApproval
    && row.currentQueueStatus !== "awaiting_approval"
    && row.currentQueueStatus !== "approved"
    && row.currentQueueStatus !== "approved_by_override";
}

export function isProofingSelectionSelectable(row: {
  requiresProofApproval: boolean;
  currentQueueStatus: string;
}) {
  return row.requiresProofApproval
    && row.currentQueueStatus !== "approved"
    && row.currentQueueStatus !== "approved_by_override";
}

export function selectAllCombinedProofLinesForOrder(args: {
  selectedIds: string[];
  anchorRow: CombinedProofSelectableLine;
  candidateRows: CombinedProofSelectableLine[];
}): string[] {
  const matchingIds = args.candidateRows
    .filter((row) => row.orderId === args.anchorRow.orderId)
    .map((row) => row.lineItemId);
  return Array.from(new Set([
    ...args.selectedIds.filter((id) => matchingIds.includes(id)),
    ...matchingIds,
  ]));
}

export function getCombinedProofJobLabel(rows: Array<CombinedProofSelectableLine & { orderNumber?: string | null }>) {
  if (rows.length === 0) return null;
  return rows[0].orderNumber ? `#${rows[0].orderNumber}` : rows[0].orderId;
}

export function updateCombinedProofSelection(args: {
  selectedIds: string[];
  selectedRows: CombinedProofSelectableLine[];
  row: CombinedProofSelectableLine;
  checked: boolean;
}): { selectedIds: string[]; error: string | null } {
  if (!args.checked) {
    return { selectedIds: args.selectedIds.filter((id) => id !== args.row.lineItemId), error: null };
  }
  const selectedOrderId = args.selectedRows[0]?.orderId ?? null;
  if (selectedOrderId && selectedOrderId !== args.row.orderId) {
    return { selectedIds: args.selectedIds, error: "A combined customer proof cannot span multiple orders." };
  }
  return { selectedIds: Array.from(new Set([...args.selectedIds, args.row.lineItemId])), error: null };
}

export function combinedProofReviewIsReady(args: {
  selectedCount: number;
  reviewRows: Array<{ eligibleCount: number }>;
  loading: boolean;
}) {
  return args.selectedCount >= 2
    && !args.loading
    && args.reviewRows.length === args.selectedCount
    && args.reviewRows.every((row) => row.eligibleCount > 0);
}

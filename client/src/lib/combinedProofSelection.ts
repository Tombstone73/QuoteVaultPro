export type CombinedProofSelectableLine = {
  lineItemId: string;
  orderId: string;
};

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

import type { ProofingQueueRow } from "@shared/proofing";

export const proofingFilterValues = ["awaiting_proof", "sent", "approved", "rejected"] as const;
export const proofingSortValues = ["newest", "oldest", "customer"] as const;

export type ProofingFilterValue = (typeof proofingFilterValues)[number];
export type ProofingSortValue = (typeof proofingSortValues)[number];

export function getInitialProofingFilter(requestedSlice?: string | null): ProofingFilterValue {
  switch (String(requestedSlice ?? "").trim()) {
    case "awaiting_approval":
      return "sent";
    case "approved":
      return "approved";
    case "awaiting_send":
    case "revision_requested":
    case "all":
    default:
      return "awaiting_proof";
  }
}

export function matchesProofingSearch(row: ProofingQueueRow, rawQuery: string) {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;

  return [row.orderNumber, row.customerDisplayName, row.lineItemLabel, row.packageLabel, row.jobLabel, row.poNumber]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
}

export function matchesProofingFilter(row: ProofingQueueRow, filter: ProofingFilterValue) {
  switch (filter) {
    case "awaiting_proof":
      return (
        row.currentQueueStatus === "awaiting_send" ||
        row.currentQueueStatus === "revision_requested" ||
        row.currentQueueStatus === "no_active_proof"
      );
    case "sent":
      return row.currentQueueStatus === "awaiting_approval";
    case "approved":
      return row.currentQueueStatus === "approved" || row.currentQueueStatus === "approved_by_override";
    case "rejected":
      return row.currentQueueStatus === "rejected";
    default:
      return true;
  }
}

export function sortProofingQueueRows(rows: ProofingQueueRow[], sort: ProofingSortValue) {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      if (sort === "customer") {
        const customerDiff = String(left.row.customerDisplayName ?? "")
          .localeCompare(String(right.row.customerDisplayName ?? ""), undefined, { sensitivity: "base" });
        if (customerDiff !== 0) return customerDiff;
      }

      const leftTs = new Date(left.row.lastActivityAt).getTime();
      const rightTs = new Date(right.row.lastActivityAt).getTime();
      const safeLeftTs = Number.isFinite(leftTs) ? leftTs : 0;
      const safeRightTs = Number.isFinite(rightTs) ? rightTs : 0;

      if (sort === "oldest") {
        if (safeLeftTs !== safeRightTs) return safeLeftTs - safeRightTs;
      } else if (sort === "newest") {
        if (safeLeftTs !== safeRightTs) return safeRightTs - safeLeftTs;
      } else {
        if (safeLeftTs !== safeRightTs) return safeRightTs - safeLeftTs;
      }

      const orderDiff = String(left.row.orderNumber ?? left.row.orderId).localeCompare(
        String(right.row.orderNumber ?? right.row.orderId),
        undefined,
        { numeric: true, sensitivity: "base" },
      );
      if (orderDiff !== 0) return orderDiff;

      const labelDiff = left.row.lineItemLabel.localeCompare(right.row.lineItemLabel, undefined, { sensitivity: "base" });
      if (labelDiff !== 0) return labelDiff;

      return left.index - right.index;
    })
    .map((entry) => entry.row);
}

export function getProofingFilterCount(rows: ProofingQueueRow[], filter: ProofingFilterValue) {
  return rows.filter((row) => matchesProofingFilter(row, filter)).length;
}

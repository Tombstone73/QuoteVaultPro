import type { LineItemProofStatus, OrderProofStatus } from "@shared/orderProofStatus";

export function getOrderProofBadgeClass(status: OrderProofStatus | null | undefined) {
  switch (status) {
    case "proof_issue":
      return "border-red-300 bg-red-100 text-red-950";
    case "proof_needed":
      return "border-amber-300 bg-amber-100 text-amber-950";
    case "draft_not_sent":
      return "border-orange-300 bg-orange-100 text-orange-950";
    case "awaiting_customer_approval":
      return "border-sky-300 bg-sky-100 text-sky-900";
    case "approved":
      return "border-emerald-300 bg-emerald-100 text-emerald-900";
    default:
      return "border-slate-300 bg-slate-100 text-slate-700";
  }
}

export function getLineItemProofBadgeClass(status: LineItemProofStatus | null | undefined) {
  switch (status) {
    case "rejected_or_changes_requested":
      return "border-red-300 bg-red-100 text-red-900";
    case "proof_needed":
      return "border-amber-300 bg-amber-100 text-amber-900";
    case "draft_not_sent":
      return "border-orange-300 bg-orange-100 text-orange-900";
    case "sent_awaiting_approval":
      return "border-sky-300 bg-sky-100 text-sky-900";
    case "approved":
      return "border-emerald-300 bg-emerald-100 text-emerald-900";
    default:
      return "border-slate-300 bg-slate-100 text-slate-700";
  }
}
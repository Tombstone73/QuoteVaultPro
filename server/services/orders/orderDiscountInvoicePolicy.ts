/** A saved discount must commit with the one native Invoice or not commit at all. */
export function orderDiscountInvoiceBlocker(input: {
  liveInvoiceCount: number;
  invoice?: { importSource?: string | null; importedAt?: Date | string | null; isHistorical?: boolean | null; historicalArState?: string | null; status?: string | null; amountPaid?: string | number | null } | null;
  hasAppliedPayment?: boolean;
  hasCreditHistory?: boolean;
  hasRefundHistory?: boolean;
  lineSnapshotsChanged?: boolean;
}): string | null {
  if (input.liveInvoiceCount !== 1) return input.liveInvoiceCount === 0
    ? "This Order has no single live native Invoice to synchronize. Review billing before changing its discount."
    : "This Order has multiple live Invoices. Review billing before changing its discount.";
  if (input.invoice?.importSource || input.invoice?.importedAt || input.invoice?.isHistorical || input.invoice?.historicalArState) {
    return "This Invoice is imported or historical and cannot be rewritten by an Order discount edit.";
  }
  if (["paid", "partially_paid"].includes(String(input.invoice?.status ?? "").toLowerCase())) {
    return "This Invoice has a paid checkpoint. Use a reviewed adjustment rather than rewriting its total.";
  }
  if (Number(input.invoice?.amountPaid ?? 0) > 0) {
    return "This Invoice has payment history. Use a reviewed adjustment rather than rewriting its total.";
  }
  if (["void", "voided", "canceled", "cancelled"].includes(String(input.invoice?.status ?? "").toLowerCase())) {
    return "This Invoice is no longer editable. Review billing before changing the Order discount.";
  }
  if (input.hasAppliedPayment) return "This Invoice has payment history. Use a reviewed adjustment rather than rewriting its total.";
  if (input.hasCreditHistory) return "This Invoice has credit history. Review the credit before changing its total.";
  if (input.hasRefundHistory) return "This Invoice has refund history. Review the refund before changing its total.";
  if (input.lineSnapshotsChanged) return "Invoice line items differ from this Order. Reconcile billing before changing its discount.";
  return null;
}

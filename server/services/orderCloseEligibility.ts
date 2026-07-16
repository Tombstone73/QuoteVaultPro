export type OrderCloseLine = {
  workflowIntent?: string | null;
  status?: string | null;
};

export type OrderCloseEligibility =
  | { ok: true; requiresUnpaidConfirmation: boolean; serviceFeeOnly: boolean }
  | { ok: false; code: "INVOICE_REQUIRED" | "PRODUCTION_COMPLETION_REQUIRED"; message: string };

/**
 * Closing an open order is intentionally limited to invoice-backed billing-only
 * work. All other orders retain the normal production_complete -> closed gate.
 */
export function assessOrderCloseEligibility(input: {
  state: string | null | undefined;
  lineItems: OrderCloseLine[];
  invoiceCount: number;
  unpaidInvoiceCount: number;
}): OrderCloseEligibility {
  if (input.state === "production_complete") {
    return { ok: true, requiresUnpaidConfirmation: input.unpaidInvoiceCount > 0, serviceFeeOnly: false };
  }

  const activeLines = input.lineItems.filter((line) => String(line.status ?? "").toLowerCase() !== "canceled");
  const serviceFeeOnly = activeLines.length > 0 && activeLines.every((line) => line.workflowIntent === "service_fee");

  if (!serviceFeeOnly) {
    return {
      ok: false,
      code: "PRODUCTION_COMPLETION_REQUIRED",
      message: "Complete production before closing this order.",
    };
  }

  if (input.invoiceCount === 0) {
    return {
      ok: false,
      code: "INVOICE_REQUIRED",
      message: "Create an invoice before closing a billing-only order.",
    };
  }

  return { ok: true, requiresUnpaidConfirmation: input.unpaidInvoiceCount > 0, serviceFeeOnly: true };
}

export type OrderCloseLine = {
  workflowIntent?: string | null;
  status?: string | null;
};

export type OrderCloseEligibility =
  | { ok: true; requiresUnpaidConfirmation: boolean; serviceFeeOnly: boolean }
  | { ok: false; code: "INVOICE_REQUIRED" | "PRODUCTION_COMPLETION_REQUIRED" | "OPERATIONAL_COMPLETION_REQUIRED"; message: string };

/** Closing is terminal. Operational completion always happens first, and an
 * invoice must exist. Unpaid invoices require the route's explicit override.
 */
export function assessOrderCloseEligibility(input: {
  state: string | null | undefined;
  routingTarget?: string | null;
  lineItems: OrderCloseLine[];
  invoiceCount: number;
  unpaidInvoiceCount: number;
}): OrderCloseEligibility {
  const activeLines = input.lineItems.filter((line) => String(line.status ?? "").toLowerCase() !== "canceled");
  const serviceFeeOnly = activeLines.length > 0 && activeLines.every((line) => line.workflowIntent === "service_fee");

  if (input.state !== "production_complete") {
    return {
      ok: false,
      code: "PRODUCTION_COMPLETION_REQUIRED",
      message: "Complete the order operationally before closing it.",
    };
  }

  if (input.routingTarget === "fulfillment") {
    return {
      ok: false,
      code: "OPERATIONAL_COMPLETION_REQUIRED",
      message: "Complete fulfillment and mark the order complete before closing it.",
    };
  }

  if (input.invoiceCount === 0) {
    return {
      ok: false,
      code: "INVOICE_REQUIRED",
      message: "Create an invoice before closing this order.",
    };
  }

  return { ok: true, requiresUnpaidConfirmation: input.unpaidInvoiceCount > 0, serviceFeeOnly };
}

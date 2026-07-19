export type OrderCompletionLine = {
  workflowIntent?: string | null;
  status?: string | null;
};

export type OrderCompletionInvoice = {
  status?: string | null;
  balanceDue?: string | number | null;
};

export type OrderOperationalCompletionAssessment =
  | {
      ok: true;
      serviceFeeOnly: boolean;
      activeInvoiceCount: number;
      needsInvoicing: boolean;
      allInvoicesPaid: boolean;
    }
  | {
      ok: false;
      code: "TERMINAL_STATE" | "NO_ACTIVE_LINES" | "PRODUCTION_COMPLETION_REQUIRED" | "FULFILLMENT_COMPLETION_REQUIRED";
      message: string;
    };

export function assessOrderOperationalCompletion(input: {
  state?: string | null;
  fulfillmentStatus?: string | null;
  lineItems: OrderCompletionLine[];
  invoices: OrderCompletionInvoice[];
}): OrderOperationalCompletionAssessment {
  if (input.state === "closed" || input.state === "canceled") {
    return { ok: false, code: "TERMINAL_STATE", message: `Cannot complete an order in ${input.state} state.` };
  }

  const activeLines = input.lineItems.filter((line) => String(line.status ?? "").trim().toLowerCase() !== "canceled");
  if (activeLines.length === 0) {
    return { ok: false, code: "NO_ACTIVE_LINES", message: "Cannot complete an order with no active line items." };
  }

  const serviceFeeOnly = activeLines.every((line) => line.workflowIntent === "service_fee");
  if (!serviceFeeOnly && input.state !== "production_complete") {
    return {
      ok: false,
      code: "PRODUCTION_COMPLETION_REQUIRED",
      message: "Complete production and fulfillment before completing this order.",
    };
  }

  const fulfillmentStatus = String(input.fulfillmentStatus ?? "").trim().toLowerCase();
  if (!serviceFeeOnly && fulfillmentStatus !== "shipped" && fulfillmentStatus !== "delivered") {
    return {
      ok: false,
      code: "FULFILLMENT_COMPLETION_REQUIRED",
      message: "Complete shipping or pickup fulfillment before completing this order.",
    };
  }

  const activeInvoices = input.invoices.filter((invoice) => {
    const status = String(invoice.status ?? "").trim().toLowerCase();
    return status !== "void" && status !== "voided";
  });
  const allInvoicesPaid = activeInvoices.length > 0 && activeInvoices.every((invoice) => {
    const status = String(invoice.status ?? "").trim().toLowerCase();
    const balance = invoice.balanceDue == null ? null : Number(invoice.balanceDue);
    return status === "paid" || (balance != null && Number.isFinite(balance) && balance <= 0);
  });

  return {
    ok: true,
    serviceFeeOnly,
    activeInvoiceCount: activeInvoices.length,
    needsInvoicing: activeInvoices.length === 0,
    allInvoicesPaid,
  };
}

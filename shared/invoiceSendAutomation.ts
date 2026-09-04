export const INVOICE_DUE_DATE_ON_CUSTOMER_SEND = [
  "keep_existing",
  "recalculate_from_terms",
] as const;

export type InvoiceDueDateOnCustomerSend = typeof INVOICE_DUE_DATE_ON_CUSTOMER_SEND[number];

export type InvoiceSendAutomationPreferences = {
  approveForAccountingAfterSuccessfulSend: boolean;
  dueDateOnFirstSuccessfulCustomerSend: InvoiceDueDateOnCustomerSend;
};

export const DEFAULT_INVOICE_SEND_AUTOMATION_PREFERENCES: InvoiceSendAutomationPreferences = {
  approveForAccountingAfterSuccessfulSend: false,
  dueDateOnFirstSuccessfulCustomerSend: "keep_existing",
};

const PAYMENT_TERM_DAYS: Record<string, number> = {
  due_on_receipt: 0,
  net_15: 15,
  net_30: 30,
  net_45: 45,
};

export function resolveInvoiceSendAutomationPreferences(preferences: unknown): InvoiceSendAutomationPreferences {
  const raw = preferences && typeof preferences === "object"
    ? (preferences as any).invoiceSendAutomation
    : undefined;
  const automation = raw && typeof raw === "object" ? raw : {};

  return {
    approveForAccountingAfterSuccessfulSend: automation.approveForAccountingAfterSuccessfulSend === true,
    dueDateOnFirstSuccessfulCustomerSend:
      automation.dueDateOnFirstSuccessfulCustomerSend === "recalculate_from_terms"
        ? "recalculate_from_terms"
        : "keep_existing",
  };
}

/**
 * Customer-specific terms take precedence. The existing invoice terms value
 * is the durable organization/default snapshot when the customer has no
 * specific term, followed by the established due-on-receipt fallback.
 */
export function resolveInvoiceCustomerDeliveryTerms(input: {
  invoiceTerms?: string | null;
  customerPaymentTerms?: string | null;
}): string {
  const customerTerms = String(input.customerPaymentTerms || "").trim().toLowerCase();
  if (customerTerms) return customerTerms;
  const invoiceTerms = String(input.invoiceTerms || "").trim().toLowerCase();
  return invoiceTerms || "due_on_receipt";
}

/** Returns null for custom terms because their already-entered due date is authoritative. */
export function calculateDueDateFromSuccessfulCustomerSend(input: {
  successfulSentAt: Date;
  terms: string;
}): Date | null {
  const days = PAYMENT_TERM_DAYS[String(input.terms || "").trim().toLowerCase()];
  if (days === undefined) return null;

  const dueDate = new Date(input.successfulSentAt.getTime());
  dueDate.setUTCDate(dueDate.getUTCDate() + days);
  return dueDate;
}

export function shouldRecalculateInvoiceDueDateAfterSuccessfulSend(input: {
  isFirstSuccessfulCustomerDelivery: boolean;
  automation: InvoiceSendAutomationPreferences;
}): boolean {
  return input.isFirstSuccessfulCustomerDelivery
    && input.automation.dueDateOnFirstSuccessfulCustomerSend === "recalculate_from_terms";
}

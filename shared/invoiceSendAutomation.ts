import {
  calculateInvoiceDueDateFromTerms,
  resolveInvoicePaymentTerms,
} from "./invoicePaymentTerms";

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
  return resolveInvoicePaymentTerms(input);
}

/** Returns null for custom terms because their already-entered due date is authoritative. */
export function calculateDueDateFromSuccessfulCustomerSend(input: {
  successfulSentAt: Date;
  terms: string;
}): Date | null {
  return calculateInvoiceDueDateFromTerms({
    termsStartedAt: input.successfulSentAt,
    terms: resolveInvoicePaymentTerms({ invoiceTerms: input.terms }),
  });
}

export function shouldRecalculateInvoiceDueDateAfterSuccessfulSend(input: {
  isFirstSuccessfulCustomerDelivery: boolean;
  automation: InvoiceSendAutomationPreferences;
}): boolean {
  return input.isFirstSuccessfulCustomerDelivery
    && input.automation.dueDateOnFirstSuccessfulCustomerSend === "recalculate_from_terms";
}

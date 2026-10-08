import {
  CUSTOMER_PAYMENT_TERM_VALUES,
  type CustomerPaymentTerm,
} from "./customerCommercialConfiguration";

const paymentTermValues = new Set<string>(CUSTOMER_PAYMENT_TERM_VALUES);

const paymentTermDays: Record<Exclude<CustomerPaymentTerm, "custom">, number> = {
  due_on_receipt: 0,
  net_15: 15,
  net_30: 30,
  net_45: 45,
};

export function resolveInvoicePaymentTerms(input: {
  customerPaymentTerms?: string | null;
  invoiceTerms?: string | null;
}): CustomerPaymentTerm {
  const customerTerms = String(input.customerPaymentTerms || "").trim().toLowerCase();
  if (paymentTermValues.has(customerTerms)) return customerTerms as CustomerPaymentTerm;

  const invoiceTerms = String(input.invoiceTerms || "").trim().toLowerCase();
  if (paymentTermValues.has(invoiceTerms)) return invoiceTerms as CustomerPaymentTerm;

  return "due_on_receipt";
}

export function calculateInvoiceDueDateFromTerms(input: {
  termsStartedAt: Date;
  terms: CustomerPaymentTerm;
}): Date | null {
  if (input.terms === "custom") return null;

  const dueDate = new Date(input.termsStartedAt.getTime());
  dueDate.setUTCDate(dueDate.getUTCDate() + paymentTermDays[input.terms]);
  return dueDate;
}

export function hasInvoicePaymentTermsStartedOrApprovalHistory(invoice: Record<string, unknown>): boolean {
  return Boolean(
    invoice.termsStartedAt
    || invoice.accountingApprovedAt
    || invoice.accountingApprovalRevokedAt
    || invoice.accountingApprovedVersion,
  );
}

/** Native living invoices can carry a provisional date until first approval.
 * Imported and provider-linked invoices retain their source document dates. */
export function hasEstablishedInvoiceDate(invoice: Record<string, unknown>): boolean {
  return hasInvoicePaymentTermsStartedOrApprovalHistory(invoice)
    || Boolean(invoice.importSource || invoice.importedAt || invoice.isHistorical || invoice.historicalArState
      || invoice.qbInvoiceId || invoice.externalAccountingId);
}

/** First approvals written by the current rule store the business day at UTC
 * noon in both document-date columns. Legacy/imported timestamps keep their
 * existing display behavior. */
export function hasFirstApprovalInvoiceDateAnchor(invoice: Record<string, unknown>): boolean {
  if (!hasInvoicePaymentTermsStartedOrApprovalHistory(invoice)) return false;
  const issue = invoice.issueDate ? new Date(invoice.issueDate as string | Date) : null;
  const issued = invoice.issuedAt ? new Date(invoice.issuedAt as string | Date) : null;
  if (!issue || !issued || Number.isNaN(issue.getTime()) || Number.isNaN(issued.getTime())) return false;
  return issue.getTime() === issued.getTime() && issue.toISOString().endsWith('T12:00:00.000Z');
}

export function resolveFirstInvoiceTermsStart(input: {
  customerPaymentTerms?: string | null;
  invoiceTerms?: string | null;
  approvalAt: Date;
  existingDueDate?: Date | string | null;
}): {
  terms: CustomerPaymentTerm;
  dueDate: Date | null;
  validationError: string | null;
} {
  const terms = resolveInvoicePaymentTerms(input);
  if (terms !== "custom") {
    return {
      terms,
      dueDate: calculateInvoiceDueDateFromTerms({ termsStartedAt: input.approvalAt, terms }),
      validationError: null,
    };
  }

  const existingDueDate = input.existingDueDate ? new Date(input.existingDueDate) : null;
  if (!existingDueDate || Number.isNaN(existingDueDate.getTime())) {
    return {
      terms,
      dueDate: null,
      validationError: "Custom payment terms require a manually entered due date before first accounting approval.",
    };
  }

  return { terms, dueDate: existingDueDate, validationError: null };
}

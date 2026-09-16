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

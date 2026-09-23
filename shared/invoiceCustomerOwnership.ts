export type InvoiceCustomerOwnershipInput = {
  invoiceCustomerId: string | null;
  invoiceContactId?: string | null;
  invoiceImportSource?: string | null;
  linkedOrderId?: string | null;
  linkedOrderCustomerId?: string | null;
  linkedOrderContactId?: string | null;
};

/**
 * Invoice-facing reads use the Order customer for native Order-backed work.
 * QuickBooks imports intentionally retain their stored accounting identity.
 */
export function resolveCanonicalInvoiceCustomerOwnership(input: InvoiceCustomerOwnershipInput): {
  customerId: string | null;
  contactId: string | null;
  source: "order" | "invoice" | "contact";
} {
  if (input.invoiceContactId) {
    return { customerId: null, contactId: input.invoiceContactId, source: "contact" };
  }
  const orderBacked = Boolean(
    input.linkedOrderId
    && input.linkedOrderCustomerId
    && String(input.invoiceImportSource || "").toLowerCase() !== "quickbooks",
  );
  return orderBacked
    ? { customerId: input.linkedOrderCustomerId!, contactId: input.linkedOrderContactId ?? null, source: "order" }
    : { customerId: input.invoiceCustomerId, contactId: null, source: "invoice" };
}

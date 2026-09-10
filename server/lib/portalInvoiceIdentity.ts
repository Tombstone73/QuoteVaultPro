export type PortalInvoiceIdentityInput = {
  invoiceCustomerPoNumber?: string | null;
  linkedOrderPoNumber?: string | null;
  linkedOrderLabel?: string | null;
  linkedOrderNumber?: string | null;
};

export type PortalInvoiceIdentity = {
  customerPoNumber: string | null;
  jobLabel: string | null;
  orderNumber: string | null;
};

function nonBlank(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

/**
 * Keeps invoice list identity facts historical and safe for the customer
 * portal.  An invoice PO is a financial snapshot; the current Order PO is
 * used only when that snapshot was never recorded.
 */
export function resolvePortalInvoiceIdentity(input: PortalInvoiceIdentityInput): PortalInvoiceIdentity {
  return {
    customerPoNumber: nonBlank(input.invoiceCustomerPoNumber) ?? nonBlank(input.linkedOrderPoNumber),
    jobLabel: nonBlank(input.linkedOrderLabel),
    orderNumber: nonBlank(input.linkedOrderNumber),
  };
}

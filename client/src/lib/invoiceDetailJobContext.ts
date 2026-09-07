type InvoiceJobContextInvoice = {
  customerPoNumber?: string | null;
  sourceOrderNumber?: string | number | null;
};

type InvoiceJobContextOrder = {
  displayNumber?: string | number | null;
  orderNumber?: string | number | null;
  poNumber?: string | null;
  label?: string | null;
};

export type InvoiceDetailJobContext = {
  orderNumber: string | null;
  purchaseOrderNumber: string | null;
  jobLabel: string | null;
};

function firstNonBlank(...values: Array<string | number | null | undefined>): string | null {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return null;
}

/**
 * Resolves the read-only job context displayed on Invoice Detail.
 *
 * Invoice PO and order-number snapshots take precedence so finalized and
 * historical invoices retain the commercial context captured at invoicing.
 */
export function resolveInvoiceDetailJobContext(
  invoice: InvoiceJobContextInvoice | null | undefined,
  order: InvoiceJobContextOrder | null | undefined,
): InvoiceDetailJobContext {
  return {
    orderNumber: firstNonBlank(
      invoice?.sourceOrderNumber,
      order?.displayNumber,
      order?.orderNumber,
    ),
    purchaseOrderNumber: firstNonBlank(invoice?.customerPoNumber, order?.poNumber),
    jobLabel: firstNonBlank(order?.label),
  };
}

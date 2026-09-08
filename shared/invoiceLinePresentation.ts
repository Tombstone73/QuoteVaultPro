export type InvoiceLineHierarchyItem = {
  id?: string | null;
  parentLineItemId?: string | null;
};

/**
 * Keeps invoice detail and document rendering aligned on the same nested
 * customer-facing relationship without inferring or changing any pricing.
 */
export function isNestedInvoiceLineItem(
  lineItem: InvoiceLineHierarchyItem,
  lineItems: readonly InvoiceLineHierarchyItem[],
): boolean {
  const parentId = String(lineItem.parentLineItemId || '').trim();
  return Boolean(parentId && lineItems.some((candidate) => String(candidate.id || '').trim() === parentId));
}

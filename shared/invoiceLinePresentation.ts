export type InvoiceLineHierarchyItem = {
  id?: string | null;
  parentLineItemId?: string | null;
};

export type InvoiceLinePresentationItem = InvoiceLineHierarchyItem & {
  productName?: string | null;
  name?: string | null;
  description?: string | null;
  width?: number | string | null;
  height?: number | string | null;
};

function meaningfulText(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function meaningfulMeasurement(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function isBogusZeroDimensionDescription(value: string | null): boolean {
  if (!value) return false;
  return /^0(?:\.0+)?\s*(?:in|\")?\s*[×x]\s*0(?:\.0+)?\s*(?:in|\")?$/i.test(value);
}

/**
 * Resolves the same customer-facing identity for the invoice UI and documents.
 * Product identity wins over a generated 0 × 0 placeholder, while a meaningful
 * operator-entered description remains available as secondary context.
 */
export function resolveInvoiceLinePresentation(lineItem: InvoiceLinePresentationItem): {
  primaryLabel: string;
  secondaryLabel: string | null;
  dimensionsLabel: string | null;
} {
  const productName = meaningfulText(lineItem.productName) || meaningfulText(lineItem.name);
  const description = meaningfulText(lineItem.description);
  const usableDescription = isBogusZeroDimensionDescription(description) ? null : description;
  const primaryLabel = productName || usableDescription || 'Line item';
  const secondaryLabel = productName && usableDescription && usableDescription !== productName
    ? usableDescription
    : null;
  const width = meaningfulMeasurement(lineItem.width);
  const height = meaningfulMeasurement(lineItem.height);
  const dimensionsLabel = width != null && height != null ? `${width}\" × ${height}\"` : null;

  return { primaryLabel, secondaryLabel, dimensionsLabel };
}

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

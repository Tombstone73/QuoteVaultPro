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

export type StaffInvoiceHierarchyLine = InvoiceLineHierarchyItem & {
  orderLineItemId?: string | null;
  sortOrder?: number | null;
};

/** Staff view of immutable Invoice rows. Parent links reference source Order IDs. */
export function projectStaffInvoiceLineHierarchy<T extends StaffInvoiceHierarchyLine>(lines: readonly T[]) {
  const ordered = lines.map((line, index) => ({ line, index })).sort((a, b) =>
    (a.line.sortOrder ?? a.index) - (b.line.sortOrder ?? b.index) || a.index - b.index,
  ).map(({ line }) => line);
  const byOrderLineId = new Map<string, T | null>();
  for (const line of ordered) {
    const id = String(line.orderLineItemId ?? '').trim();
    if (id) byOrderLineId.set(id, byOrderLineId.has(id) ? null : line);
  }
  const parentOf = (line: T): T | null => {
    const id = String(line.parentLineItemId ?? '').trim();
    const parent = id ? byOrderLineId.get(id) : null;
    if (!parent || parent === line) return null;
    // Historical cycles and ambiguous identities are displayed as ordinary rows.
    const visited = new Set<T>([line]);
    let cursor: T | null = parent;
    while (cursor) {
      if (visited.has(cursor)) return null;
      visited.add(cursor);
      const nextId: string = String(cursor.parentLineItemId ?? '').trim();
      cursor = nextId ? byOrderLineId.get(nextId) ?? null : null;
    }
    return parent;
  };
  const children = new Map<T, T[]>();
  for (const line of ordered) {
    const parent = parentOf(line);
    if (parent) children.set(parent, [...(children.get(parent) ?? []), line]);
  }
  const visible: T[] = [];
  const append = (line: T) => {
    visible.push(line);
    for (const child of children.get(line) ?? []) append(child);
  };
  for (const line of ordered) if (!parentOf(line)) append(line);
  const lineNumberByLine = new Map(visible.map((line, index) => [line, index + 1]));
  return visible.map((line) => {
    const parent = parentOf(line);
    return {
      line,
      lineNumber: lineNumberByLine.get(line)!,
      parentLineNumber: parent ? lineNumberByLine.get(parent) ?? null : null,
      childCount: children.get(line)?.length ?? 0,
    };
  });
}

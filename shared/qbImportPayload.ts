/**
 * Pure helper for building the QB invoice import payload from UI state.
 * No DB access, no side effects — safe to unit test without any service imports.
 */

export type QBImportPreviewRow = {
  qbInvoiceId: string;
  classification: 'open_ar' | 'historical';
  canImport: boolean;
};

export type QBImportOverrideMap = Record<string, 'suggested' | 'open_ar' | 'historical' | 'skip'>;

export type QBImportInvoiceEntry = {
  qbId: string;
  classification: 'open_ar' | 'historical' | 'skip';
};

export type QBImportSummary = {
  openAr: number;
  historical: number;
  skipped: number;
  excluded: number;
  importable: number;
};

/**
 * Resolve the effective classification for a single preview row, given any row-level override.
 * Returns 'skip' when the override is 'skip'.
 * Falls back to the suggested classification from the preview row.
 */
export function resolveRowClassification(
  row: QBImportPreviewRow,
  overrides: QBImportOverrideMap,
  bulkOverride?: 'open_ar' | 'historical',
): 'open_ar' | 'historical' | 'skip' {
  if (bulkOverride) return bulkOverride;
  const override = overrides[row.qbInvoiceId];
  if (override === 'open_ar' || override === 'historical' || override === 'skip') return override;
  return row.classification;
}

/**
 * Build the invoices[] payload to send to the import API.
 *
 * - Only includes rows that are selected AND canImport.
 * - When bulkOverride is set, forces all eligible rows to that classification (ignores row overrides).
 * - When bulkOverride is absent, uses each row's override or its suggested classification.
 * - Skip rows are included in the payload (so the server can track the count) but
 *   callers may filter them out if sending only importable rows.
 */
export function buildQBImportPayload(
  selectedIds: Set<string>,
  rows: QBImportPreviewRow[],
  overrides: QBImportOverrideMap,
  bulkOverride?: 'open_ar' | 'historical',
): QBImportInvoiceEntry[] {
  return rows
    .filter(row => selectedIds.has(row.qbInvoiceId) && row.canImport)
    .map(row => ({
      qbId: row.qbInvoiceId,
      classification: resolveRowClassification(row, overrides, bulkOverride),
    }));
}

/**
 * Compute a summary of how many selected rows will import as each classification.
 * Excluded rows (canImport === false) are counted separately.
 */
export function computeQBImportSummary(
  selectedIds: Set<string>,
  rows: QBImportPreviewRow[],
  overrides: QBImportOverrideMap,
): QBImportSummary {
  let openAr = 0, historical = 0, skipped = 0, excluded = 0;
  for (const row of rows) {
    if (!selectedIds.has(row.qbInvoiceId)) continue;
    if (!row.canImport) { excluded++; continue; }
    const cls = resolveRowClassification(row, overrides);
    if (cls === 'skip') skipped++;
    else if (cls === 'open_ar') openAr++;
    else historical++;
  }
  return { openAr, historical, skipped, excluded, importable: openAr + historical };
}

const POSTGRES_INTEGER_MAX = 2_147_483_647;

export type HistoricalQuickBooksInvoiceNumber = {
  sourceDocNumber: string;
  displayNumber: string;
  numberCore: number | null;
  // Legacy invoices still require an integer storage value. Zero is an
  // explicitly non-allocated sentinel for a non-numeric QB DocNumber.
  invoiceNumber: number;
};

export type HistoricalQuickBooksNumberRecord = {
  entity: 'invoice' | 'order' | 'quote';
  id: string;
  qbDocNumber?: string | null;
  displayNumber?: string | null;
  numberCore?: number | null;
  jobNumber?: number | null;
  invoiceNumber?: number | null;
};

export type HistoricalQuickBooksNumberConflict = {
  kind: 'duplicate_quickbooks_doc_number' | 'duplicate_display_number' | 'native_number_collision';
  entity: HistoricalQuickBooksNumberRecord['entity'];
  id: string;
};

export function resolveHistoricalQuickBooksInvoiceNumber(qbDocNumber: unknown): { value: HistoricalQuickBooksInvoiceNumber } | { error: string } {
  const sourceDocNumber = String(qbDocNumber ?? '').trim();
  if (!sourceDocNumber) return { error: 'QuickBooks historical invoice is missing DocNumber.' };
  if (sourceDocNumber.length > 64) return { error: 'QuickBooks historical invoice DocNumber exceeds the 64-character display-number limit.' };
  const numeric = /^[0-9]+$/.test(sourceDocNumber) ? Number(sourceDocNumber) : NaN;
  const numberCore = Number.isSafeInteger(numeric) && numeric > 0 && numeric <= POSTGRES_INTEGER_MAX ? numeric : null;
  return { value: { sourceDocNumber, displayNumber: sourceDocNumber, numberCore, invoiceNumber: numberCore ?? 0 } };
}

export function findHistoricalQuickBooksNumberConflicts(identity: HistoricalQuickBooksInvoiceNumber, records: HistoricalQuickBooksNumberRecord[]): HistoricalQuickBooksNumberConflict[] {
  const source = identity.sourceDocNumber.toLowerCase();
  const conflicts: HistoricalQuickBooksNumberConflict[] = [];
  for (const record of records) {
    const qbDocNumber = String(record.qbDocNumber ?? '').trim().toLowerCase();
    const displayNumber = String(record.displayNumber ?? '').trim();
    if (record.entity === 'invoice' && qbDocNumber === source) { conflicts.push({ kind: 'duplicate_quickbooks_doc_number', entity: record.entity, id: record.id }); continue; }
    if (displayNumber === identity.displayNumber) { conflicts.push({ kind: 'duplicate_display_number', entity: record.entity, id: record.id }); continue; }
    if (identity.numberCore != null && [record.numberCore, record.jobNumber, record.invoiceNumber].some((value) => Number(value) === identity.numberCore)) conflicts.push({ kind: 'native_number_collision', entity: record.entity, id: record.id });
  }
  return conflicts;
}

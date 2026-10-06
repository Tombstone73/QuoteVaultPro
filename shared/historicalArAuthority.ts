/** Imported documents carry their own A/R authority. Local Payment absence is not evidence of debt. */
export const HISTORICAL_AR_STATES = [
  'historical_closed',
  'historical_open_ar_reconciled',
  'historical_review_required',
] as const;

export type HistoricalArState = typeof HISTORICAL_AR_STATES[number];

export type HistoricalArAuthorityInput = {
  importSource?: string | null;
  importedAt?: Date | string | null;
  isHistorical?: boolean | null;
  customerId?: string | null;
  externalAccountingId?: string | null;
  qbInvoiceId?: string | null;
  totalCents?: number | null;
  historicalArState?: string | null;
  historicalArSourceBalanceCents?: number | null;
  historicalArApprovedAt?: Date | string | null;
  historicalArApprovedByUserId?: string | null;
  historicalArApprovalEvidence?: unknown;
};

export function isImportedHistoricalInvoice(input: HistoricalArAuthorityInput): boolean {
  return Boolean(String(input.importSource || '').trim() || input.importedAt || input.isHistorical || input.historicalArState);
}

function hasApprovalEvidence(input: HistoricalArAuthorityInput): boolean {
  const evidence = input.historicalArApprovalEvidence;
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return false;
  const row = evidence as Record<string, unknown>;
  return ['sourceInvoiceId', 'customerId', 'sourceStatus', 'sourceDate', 'paymentEvidence']
    .every((key) => typeof row[key] === 'string' && Boolean(String(row[key]).trim()))
    && row.customerId === input.customerId
    && row.sourceInvoiceId === (input.externalAccountingId || input.qbInvoiceId)
    && Number.isSafeInteger(row.originalCents)
    && row.originalCents === input.totalCents
    && Number(row.originalCents) >= Number(input.historicalArSourceBalanceCents)
    && row.remainingCents === input.historicalArSourceBalanceCents;
}

export function resolveHistoricalArState(input: HistoricalArAuthorityInput): HistoricalArState | null {
  if (!isImportedHistoricalInvoice(input)) return null;
  if (input.historicalArState === 'historical_closed') return 'historical_closed';
  if (input.historicalArState === 'historical_open_ar_reconciled'
    && Number.isSafeInteger(input.historicalArSourceBalanceCents)
    && Number(input.historicalArSourceBalanceCents) > 0
    && input.historicalArApprovedAt
    && input.historicalArApprovedByUserId
    && hasApprovalEvidence(input)) {
    return 'historical_open_ar_reconciled';
  }
  // Null, unknown, or unproven legacy states fail closed for customers.
  return 'historical_review_required';
}

export function approvedHistoricalArBalanceCents(input: HistoricalArAuthorityInput): number {
  return resolveHistoricalArState(input) === 'historical_open_ar_reconciled'
    ? Number(input.historicalArSourceBalanceCents)
    : 0;
}

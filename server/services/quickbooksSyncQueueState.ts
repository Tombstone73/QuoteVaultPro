export type QuickBooksSyncQueueState = 'unsynced' | 'queued' | 'failed' | 'synced';
export type QuickBooksSyncQueueView = 'all' | QuickBooksSyncQueueState;

// These are the only persisted sync statuses that represent derived local
// accounting work. The queue summary and the paginated console both consume
// these definitions so a card cannot describe records the table excludes.
export const INVOICE_UNSYNCED_STATUSES = ['not_synced', 'needs_resync'] as const;
export const PAYMENT_UNSYNCED_STATUSES = ['not_synced', 'skipped'] as const;
export const PAYMENT_FAILED_STATUSES = ['failed', 'error'] as const;
export const VALID_PAYMENT_STATUSES = ['succeeded', 'captured'] as const;

export function invoiceQueueState(value: unknown): QuickBooksSyncQueueState {
  const status = String(value ?? '').toLowerCase();
  if (status === 'pending') return 'queued';
  if (status === 'failed') return 'failed';
  if (status === 'synced') return 'synced';
  return 'unsynced';
}

export function paymentQueueState(value: unknown, externalAccountingId: unknown): QuickBooksSyncQueueState {
  if (String(externalAccountingId ?? '').trim()) return 'synced';
  const status = String(value ?? '').toLowerCase();
  if (PAYMENT_FAILED_STATUSES.includes(status as typeof PAYMENT_FAILED_STATUSES[number])) return 'failed';
  if (status === 'synced') return 'synced';
  if (status === 'pending') return 'queued';
  return 'unsynced';
}

export function matchesQueueView(state: QuickBooksSyncQueueState, view: QuickBooksSyncQueueView): boolean {
  return view === 'all' || state === view;
}

export function countQueueStates(states: QuickBooksSyncQueueState[]): Record<QuickBooksSyncQueueState, number> {
  const counts: Record<QuickBooksSyncQueueState, number> = { unsynced: 0, queued: 0, failed: 0, synced: 0 };
  states.forEach((state) => { counts[state] += 1; });
  return counts;
}

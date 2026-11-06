/**
 * Staff work-queue placement is distinct from physical completion and closure.
 * Only the current saved selection is considered, never historical events.
 */
export const CANONICAL_OPEN_ORDER_STATE = "open";
export const COMPLETE_ORDER_STATUS_PILL_KEY = "complete";

export type CanonicalOpenOrderCandidate = {
  state: string | null | undefined;
  statusPillKey?: string | null;
  statusPillValue?: string | null;
};

export function isManualOrderComplete(candidate: Pick<CanonicalOpenOrderCandidate, 'statusPillKey' | 'statusPillValue'>): boolean {
  // A resolved stable catalog identity wins over old copied display text.
  if (candidate.statusPillKey != null) return candidate.statusPillKey.trim().toLowerCase() === COMPLETE_ORDER_STATUS_PILL_KEY;
  return candidate.statusPillValue?.trim().toLowerCase() === 'complete';
}

export function orderWorkQueueState(candidate: CanonicalOpenOrderCandidate): 'open' | 'production_complete' | 'closed' | 'canceled' | null {
  if (candidate.state === 'closed' || candidate.state === 'canceled' || candidate.state === 'production_complete') return candidate.state;
  if (candidate.state === CANONICAL_OPEN_ORDER_STATE) return isManualOrderComplete(candidate) ? 'production_complete' : 'open';
  return null;
}

export function isCanonicalOpenOrder(candidate: CanonicalOpenOrderCandidate): boolean {
  return orderWorkQueueState(candidate) === CANONICAL_OPEN_ORDER_STATE;
}

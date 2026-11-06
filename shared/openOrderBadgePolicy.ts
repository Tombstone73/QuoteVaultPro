/**
 * The Open bucket follows canonical lifecycle. Informational labels never
 * resolve or hide unfinished production/fulfillment obligations.
 */
export const CANONICAL_OPEN_ORDER_STATE = "open";
export const COMPLETE_ORDER_STATUS_PILL_KEY = "complete";

export type CanonicalOpenOrderCandidate = {
  state: string | null | undefined;
  statusPillKey?: string | null;
  statusPillValue?: string | null;
};

export function isCanonicalOpenOrder(candidate: CanonicalOpenOrderCandidate): boolean {
  return candidate.state === CANONICAL_OPEN_ORDER_STATE;
}

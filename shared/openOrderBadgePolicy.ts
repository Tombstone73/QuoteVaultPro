/**
 * The Orders page's Open bucket is lifecycle-scoped, with Complete status
 * pills intentionally presented outside that working bucket.  The persisted
 * `orders.status` projection is not sufficient: historical orders can retain
 * `new` or `in_production` after their display status becomes Complete.
 */
export const CANONICAL_OPEN_ORDER_STATE = "open";
export const COMPLETE_ORDER_STATUS_PILL_KEY = "complete";

export type CanonicalOpenOrderCandidate = {
  state: string | null | undefined;
  statusPillKey?: string | null;
  statusPillValue?: string | null;
};

function normalize(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

export function isCanonicalOpenOrder(candidate: CanonicalOpenOrderCandidate): boolean {
  if (candidate.state !== CANONICAL_OPEN_ORDER_STATE) return false;
  return normalize(candidate.statusPillKey) !== COMPLETE_ORDER_STATUS_PILL_KEY
    && normalize(candidate.statusPillValue) !== "complete";
}

// These are persisted orders.status values from insertOrderSchema. V2 may
// source the included canonical statuses from organization settings.
export const OPEN_ORDER_BADGE_STATUSES = ["new", "in_production"] as const;

export function isOpenOrderBadgeStatus(status: string | null | undefined): boolean {
  return OPEN_ORDER_BADGE_STATUSES.some((included) => included === status);
}

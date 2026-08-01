export const ACTIVE_PRODUCTION_RUN_STATUSES = [
  "draft",
  "ready_for_production",
  "in_production",
  "partially_completed",
] as const;

export type ActiveProductionRunStatus = (typeof ACTIVE_PRODUCTION_RUN_STATUSES)[number];

export function isActiveProductionRunStatus(status: unknown): status is ActiveProductionRunStatus {
  return ACTIVE_PRODUCTION_RUN_STATUSES.includes(String(status || "").trim().toLowerCase() as ActiveProductionRunStatus);
}

/**
 * A run may suppress a standalone job only while it still has unfinished work.
 * Historical memberships intentionally remain query-visible for traceability.
 */
export function isUnfinishedProductionRunMember(member: {
  allocatedQuantity?: number | null;
  completedQuantity?: number | null;
  successfulQuantity?: number | null;
  damagedQuantity?: number | null;
  remainingQuantity?: number | null;
}): boolean {
  const allocatedQuantity = Math.max(0, Number(member.allocatedQuantity) || 0);
  const completedQuantity = Math.max(Number(member.completedQuantity) || 0, Number(member.successfulQuantity) || 0);
  const damagedQuantity = Math.max(0, Number(member.damagedQuantity) || 0);
  const calculatedRemaining = Math.max(0, allocatedQuantity - completedQuantity - damagedQuantity);
  const persistedRemaining = Math.max(0, Number(member.remainingQuantity) || 0);
  return Math.max(calculatedRemaining, persistedRemaining) > 0;
}

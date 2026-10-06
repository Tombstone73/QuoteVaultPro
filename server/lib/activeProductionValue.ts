import { isCanonicalOpenOrder } from "@shared/openOrderBadgePolicy";
import { currentProductionStatusPillBucket } from "../services/dailyProductionReportStatus";

export type ActiveProductionValue = {
  totalCents: number;
  newCents: number;
  inProductionCents: number;
};

export type ActiveProductionValueLine = {
  id: string;
  orderId: string;
  organizationId: string;
  orderState: string;
  orderStatus: string;
  orderCanceledAt: Date | string | null;
  statusPillId: string | null;
  statusPillKey: string | null;
  statusPillValue: string | null;
  workflowState: string;
  lifecycleStatus: string;
  lineItemRole: string;
  parentLineItemId: string | null;
  parentPriceMode: string;
  valueCents: number | string;
};

const terminalLineStatuses = new Set(["complete", "completed", "canceled", "cancelled", "void", "voided"]);

/** One commercial Order line is one value contribution, regardless of how many
 * production Jobs or Combined Runs represent its operational work. */
export function projectActiveProductionValue(
  organizationId: string,
  lines: readonly ActiveProductionValueLine[],
): ActiveProductionValue {
  const result = { totalCents: 0, newCents: 0, inProductionCents: 0 };
  const activeChildrenByParent = new Map<string, { count: number; cents: number }>();
  const allChildrenByParent = new Map<string, number>();
  const eligibleParents: ActiveProductionValueLine[] = [];
  for (const line of lines) {
    if (line.parentLineItemId) {
      const key = `${line.orderId}:${line.parentLineItemId}`;
      allChildrenByParent.set(key, (allChildrenByParent.get(key) ?? 0) + 1);
    }
    if (line.organizationId !== organizationId || line.orderCanceledAt
      || line.orderStatus === "operationally_complete"
      || (!line.statusPillId && !line.statusPillValue?.trim())
      || !isCanonicalOpenOrder({ state: line.orderState, statusPillKey: line.statusPillKey, statusPillValue: line.statusPillValue })
      || terminalLineStatuses.has(line.lifecycleStatus.trim().toLowerCase())
      || terminalLineStatuses.has(line.workflowState.trim().toLowerCase())) continue;
    const bucket = currentProductionStatusPillBucket({
      statusPillId: line.statusPillId,
      statusPillKey: line.statusPillKey,
      statusPillValue: line.statusPillValue,
      status: line.orderStatus,
    });
    if (!bucket) continue;

    // PostgreSQL rounds the persisted DECIMAL(10, 2) total to integer cents.
    // Never derive this figure from quantity x display unit price or PBV2.
    const cents = Number(line.valueCents);
    if (!Number.isSafeInteger(cents) || cents < 0) {
      throw new Error("Invalid persisted Order line selling value");
    }
    if (line.lineItemRole === "parent") {
      if (line.parentPriceMode === "manual_override") eligibleParents.push(line);
      continue;
    }
    if (line.parentLineItemId) {
      const key = `${line.orderId}:${line.parentLineItemId}`;
      const current = activeChildrenByParent.get(key) ?? { count: 0, cents: 0 };
      activeChildrenByParent.set(key, { count: current.count + 1, cents: current.cents + cents });
    }
    if (bucket === "new") result.newCents += cents;
    else result.inProductionCents += cents;
  }
  // A manual bundle override belongs to its synthetic wrapper in canonical
  // billing. Apply it only when every child contributes; mixed child states
  // have no persisted allocation of the wrapper adjustment to active work.
  for (const parent of eligibleParents) {
    const key = `${parent.orderId}:${parent.id}`;
    const children = activeChildrenByParent.get(key);
    if (!children || children.count !== allChildrenByParent.get(key)) continue;
    const adjustment = Number(parent.valueCents) - children.cents;
    const bucket = currentProductionStatusPillBucket({
      statusPillId: parent.statusPillId,
      statusPillKey: parent.statusPillKey,
      statusPillValue: parent.statusPillValue,
      status: parent.orderStatus,
    });
    if (bucket === "new") result.newCents += adjustment;
    else if (bucket === "in_production") result.inProductionCents += adjustment;
  }
  result.totalCents = result.newCents + result.inProductionCents;
  if (![result.newCents, result.inProductionCents, result.totalCents].every(Number.isSafeInteger)) {
    throw new Error("Active Production Value exceeds safe integer cents");
  }
  return result;
}

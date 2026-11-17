import { and, eq, or } from 'drizzle-orm';
import { db } from '../db';
import { orderAuditLog, orderLineItems, orders, orderStatusEvents, orderStatusPills, productionJobs, products } from '@shared/schema';
import { isTerminalProductionStatus } from '@shared/operationalState';
import { OPERATIONALLY_COMPLETE_STATUS } from '@shared/orderOperationalStatus';
import { hasOutstandingCanonicalProductionObligations, projectCanonicalProductionObligations } from './orderProductionCompletionPolicy';
import { currentProductionStatusPillBucket } from './dailyProductionReportStatus';
import { buildStatusPillChangeEvent } from './orderStatusPillService';

type DbExecutor = any;

export type ProductionBulletEvidence = {
  orderId: string;
  orderNumber: string;
  organizationId: string;
  state: string;
  status: string;
  currentPillId: string | null;
  currentPillKey: string | null;
  currentPillValue: string | null;
  expectedPillKey: 'complete';
  operationalComplete: boolean;
  productionObligations: ReturnType<typeof projectCanonicalProductionObligations>;
  activeNonFulfillmentJobCount: number;
  remainingFulfillmentQuantity: number;
  repairEligible: boolean;
  conflict: boolean;
  exclusionReason: string | null;
};

/** A tenant-scoped read of the same line obligations used by the completion gates. */
export async function inspectProductionBullet(organizationId: string, orderId: string, executor: DbExecutor = db): Promise<ProductionBulletEvidence | null> {
  const { FulfillmentDashboardRepo } = await import('./fulfillment/repository');
  const [order] = await executor.select({
    id: orders.id, orderNumber: orders.orderNumber, displayNumber: orders.displayNumber,
    organizationId: orders.organizationId, state: orders.state, status: orders.status,
    canceledAt: orders.canceledAt, statusPillId: orders.statusPillId, statusPillValue: orders.statusPillValue,
  }).from(orders).where(and(eq(orders.organizationId, organizationId), eq(orders.id, orderId))).limit(1);
  if (!order) return null;
  const [[pill], lines, jobs, fulfillment] = await Promise.all([
    order.statusPillId ? executor.select({ key: orderStatusPills.key }).from(orderStatusPills).where(and(
      eq(orderStatusPills.organizationId, organizationId), eq(orderStatusPills.id, order.statusPillId),
    )).limit(1) : Promise.resolve([]),
    executor.select({
      id: orderLineItems.id, lineItemRole: orderLineItems.lineItemRole,
      productionBypassed: orderLineItems.productionBypassed,
      requiresProductionJob: products.requiresProductionJob, workflowIntent: products.workflowIntent,
      workflowState: orderLineItems.workflowState, lifecycleStatus: orderLineItems.status,
    }).from(orderLineItems).innerJoin(products, and(eq(products.id, orderLineItems.productId), eq(products.organizationId, organizationId)))
      .where(eq(orderLineItems.orderId, orderId)),
    executor.select({ lineItemId: productionJobs.lineItemId, stationKey: productionJobs.stationKey, status: productionJobs.status })
      .from(productionJobs).where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.orderId, orderId))),
    new FulfillmentDashboardRepo(executor).listLineEligibility(organizationId, { orderIds: [orderId] }, executor),
  ]);
  const active = jobs.filter((job: { status: string | null }) => !isTerminalProductionStatus(job.status));
  const activeNonFulfillment = active.filter((job: { stationKey: string | null }) => String(job.stationKey || '').toLowerCase() !== 'fulfillment');
  const ownerCounts = new Map<string, number>();
  for (const job of activeNonFulfillment) if (job.lineItemId) ownerCounts.set(job.lineItemId, (ownerCounts.get(job.lineItemId) ?? 0) + 1);
  const productionObligations = projectCanonicalProductionObligations({ lines, activeOwnerCountByLineItemId: ownerCounts });
  const productionComplete = !hasOutstandingCanonicalProductionObligations(productionObligations) && activeNonFulfillment.length === 0;
  const remainingFulfillmentQuantity = fulfillment.reduce((sum: number, line: { projection: { requiresFulfillment: boolean; remainingQuantity: number } }) =>
    sum + (line.projection.requiresFulfillment ? Math.max(0, line.projection.remainingQuantity) : 0), 0);
  const operationalComplete = !order.canceledAt && (order.state === 'closed' || (order.state === 'production_complete' && order.status === OPERATIONALLY_COMPLETE_STATUS));
  const currentPillKey = pill?.key ?? null;
  const staleProductionPill = currentProductionStatusPillBucket({
    statusPillId: order.statusPillId, statusPillKey: currentPillKey,
    statusPillValue: order.statusPillValue, status: order.status,
  }) === 'in_production';
  const conflict = operationalComplete && (!productionComplete || remainingFulfillmentQuantity > 0);
  const repairEligible = operationalComplete && productionComplete && remainingFulfillmentQuantity === 0 && staleProductionPill;
  const exclusionReason = repairEligible ? null : !operationalComplete ? 'OPERATIONAL_COMPLETION_NOT_ESTABLISHED'
    : !productionComplete ? 'PRODUCTION_OBLIGATIONS_OUTSTANDING'
    : remainingFulfillmentQuantity > 0 ? 'FULFILLMENT_OBLIGATIONS_OUTSTANDING'
    : !staleProductionPill ? 'PILL_NOT_IN_PRODUCTION' : 'UNKNOWN';
  return {
    orderId, orderNumber: String(order.displayNumber || order.orderNumber), organizationId,
    state: order.state, status: order.status, currentPillId: order.statusPillId,
    currentPillKey, currentPillValue: order.statusPillValue,
    expectedPillKey: 'complete', operationalComplete, productionObligations,
    activeNonFulfillmentJobCount: activeNonFulfillment.length, remainingFulfillmentQuantity,
    repairEligible, conflict, exclusionReason,
  };
}

/** Read-only tenant audit. No repair is run by a page load, deployment, or dry-run. */
export async function auditProductionBullets(organizationId: string, orderNumber?: string) {
  const orderRows = await db.select({ id: orders.id }).from(orders).where(and(
    eq(orders.organizationId, organizationId),
    or(eq(orders.status, OPERATIONALLY_COMPLETE_STATUS), eq(orders.state, 'closed')),
    ...(orderNumber ? [or(eq(orders.orderNumber, orderNumber), eq(orders.displayNumber, orderNumber))] : []),
  ));
  const evidence: ProductionBulletEvidence[] = [];
  for (const order of orderRows) {
    const inspected = await inspectProductionBullet(organizationId, order.id);
    if (inspected) evidence.push(inspected);
  }
  return {
    organizationId,
    inspectedCount: evidence.length,
    candidates: evidence.filter(item => item.repairEligible),
    conflicts: evidence.filter(item => item.conflict),
    exclusions: evidence.filter(item => !item.repairEligible && !item.conflict),
  };
}

/** Runs inside the existing completion transaction. Throws if canonical completion and the pill cannot commit together. */
export async function synchronizeCompletedProductionBulletInTransaction(executor: DbExecutor, input: {
  organizationId: string; orderId: string; actorUserId?: string | null; actorUserName?: string | null;
  reason: string; source: 'fulfillment_completion' | 'close_job_override' | 'explicit_reconciliation';
  historicalOnly?: boolean;
}) {
  const evidence = await inspectProductionBullet(input.organizationId, input.orderId, executor);
  if (!evidence) throw new Error('Order not found');
  if (input.historicalOnly && !evidence.repairEligible) return { changed: false, evidence };
  if (!evidence.operationalComplete || evidence.conflict) {
    throw Object.assign(new Error('Canonical production or fulfillment obligations remain unresolved.'), { code: 'PRODUCTION_BULLET_CONFLICT' });
  }
  if (evidence.currentPillKey === 'complete' || evidence.currentPillKey === 'closed') return { changed: false, evidence };
  const [target] = await executor.select().from(orderStatusPills).where(and(
    eq(orderStatusPills.organizationId, input.organizationId), eq(orderStatusPills.key, 'complete'), eq(orderStatusPills.isActive, true),
  )).limit(1);
  if (!target) throw Object.assign(new Error('Active Complete status pill is unavailable for this organization.'), { code: 'COMPLETE_STATUS_PILL_UNAVAILABLE' });
  const [previousPill] = evidence.currentPillId ? await executor.select().from(orderStatusPills).where(and(
    eq(orderStatusPills.organizationId, input.organizationId), eq(orderStatusPills.id, evidence.currentPillId),
  )).limit(1) : [];
  if (evidence.currentPillId === target.id) return { changed: false, evidence };
  await executor.update(orders).set({
    statusPillId: target.id, statusPillValue: target.name,
    statusPillAssignedByUserId: input.actorUserId ?? null, statusPillAssignedAt: new Date(),
    statusPillReason: input.reason, updatedAt: new Date().toISOString(),
  }).where(and(eq(orders.organizationId, input.organizationId), eq(orders.id, input.orderId)));
  const [event] = await executor.insert(orderStatusEvents).values(buildStatusPillChangeEvent({
    organizationId: input.organizationId, orderId: input.orderId,
    previousPill: previousPill ?? null, previousLabel: evidence.currentPillValue,
    targetPill: target, actorUserId: input.actorUserId ?? null, source: 'system',
    reason: input.reason, metadata: { productionBulletSource: input.source, canonicalProductionObligations: evidence.productionObligations },
    stateScope: evidence.state as 'production_complete' | 'closed',
  })).returning({ id: orderStatusEvents.id });
  await executor.insert(orderAuditLog).values({
    orderId: input.orderId, userId: input.actorUserId ?? null, userName: input.actorUserName || 'System',
    actionType: 'status_pill_changed', fromStatus: evidence.currentPillValue || '(none)', toStatus: target.name,
    note: `Production bullet synchronized to ${target.name} after canonical completion.`,
    metadata: { source: input.source, eventId: event.id, previousPillKey: evidence.currentPillKey, productionObligations: evidence.productionObligations },
  });
  return { changed: true, evidence, eventId: event.id, statusPillId: target.id };
}

/** Explicit historical repair. One named Order per call; no startup or bulk apply path. */
export async function reconcileHistoricalProductionBullet(input: {
  organizationId: string; orderId: string; actorUserId: string; actorUserName?: string | null; reason: string;
}) {
  return db.transaction(async (tx) => {
    const [locked] = await tx.select({ id: orders.id }).from(orders).where(and(
      eq(orders.organizationId, input.organizationId), eq(orders.id, input.orderId),
    )).for('update').limit(1);
    if (!locked) return { changed: false, before: null, after: null };
    await tx.select({ id: orderLineItems.id }).from(orderLineItems).where(eq(orderLineItems.orderId, input.orderId)).for('update');
    const result = await synchronizeCompletedProductionBulletInTransaction(tx, { ...input, source: 'explicit_reconciliation', historicalOnly: true });
    const after = await inspectProductionBullet(input.organizationId, input.orderId, tx);
    return { changed: result.changed, before: result.evidence, after };
  });
}

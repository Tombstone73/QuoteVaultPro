import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { auditLogs, fulfillmentEvents, invoices, orderLineItems, orders, productionJobs, productionRunMembers, productionRuns } from '@shared/schema';
import { ACTIVE_PRODUCTION_RUN_STATUSES } from '@shared/productionRunLifecycle';
import { isCanceledOrder } from '@shared/operationalState';
import { OPERATIONALLY_COMPLETE_STATUS } from '@shared/orderOperationalStatus';
import { FulfillmentDashboardRepo } from './fulfillment/repository';
import { isProvenLegacyCloseJobOverrideEvidence } from './fulfillment/legacyCloseJobOverrideEvidence';

type Runner = any; // Both runtime Neon and the operator CLI's native pg handle.

/** Read-only; callers may use a REPEATABLE READ / READ ONLY transaction. */
export async function previewHistoricalCloseJobOperationalRepair(runner: Runner, input: { organizationId: string; orderId: string }) {
  const { organizationId, orderId } = input;
  const [order] = await runner.select().from(orders).where(and(eq(orders.organizationId, organizationId), eq(orders.id, orderId))).limit(1);
  if (!order) throw new Error('Order not found in organization');
  const [events, audits, lines, invoiceRows, activeJobs, activeRuns] = await Promise.all([
    runner.select().from(fulfillmentEvents).where(and(eq(fulfillmentEvents.organizationId, organizationId), eq(fulfillmentEvents.entityType, 'ORDER'), eq(fulfillmentEvents.entityId, orderId))).orderBy(desc(fulfillmentEvents.createdAt)),
    runner.select().from(auditLogs).where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.entityType, 'order'), eq(auditLogs.entityId, orderId))),
    runner.select().from(orderLineItems).where(eq(orderLineItems.orderId, orderId)),
    runner.select({ status: invoices.status, balanceDue: invoices.balanceDue }).from(invoices).where(and(eq(invoices.organizationId, organizationId), eq(invoices.orderId, orderId))),
    runner.select({ id: productionJobs.id, stationKey: productionJobs.stationKey }).from(productionJobs).where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.orderId, orderId), sql`lower(coalesce(${productionJobs.status}, '')) not in ('done', 'void', 'canceled', 'cancelled')`)),
    runner.select({ id: productionRuns.id }).from(productionRuns)
      .innerJoin(productionRunMembers, eq(productionRunMembers.productionRunId, productionRuns.id))
      .innerJoin(orderLineItems, eq(orderLineItems.id, productionRunMembers.orderLineItemId))
      .where(and(eq(productionRuns.organizationId, organizationId), eq(orderLineItems.orderId, orderId), inArray(productionRuns.status, [...ACTIVE_PRODUCTION_RUN_STATUSES]))),
  ]);
  const audit = audits.find((row: any) => row.actionType === 'ORDER_HISTORICAL_FULFILLMENT_RECONCILED');
  const activeProductionJobs = activeJobs.filter((job: any) => String(job.stationKey || '').toLowerCase() !== 'fulfillment');
  const event = events.find((row: any) => isProvenLegacyCloseJobOverrideEvidence({ event: row, audit }));
  const projected = await new FulfillmentDashboardRepo(runner).listLineEligibility(organizationId, { orderIds: [orderId] }, runner);
  const remainingProductionQuantity = projected.reduce((sum, { projection: p }) => sum + (p.requiresFulfillment ? Math.max(0, p.orderedQuantity - p.productionCompleteQuantity) : 0), 0);
  const remainingFulfillmentQuantity = projected.reduce((sum, { projection: p }) => sum + p.remainingQuantity, 0);
  const alreadyCorrect = remainingProductionQuantity === 0 && remainingFulfillmentQuantity === 0 && activeJobs.length === 0 && activeRuns.length === 0
    && (order.state === 'closed' || (order.status === OPERATIONALLY_COMPLETE_STATUS && order.state === 'production_complete' && order.routingTarget == null && order.fulfillmentStatus === 'delivered'));
  const blockers: string[] = [];
  if (!event || !audit) blockers.push('UNPROVEN_SUCCESSFUL_OVERRIDE');
  if (isCanceledOrder(order)) blockers.push('ORDER_CANCELED');
  if (!['production_complete', 'closed'].includes(order.state)) blockers.push('PARENT_REOPENED_OR_INCONSISTENT');
  if (!['shipped', 'delivered'].includes(order.fulfillmentStatus)) blockers.push('FULFILLMENT_REOPENED_OR_INCONSISTENT');
  if (activeProductionJobs.length) blockers.push('ACTIVE_PRODUCTION_OWNER_CONFLICT');
  if (activeRuns.length) blockers.push('ACTIVE_COMBINED_RUN_CONFLICT');
  // Evidence predating subsequent edits cannot authorize completing new work.
  // Prefer staff review to guessing whether an edit was operational or clerical.
  if (!alreadyCorrect && event && lines.some((line: any) => new Date(line.updatedAt).getTime() > new Date(event.createdAt).getTime())) blockers.push('LINES_CHANGED_AFTER_OVERRIDE');
  if (remainingProductionQuantity > 0 && (!event?.actorUserId || order.state !== 'production_complete')) blockers.push('PRODUCTION_REPAIR_REQUIRES_ORIGINAL_ACTOR_AND_PARENT');
  if (!alreadyCorrect && projected.length !== lines.length) blockers.push('MISSING_CANONICAL_LINE_PROJECTION');
  return {
    organizationId, orderId, orderNumber: order.orderNumber, orderState: order.state, orderStatus: order.status,
    fulfillmentStatus: order.fulfillmentStatus, fulfillmentType: order.shippingMethod,
    evidence: event && audit ? { eventId: event.id, auditId: audit.id, actorUserId: event.actorUserId, createdAt: event.createdAt } : null,
    remainingProductionQuantity, remainingFulfillmentQuantity, activeProductionJobCount: activeProductionJobs.length,
    activeFulfillmentJobCount: activeJobs.length - activeProductionJobs.length,
    proposedOperationalStatus: order.state === 'closed' ? order.status : OPERATIONALLY_COMPLETE_STATUS,
    invoices: invoiceRows, alreadyCorrect, candidate: Boolean(event && audit && !alreadyCorrect), safe: blockers.length === 0, blockers,
  };
}

export async function listHistoricalCloseJobOperationalRepairs(runner: Runner, organizationId: string, orderId?: string) {
  // Discovery is evidence-first, never status-, age-, or payment-based.
  const rows = await runner.select({ orderId: fulfillmentEvents.entityId }).from(fulfillmentEvents).where(and(
    eq(fulfillmentEvents.organizationId, organizationId), eq(fulfillmentEvents.entityType, 'ORDER'),
    eq(fulfillmentEvents.eventType, 'FULFILLMENT_HISTORICAL_RECONCILED'),
    ...(orderId ? [eq(fulfillmentEvents.entityId, orderId)] : []),
  ));
  const ids = orderId ? [orderId] : Array.from(new Set<string>(rows.map((row: any) => row.orderId)));
  const previews = [];
  for (const id of ids) previews.push(await previewHistoricalCloseJobOperationalRepair(runner, { organizationId, orderId: id }));
  return previews;
}

export async function applyHistoricalCloseJobOperationalRepair(database: Runner, input: { organizationId: string; orderId: string }) {
  return database.transaction(async (tx: Runner) => {
    await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.organizationId, input.organizationId), eq(orders.id, input.orderId))).for('update');
    await tx.execute(sql`SELECT ${orderLineItems.id} FROM ${orderLineItems} WHERE ${orderLineItems.orderId} = ${input.orderId} FOR UPDATE`);
    const preview = await previewHistoricalCloseJobOperationalRepair(tx, input);
    if (!preview.evidence || !preview.safe) throw Object.assign(new Error(`Historical repair blocked: ${preview.blockers.join(', ')}`), { preview });
    if (preview.alreadyCorrect) return { status: 'already_correct' as const, preview };
    // Reuse the original production safety gates and canonical job completion.
    // Both phases share this transaction: fulfillment failure rolls production back.
    const transactionHandle = new Proxy(tx, { get(target, key) {
      if (key === 'transaction') return (callback: (runner: Runner) => unknown) => callback(tx);
      const value = target[key];
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    if (preview.remainingProductionQuantity > 0) {
      const { applyHistoricalCloseJobProductionRepair } = await import('./historicalCloseJobProductionRepairService');
      await applyHistoricalCloseJobProductionRepair(transactionHandle, input);
    }
    const { FulfillmentService } = await import('./fulfillment/service');
    const service = new FulfillmentService({ dbInstance: transactionHandle, dashboardRepo: new FulfillmentDashboardRepo(tx), autoCloseReconciler: async () => null });
    await service.reconcileHistoricalFulfillment(input.organizationId, {
      orderId: input.orderId, actorUserId: preview.evidence.actorUserId,
      reason: 'historical_backlog_cleanup',
      note: `Historical operational repair; original event ${preview.evidence.eventId}, audit ${preview.evidence.auditId}.`,
    });
    return { status: 'applied' as const, preview };
  });
}

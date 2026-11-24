import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { canEditFulfillmentHistoryNotes } from '@shared/fulfillmentHistoryNote';
import { isCanceledOrder, isTerminalProductionStatus } from '@shared/operationalState';
import type { FulfillmentProductionOverrideLine, FulfillmentProductionOverrideRequest } from '@shared/fulfillmentProductionOverride';
import {
  fulfillmentEvents, orderLineItems, orders, productionJobs, productionRunMembers,
  productionStationSteps,
} from '@shared/schema';
import { db } from '../../db';
import { completeProductionJobWorkflow } from '../../routes/productionJobs.routes';
import { getProductionConfigForOrganization } from '../../routes/production.shared';
import { resolveProductionCompletionRoute } from '../productionCompletionRouting';
import { isDesignOwnershipJob, isPrepressOwnershipJob } from '../productionOwnership';
import { applyWorkflowStatusPillFailSoft } from '../workflowStatusPillService';
import { FulfillmentDashboardRepo, resolveExistingActorUserId } from './repository';
import { FulfillmentHttpError } from './types';

export type FulfillmentProductionCompletionInput = {
  organizationId: string;
  orderId: string;
  lineItemId: string;
  jobId: string;
  quantity: number;
  clientRequestId: string;
  actorUserId: string;
  actorOrgRole: string | null;
  actorUserName?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

function blocked(code: string, message: string): never {
  throw new FulfillmentHttpError(409, message, code);
}

type OverrideActor = Omit<FulfillmentProductionCompletionInput, 'lineItemId' | 'jobId' | 'quantity' | 'clientRequestId'>;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function assertFulfillmentOperator(role: string | null) {
  if (!canEditFulfillmentHistoryNotes(role)) {
    throw new FulfillmentHttpError(403, 'Fulfillment operator permission is required.', 'FULFILLMENT_PRODUCTION_FORBIDDEN');
  }
}

async function readOverrideLines(input: Pick<OverrideActor, 'organizationId' | 'orderId'>, executor: typeof db | Transaction) {
  const { organizationId, orderId } = input;
  const [order] = await executor.select({ state: orders.state, status: orders.status, canceledAt: orders.canceledAt })
    .from(orders).where(and(eq(orders.organizationId, organizationId), eq(orders.id, orderId))).limit(1);
  if (!order) throw new FulfillmentHttpError(404, 'Order not found.', 'ORDER_NOT_FOUND');
  if (isCanceledOrder(order)) return [];

  const lines = await new FulfillmentDashboardRepo().listLineEligibility(organizationId, { orderIds: [orderId] }, executor);
  const physical = lines.filter(({ projection }) => projection.requiresFulfillment && projection.notReadyQuantity > 0);
  if (!physical.length) return [];
  const lineIds = physical.map(line => line.id);
  const [jobs, members, config, steps] = await Promise.all([
    executor.select().from(productionJobs).where(and(
      eq(productionJobs.organizationId, organizationId), eq(productionJobs.orderId, orderId), inArray(productionJobs.lineItemId, lineIds),
    )),
    executor.selectDistinct({ lineItemId: productionRunMembers.orderLineItemId }).from(productionRunMembers).where(and(
      eq(productionRunMembers.organizationId, organizationId), inArray(productionRunMembers.orderLineItemId, lineIds),
    )),
    getProductionConfigForOrganization(organizationId, executor),
    executor.select().from(productionStationSteps).where(and(
      eq(productionStationSteps.organizationId, organizationId), eq(productionStationSteps.active, true),
    )),
  ]);
  const runLineIds = new Set(members.map(member => member.lineItemId));
  const stepTriggers = new Map(steps.map(step => [`${step.stationKey}/${step.key}`, step.triggers]));
  const activeJobsByLine = new Map<string, typeof jobs>();
  for (const job of jobs) {
    if (!job.lineItemId || isTerminalProductionStatus(job.status) || job.stationKey.toLowerCase() === 'fulfillment') continue;
    const owners = activeJobsByLine.get(job.lineItemId) ?? [];
    owners.push(job);
    activeJobsByLine.set(job.lineItemId, owners);
  }
  return physical.flatMap(({ id, productName, projection }) => {
    const { orderedQuantity, productionCompleteQuantity, operationallyFulfilledQuantity, readyWaitingQuantity, notReadyQuantity } = projection;
    const outstandingQuantity = orderedQuantity - productionCompleteQuantity;
    const missingReady = Math.max(0, productionCompleteQuantity - operationallyFulfilledQuantity - readyWaitingQuantity);
    const owners = activeJobsByLine.get(id) ?? [];
    const candidate = projection.productionRequired && owners.length === 1 && !runLineIds.has(id) ? owners[0] : null;
    const route = candidate && resolveProductionCompletionRoute({
      stationKey: candidate.stationKey, stepKey: candidate.stepKey, finishingMode: config.finishingMode,
      triggers: stepTriggers.get(`${candidate.stationKey}/${candidate.stepKey}`) ?? [],
    });
    const job = candidate && route && route.kind === 'route' && route.route.stationKey === 'fulfillment' &&
      !isDesignOwnershipJob(candidate) && !isPrepressOwnershipJob(candidate) && candidate.stationKey.trim().toLowerCase() !== 'proofing' &&
      productionCompleteQuantity >= operationallyFulfilledQuantity + readyWaitingQuantity ? candidate : null;
    const maximumQuantity = Math.min(notReadyQuantity, missingReady + (job ? outstandingQuantity : 0));
    if (maximumQuantity <= 0) return [];
    const revision = createHash('sha256').update(JSON.stringify({
      id, orderedQuantity, productionCompleteQuantity, operationallyFulfilledQuantity, readyWaitingQuantity, maximumQuantity,
      job: job ? [job.id, job.status, job.updatedAt] : null,
    })).digest('hex');
    const line: FulfillmentProductionOverrideLine = {
      lineItemId: id, name: productName, productionRequired: projection.productionRequired,
      orderedQuantity, productionCompleteQuantity, outstandingQuantity, maximumQuantity, revision,
    };
    return [{ line, job, missingReady, readyWaitingQuantity }];
  });
}

export async function previewFulfillmentProductionOverride(input: Pick<OverrideActor, 'organizationId' | 'orderId' | 'actorOrgRole'>) {
  assertFulfillmentOperator(input.actorOrgRole);
  return (await readOverrideLines(input, db)).map(entry => entry.line);
}

export async function completeSelectedProductionFromFulfillment(input: OverrideActor & FulfillmentProductionOverrideRequest) {
  assertFulfillmentOperator(input.actorOrgRole);
  const { organizationId, orderId, actorUserId, clientRequestId } = input;
  const items = [...input.items].sort((a, b) => a.lineItemId.localeCompare(b.lineItemId));
  const requestHash = createHash('sha256').update(JSON.stringify(items)).digest('hex');
  const result = await db.transaction(async tx => {
    const safeActorUserId = await resolveExistingActorUserId(tx, actorUserId);
    if (!safeActorUserId) throw new FulfillmentHttpError(401, 'Staff account not found.', 'FULFILLMENT_PRODUCTION_ACTOR_REQUIRED');
    // Acquire existing production owners before readiness's sorted line locks.
    // The job locks coordinate with Production completion and run allocation.
    await tx.select({ id: productionJobs.id }).from(productionJobs).where(and(
      eq(productionJobs.organizationId, organizationId), eq(productionJobs.orderId, orderId),
      inArray(productionJobs.lineItemId, items.map(item => item.lineItemId)),
      sql`lower(${productionJobs.stationKey}) <> 'fulfillment'`,
    )).orderBy(productionJobs.lineItemId, productionJobs.id).for('update');
    const [order] = await tx.select({ id: orders.id }).from(orders).where(and(
      eq(orders.organizationId, organizationId), eq(orders.id, orderId),
    )).for('no key update');
    if (!order) throw new FulfillmentHttpError(404, 'Order not found.', 'ORDER_NOT_FOUND');
    await tx.select({ id: orderLineItems.id }).from(orderLineItems)
      .innerJoin(orders, eq(orders.id, orderLineItems.orderId)).where(and(
        eq(orders.organizationId, organizationId), eq(orders.id, orderId),
      )).orderBy(orderLineItems.id).for('update', { of: orderLineItems });
    const [prior] = await tx.select({ actorUserId: fulfillmentEvents.actorUserId, payload: fulfillmentEvents.payloadJson })
      .from(fulfillmentEvents).where(and(
        eq(fulfillmentEvents.organizationId, organizationId), eq(fulfillmentEvents.entityType, 'ORDER'),
        eq(fulfillmentEvents.entityId, orderId), eq(fulfillmentEvents.eventType, 'FULFILLMENT_PRODUCTION_COMPLETED'),
        sql`${fulfillmentEvents.payloadJson}->>'clientRequestId' = ${clientRequestId}`,
      )).limit(1);
    if (prior) {
      if (prior.actorUserId !== actorUserId || prior.payload?.requestHash !== requestHash) {
        blocked('PRODUCTION_COMPLETION_REQUEST_CONFLICT', 'This request ID was already used for different production work.');
      }
      return { replayed: true, handedOff: [] };
    }
    const available = new Map((await readOverrideLines(input, tx)).map(entry => [entry.line.lineItemId, entry]));
    const handedOff: Array<{ lineItemId: string; jobId: string }> = [];
    const evidence = [];
    for (const item of items) {
      const entry = available.get(item.lineItemId);
      if (!entry || item.revision !== entry.line.revision || item.quantity > entry.line.maximumQuantity) {
        blocked('PRODUCTION_COMPLETION_STALE', 'Production or ready quantities changed. Reopen the override and review the available quantities.');
      }
      const newProduction = Math.max(0, item.quantity - entry.missingReady);
      if (newProduction > 0) {
        if (!entry.job) blocked('PRODUCTION_LINE_INELIGIBLE', 'This line must be completed in Production.');
        const completed = await completeProductionJobWorkflow(tx, {
          organizationId, userId: actorUserId, jobId: entry.job.id, skipProduction: false,
          fulfillmentCompletion: { quantity: newProduction, clientRequestId, standaloneRemainingQuantity: entry.line.outstandingQuantity },
          auditUserName: input.actorUserName, ipAddress: input.ipAddress, userAgent: input.userAgent,
        });
        if (completed.nextStationKey === 'fulfillment') handedOff.push({ lineItemId: item.lineItemId, jobId: entry.job.id });
      }
      evidence.push({ lineItemId: item.lineItemId, quantity: item.quantity, newProduction,
        jobId: entry.job?.id ?? null, previousProductionQuantity: entry.line.productionCompleteQuantity,
        previousReadyQuantity: entry.readyWaitingQuantity });
    }
    const repo = new FulfillmentDashboardRepo();
    const adjustment = await repo.adjustReadyQuantitiesInTransaction(tx, organizationId, orderId,
      items.map(item => ({ orderLineItemId: item.lineItemId, quantityDelta: item.quantity })), actorUserId,
      'Physical production completion override in Fulfillment', 'fulfillment_production_override', { requireProductionComplete: true });
    if (!adjustment.ok) blocked(adjustment.code, adjustment.message);
    const saved = new Map((await repo.listLineEligibility(organizationId, { lineItemIds: items.map(item => item.lineItemId) }, tx))
      .map(entry => [entry.id, entry.projection]));
    for (const item of evidence) {
      const line = saved.get(item.lineItemId);
      if (!line || line.readyWaitingQuantity !== item.previousReadyQuantity + item.quantity ||
          line.productionCompleteQuantity !== item.previousProductionQuantity + item.newProduction) {
        blocked('FULFILLMENT_READBACK_MISMATCH', 'Fulfillment readiness did not match completed production. No changes were saved.');
      }
    }
    await tx.insert(fulfillmentEvents).values({
      organizationId, actorUserId: safeActorUserId, entityType: 'ORDER', entityId: orderId,
      eventType: 'FULFILLMENT_PRODUCTION_COMPLETED',
      payloadJson: { source: 'fulfillment_production_override', requestHash, clientRequestId, orderId, items: evidence,
        completedAt: new Date().toISOString() },
    });
    const [parent] = await tx.select({ state: orders.state }).from(orders).where(and(
      eq(orders.organizationId, organizationId), eq(orders.id, orderId),
    ));
    return { replayed: false, handedOff: parent?.state === 'production_complete' ? handedOff.slice(-1) : [] };
  });
  for (const line of result.handedOff) {
    await applyWorkflowStatusPillFailSoft({ organizationId, orderId, triggerKey: 'sent_to_fulfillment', actorUserId, source: 'system',
      reason: 'Production completion routed work to fulfillment',
      metadata: { workflowEvent: 'sent_to_fulfillment', productionJobId: line.jobId, lineItemId: line.lineItemId, source: 'fulfillment' } });
  }
  return { replayed: result.replayed };
}

/** One full-line standalone production completion and readiness confirmation. */
export async function completeProductionFromFulfillment(input: FulfillmentProductionCompletionInput) {
  assertFulfillmentOperator(input.actorOrgRole);

  const result = await db.transaction(async (tx) => {
    // Production's normal completion path uses this same job lock. It serializes
    // repeated clicks and competing Production/Fulfillment completions.
    const [job] = await tx.select().from(productionJobs).where(and(
      eq(productionJobs.organizationId, input.organizationId),
      eq(productionJobs.orderId, input.orderId),
      eq(productionJobs.lineItemId, input.lineItemId),
      eq(productionJobs.id, input.jobId),
    )).for('update').limit(1);
    if (!job) throw new FulfillmentHttpError(404, 'Production job was not found on this order line.', 'PRODUCTION_JOB_NOT_FOUND');

    const [prior] = await tx.select({ payloadJson: fulfillmentEvents.payloadJson, actorUserId: fulfillmentEvents.actorUserId })
      .from(fulfillmentEvents).where(and(
        eq(fulfillmentEvents.organizationId, input.organizationId),
        eq(fulfillmentEvents.entityType, 'ORDER'),
        eq(fulfillmentEvents.entityId, input.orderId),
        eq(fulfillmentEvents.eventType, 'FULFILLMENT_PRODUCTION_COMPLETED'),
        sql`${fulfillmentEvents.payloadJson}->>'clientRequestId' = ${input.clientRequestId}`,
      )).limit(1);
    if (prior) {
      if (prior.actorUserId !== input.actorUserId || job.status !== 'done' ||
          prior.payloadJson?.lineItemId !== input.lineItemId || prior.payloadJson?.jobId !== input.jobId ||
          Number(prior.payloadJson?.quantity) !== input.quantity) {
        blocked('PRODUCTION_COMPLETION_REQUEST_CONFLICT', 'This request ID was already used for different production work.');
      }
      return { replayed: true, productionJobId: job.id, orderId: input.orderId, lineItemId: input.lineItemId };
    }

    if (job.status === 'done') blocked('PRODUCTION_ALREADY_COMPLETED', 'Production was already completed. Refresh Fulfillment before confirming readiness.');
    if (isTerminalProductionStatus(job.status)) blocked('PRODUCTION_JOB_TERMINAL', 'Canceled or void production work cannot be completed.');

    const [order] = await tx.select({ state: orders.state, status: orders.status, canceledAt: orders.canceledAt })
      .from(orders).where(and(eq(orders.organizationId, input.organizationId), eq(orders.id, input.orderId))).limit(1);
    if (!order) throw new FulfillmentHttpError(404, 'Order not found.', 'ORDER_NOT_FOUND');
    if (isCanceledOrder(order)) blocked('ORDER_CANCELLED', 'Canceled orders cannot complete production.');

    const [line] = await tx.select({ quantity: orderLineItems.quantity, productionBypassed: orderLineItems.productionBypassed,
      workflowState: orderLineItems.workflowState, status: orderLineItems.status })
      .from(orderLineItems).where(and(eq(orderLineItems.orderId, input.orderId), eq(orderLineItems.id, input.lineItemId)))
      .for('update').limit(1);
    if (!line) throw new FulfillmentHttpError(404, 'Order line not found.', 'LINE_ITEM_NOT_FOUND');
    if (line.productionBypassed || line.workflowState === 'canceled' || line.status === 'canceled') {
      blocked('PRODUCTION_LINE_INELIGIBLE', 'This line cannot be completed from Fulfillment.');
    }

    const [runMember] = await tx.select({ id: productionRunMembers.id })
      .from(productionRunMembers).where(and(
        eq(productionRunMembers.organizationId, input.organizationId),
        eq(productionRunMembers.orderLineItemId, input.lineItemId),
      )).limit(1);
    if (runMember) blocked('COMBINED_RUN_COMPLETION_REQUIRED', 'This job belongs to a production run. Record its results in Production so the other members and material history stay intact.');

    const activeJobs = await tx.select({ id: productionJobs.id, stationKey: productionJobs.stationKey, status: productionJobs.status })
      .from(productionJobs).where(and(
        eq(productionJobs.organizationId, input.organizationId),
        eq(productionJobs.orderId, input.orderId),
        eq(productionJobs.lineItemId, input.lineItemId),
      ));
    if (activeJobs.some((other) => other.id !== job.id && !isTerminalProductionStatus(other.status) &&
        String(other.stationKey || '').toLowerCase() !== 'fulfillment')) {
      blocked('MULTIPLE_PRODUCTION_OWNERS', 'Another active production job owns this line. Resolve its production work first.');
    }

    const [step] = await tx.select({ triggers: productionStationSteps.triggers })
      .from(productionStationSteps).where(and(
        eq(productionStationSteps.organizationId, input.organizationId),
        eq(productionStationSteps.stationKey, String(job.stationKey ?? '')),
        eq(productionStationSteps.key, String(job.stepKey ?? 'queued')),
        eq(productionStationSteps.active, true),
      )).limit(1);
    const config = await getProductionConfigForOrganization(input.organizationId);
    const route = resolveProductionCompletionRoute({ stationKey: job.stationKey, stepKey: job.stepKey,
      finishingMode: config.finishingMode, triggers: step?.triggers ?? [] });
    if (route.kind !== 'route' || route.route.stationKey !== 'fulfillment') {
      blocked('PRODUCTION_ROUTE_NOT_FINAL', 'This production step does not route directly to Fulfillment. Complete its remaining station work in Production.');
    }

    const repo = new FulfillmentDashboardRepo(tx as any);
    const before = (await repo.listLineEligibility(input.organizationId, { lineItemIds: [input.lineItemId] }, tx as any))[0]?.projection;
    if (!before?.requiresFulfillment || !before.productionRequired || before.orderedQuantity <= 0) {
      blocked('PRODUCTION_LINE_INELIGIBLE', 'This order line does not require physical production and fulfillment.');
    }
    if (before.fulfilledQuantity > 0) {
      blocked('FULFILLMENT_HISTORY_CONFLICT', 'This line already has fulfillment history. Use the supported correction workflow before changing its production completion.');
    }
    if (before.productionCompleteQuantity !== 0) {
      blocked('PARTIAL_PRODUCTION_UNSUPPORTED', 'This line already has quantity-level production results. Complete it through its existing Production workflow.');
    }
    if (input.quantity !== before.orderedQuantity) {
      blocked('PARTIAL_PRODUCTION_UNSUPPORTED', `Standalone production completion currently requires the full remaining quantity (${before.orderedQuantity}). Partial quantities need the Production run workflow.`);
    }

    const previousJobStatus = job.status;
    const previousLineWorkflowState = line.workflowState;
    const completed = await completeProductionJobWorkflow(tx, {
      organizationId: input.organizationId, userId: input.actorUserId, jobId: job.id,
      skipProduction: false,
      fulfillmentCompletion: { quantity: input.quantity, clientRequestId: input.clientRequestId },
      auditUserName: input.actorUserName, ipAddress: input.ipAddress, userAgent: input.userAgent,
    });
    if (completed.nextStationKey !== 'fulfillment') blocked('PRODUCTION_ROUTE_CHANGED', 'Production routing changed before completion; refresh and try again.');

    const afterProduction = (await repo.listLineEligibility(input.organizationId, { lineItemIds: [input.lineItemId] }, tx as any))[0]?.projection;
    if (!afterProduction || afterProduction.productionCompleteQuantity !== before.orderedQuantity) {
      blocked('PRODUCTION_READBACK_MISMATCH', 'Production completion did not produce the expected line quantity. No changes were saved.');
    }
    const readyDelta = Math.max(0, afterProduction.remainingQuantity - afterProduction.readyWaitingQuantity);
    if (readyDelta > 0) {
      const adjustment = await repo.adjustReadyQuantitiesInTransaction(tx, input.organizationId, input.orderId,
        [{ orderLineItemId: input.lineItemId, quantityDelta: readyDelta }], input.actorUserId,
        'Physical production completed in Fulfillment', 'fulfillment_production_completion');
      if (!adjustment.ok) blocked(adjustment.code, adjustment.message);
    }
    const after = (await repo.listLineEligibility(input.organizationId, { lineItemIds: [input.lineItemId] }, tx as any))[0]?.projection;
    if (!after || after.productionCompleteQuantity !== before.orderedQuantity ||
        after.readyWaitingQuantity !== after.remainingQuantity) {
      blocked('FULFILLMENT_READBACK_MISMATCH', 'Fulfillment readiness did not match completed production. No changes were saved.');
    }
    const [savedLine] = await tx.select({ workflowState: orderLineItems.workflowState })
      .from(orderLineItems).where(and(eq(orderLineItems.orderId, input.orderId), eq(orderLineItems.id, input.lineItemId))).limit(1);

    await tx.insert(fulfillmentEvents).values({ organizationId: input.organizationId, actorUserId: input.actorUserId,
      entityType: 'ORDER', entityId: input.orderId, eventType: 'FULFILLMENT_PRODUCTION_COMPLETED',
      payloadJson: { source: 'fulfillment', clientRequestId: input.clientRequestId, orderId: input.orderId,
        lineItemId: input.lineItemId, jobId: job.id, quantity: input.quantity,
        previousProductionState: { jobStatus: previousJobStatus, lineWorkflowState: previousLineWorkflowState,
          productionCompleteQuantity: before.productionCompleteQuantity, readyWaitingQuantity: before.readyWaitingQuantity },
        newProductionState: { jobStatus: completed.status, lineWorkflowState: savedLine?.workflowState ?? null,
          productionCompleteQuantity: after.productionCompleteQuantity,
          readyWaitingQuantity: after.readyWaitingQuantity }, completedAt: new Date().toISOString() } });
    return { replayed: false, productionJobId: job.id, orderId: input.orderId, lineItemId: input.lineItemId };
  });

  if (!result.replayed) {
    await applyWorkflowStatusPillFailSoft({ organizationId: input.organizationId, orderId: input.orderId,
      triggerKey: 'sent_to_fulfillment', actorUserId: input.actorUserId, source: 'system',
      reason: 'Production completion routed work to fulfillment',
      metadata: { workflowEvent: 'sent_to_fulfillment', productionJobId: result.productionJobId,
        lineItemId: input.lineItemId, source: 'fulfillment' } });
  }
  return result;
}

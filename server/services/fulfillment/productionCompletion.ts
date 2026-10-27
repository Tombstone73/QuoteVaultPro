import { and, eq, sql } from 'drizzle-orm';
import { canEditFulfillmentHistoryNotes } from '@shared/fulfillmentHistoryNote';
import { isCanceledOrder, isTerminalProductionStatus } from '@shared/operationalState';
import {
  fulfillmentEvents, orderLineItems, orders, productionJobs, productionRunMembers,
  productionStationSteps,
} from '@shared/schema';
import { db } from '../../db';
import { completeProductionJobWorkflow } from '../../routes/productionJobs.routes';
import { getProductionConfigForOrganization } from '../../routes/production.shared';
import { resolveProductionCompletionRoute } from '../productionCompletionRouting';
import { applyWorkflowStatusPillFailSoft } from '../workflowStatusPillService';
import { FulfillmentDashboardRepo } from './repository';
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

/** One full-line standalone production completion and readiness confirmation. */
export async function completeProductionFromFulfillment(input: FulfillmentProductionCompletionInput) {
  if (!canEditFulfillmentHistoryNotes(input.actorOrgRole)) {
    throw new FulfillmentHttpError(403, 'Fulfillment operator permission is required.', 'FULFILLMENT_PRODUCTION_FORBIDDEN');
  }

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

import { createHash } from 'node:crypto';
import { and, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import { canEditFulfillmentHistoryNotes } from '@shared/fulfillmentHistoryNote';
import { isCanceledOrder, isTerminalProductionStatus } from '@shared/operationalState';
import { normalizeOrganizationRole } from '@shared/organizationRoleAuthority';
import { ACTIVE_PRODUCTION_RUN_STATUSES } from '@shared/productionRunLifecycle';
import type { FulfillmentProductionOverrideLine, FulfillmentProductionOverrideRequest } from '@shared/fulfillmentProductionOverride';
import {
  fulfillmentEvents, inventoryReservations, orderLineItems, orders, prepressSessions, products, productionJobs,
  productionRunMembers, productionRuns, productionStationSteps,
} from '@shared/schema';
import { db } from '../../db';
import { completeProductionJobWorkflow, markOrderReadyForFulfillmentIfProductionComplete } from '../../routes/productionJobs.routes';
import { getProductionConfigForOrganization } from '../../routes/production.shared';
import { canonicalProductionOperations } from '../canonicalProductionOperations';
import { getOrderCreditHold } from '../orderCreditHoldService';
import { lockOrderProductionOverrideLines, productionOverrideRetryError } from '../orderProductionOverrideBoundary';
import { resolveLineItemProofReleaseGate } from '../proofGateService';
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

const activePrepressStates = new Set(['ready_for_prepress', 'in_prepress']);
const trackedLineStates = new Set(['ready_for_production', 'in_production']);
const unresolvedDesignStates = ['needs_design', 'in_design'];
const explicitDesignStates = new Set([...unresolvedDesignStates, 'design_complete', 'bypassed']);
const retiredLineStates = new Set(['canceled', 'cancelled', 'void', 'voided']);

function workflowLabel(value: string) {
  const label = value.replace(/[_-]/g, ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

async function readOverrideLines(input: Pick<OverrideActor, 'organizationId' | 'orderId' | 'actorOrgRole'>, executor: typeof db | Transaction) {
  const { organizationId, orderId } = input;
  const [order] = await executor.select({ state: orders.state, status: orders.status, canceledAt: orders.canceledAt })
    .from(orders).where(and(eq(orders.organizationId, organizationId), eq(orders.id, orderId))).limit(1);
  if (!order) throw new FulfillmentHttpError(404, 'Order not found.', 'ORDER_NOT_FOUND');

  const candidates = await executor.select({
    id: orderLineItems.id, workflowState: orderLineItems.workflowState, status: orderLineItems.status,
    designStatus: orderLineItems.designStatus, requiresDesign: orderLineItems.requiresDesign,
    productionBypassed: orderLineItems.productionBypassed, role: orderLineItems.lineItemRole,
    updatedAt: orderLineItems.updatedAt,
  }).from(orderLineItems)
    .innerJoin(products, and(eq(products.id, orderLineItems.productId), eq(products.organizationId, organizationId)))
    .where(and(eq(orderLineItems.orderId, orderId), eq(products.requiresProductionJob, true),
      notInArray(products.workflowIntent, ['service_fee', 'fulfillment_only'])))
    .orderBy(orderLineItems.createdAt, orderLineItems.id);
  const physical = candidates.filter(line => line.role !== 'parent');
  if (!physical.length) return [];
  const lineIds = physical.map(line => line.id);
  const [eligibility, jobs, members, config, steps, sessions, reservations] = await Promise.all([
    new FulfillmentDashboardRepo().listLineEligibility(organizationId, { lineItemIds: lineIds }, executor),
    executor.select().from(productionJobs).where(and(
      eq(productionJobs.organizationId, organizationId), eq(productionJobs.orderId, orderId), inArray(productionJobs.lineItemId, lineIds),
    )).orderBy(productionJobs.id),
    executor.select({ lineItemId: productionRunMembers.orderLineItemId, runNumber: productionRuns.runNumber })
      .from(productionRunMembers).innerJoin(productionRuns, eq(productionRuns.id, productionRunMembers.productionRunId)).where(and(
        eq(productionRunMembers.organizationId, organizationId), eq(productionRuns.organizationId, organizationId),
        inArray(productionRunMembers.orderLineItemId, lineIds), inArray(productionRuns.status, [...ACTIVE_PRODUCTION_RUN_STATUSES]),
      )).orderBy(productionRuns.runNumber),
    getProductionConfigForOrganization(organizationId, executor),
    executor.select().from(productionStationSteps).where(and(
      eq(productionStationSteps.organizationId, organizationId), eq(productionStationSteps.active, true),
    )),
    executor.select({ lineItemId: prepressSessions.lineItemId }).from(prepressSessions).where(and(
      eq(prepressSessions.organizationId, organizationId), eq(prepressSessions.orderId, orderId), eq(prepressSessions.status, 'active'),
      inArray(prepressSessions.lineItemId, lineIds),
    )),
    executor.select({ lineItemId: inventoryReservations.orderLineItemId }).from(inventoryReservations).where(and(
      eq(inventoryReservations.organizationId, organizationId), eq(inventoryReservations.orderId, orderId),
      eq(inventoryReservations.status, 'RESERVED'),
      or(isNull(inventoryReservations.orderLineItemId), inArray(inventoryReservations.orderLineItemId, lineIds)),
    )),
  ]);
  const projectionByLine = new Map(eligibility.map(entry => [entry.id, entry]));
  const runByLine = new Map(members.map(member => [member.lineItemId, member.runNumber]));
  const activePrepress = new Set(sessions.map(session => session.lineItemId));
  const reserved = new Set(reservations.map(reservation => reservation.lineItemId));
  const stepTriggers = new Map(steps.map(step => [step.stationKey + '/' + step.key, step.triggers]));
  const activeJobsByLine = new Map<string, typeof jobs>();
  for (const job of jobs) {
    if (!job.lineItemId || isTerminalProductionStatus(job.status)) continue;
    const owners = activeJobsByLine.get(job.lineItemId) ?? [];
    owners.push(job);
    activeJobsByLine.set(job.lineItemId, owners);
  }

  const creditBlocked = 'Resolve the Order credit hold through the existing authorized credit workflow before completing production.';
  let creditCheck: Promise<string | null> | undefined;
  function readCreditBlock() {
    return creditCheck ??= getOrderCreditHold(executor, { organizationId, orderId }).then(({ creditHold }) =>
      creditHold.held ? creditBlocked : null,
    ).catch((error: unknown) => {
      if (error instanceof Error && 'statusCode' in error && error.statusCode === 409) return creditBlocked;
      throw error;
    });
  }
  const role = normalizeOrganizationRole(input.actorOrgRole);
  const canBypassPrepress = role === 'owner' || role === 'admin';
  return (await Promise.all(physical.map(async lineItem => {
    const { id, workflowState, status, designStatus, productionBypassed, updatedAt } = lineItem;
    const eligible = projectionByLine.get(id);
    if (!eligible) return null;
    const { productName, projection } = eligible;
    const { orderedQuantity, productionCompleteQuantity, operationallyFulfilledQuantity, readyWaitingQuantity, notReadyQuantity } = projection;
    const outstandingQuantity = orderedQuantity - productionCompleteQuantity;
    const owners = activeJobsByLine.get(id) ?? [];
    const job = owners.length === 1 && owners[0].stationKey.trim().toLowerCase() !== 'fulfillment' ? owners[0] : null;
    const route = job && resolveProductionCompletionRoute({
      stationKey: job.stationKey, stepKey: job.stepKey, finishingMode: config.finishingMode,
      triggers: stepTriggers.get(job.stationKey + '/' + job.stepKey) ?? [],
    });
    const tracked = Boolean(job && route?.kind === 'route' && route.route.stationKey === 'fulfillment'
      && !isPrepressOwnershipJob(job) && !isDesignOwnershipJob(job) && job.stationKey.trim().toLowerCase() !== 'proofing'
      && order.state === 'open' && (order.status === 'in_production' || order.status === 'new' && trackedLineStates.has(workflowState)));
    const effectiveDesignState = explicitDesignStates.has(designStatus ?? '') ? designStatus : workflowState;
    const terminalLine = retiredLineStates.has(workflowState) || retiredLineStates.has(status);
    const orderBlocked = isCanceledOrder(order) ? 'Canceled Orders cannot change production or readiness.'
      : order.state === 'closed' || order.status === 'operationally_complete'
        ? 'Use the authorized historical correction workflow for this completed Order.' : null;
    let blockedReason = orderBlocked
      ?? (terminalLine ? 'Canceled or void lines cannot change production or readiness.' : null)
      ?? (productionBypassed ? 'Production was bypassed for this line. Use the existing Fulfillment readiness workflow.' : null)
      ?? (!projection.requiresFulfillment ? 'This line has no fulfillable quantity.' : null)
      ?? (notReadyQuantity <= 0 ? 'No units remain to be marked ready.' : null)
      ?? (productionCompleteQuantity < operationallyFulfilledQuantity + readyWaitingQuantity
        ? 'Previously fulfilled or ready quantities exceed recorded production. Review the line through the authorized correction workflow.' : null);

    const missingReady = blockedReason ? 0 : Math.max(0, productionCompleteQuantity - operationallyFulfilledQuantity - readyWaitingQuantity);
    let productionAction: 'tracked_completion' | 'administrative_completion' | null = null;
    if (!blockedReason && outstandingQuantity > 0) {
      const runNumber = runByLine.get(id);
      const station = job?.stationKey.trim().toLowerCase();
      blockedReason = runNumber !== undefined
        ? 'Combined Run ' + runNumber + ' still owns this line. Record its outcome or return the member from Combined Runs.'
        : owners.length > 1 ? 'Multiple active production owners must be reconciled in Production first.'
        : owners.length && !job ? 'Fulfillment already owns this line. Reconcile its production history before recording more units.'
        : workflowState === 'on_hold' ? 'This line is on hold. Resume it through its existing workflow before completing more production.'
        : activePrepress.has(id) ? 'Resolve the active Prepress session in Prepress before completing this line.'
        : isDesignOwnershipJob(job) || unresolvedDesignStates.includes(effectiveDesignState ?? '')
          || (lineItem.requiresDesign && !['design_complete', 'bypassed'].includes(designStatus ?? '') && workflowState === 'new')
          ? 'Complete Design through its own workflow before confirming production.'
        : station === 'proofing' ? 'Resolve the active Proofing job through its own workflow before confirming production.'
        : (isPrepressOwnershipJob(job) || activePrepressStates.has(workflowState)) && !canBypassPrepress
          ? 'Only an Organization Owner or Admin may bypass Prepress. Continue in Prepress or ask an authorized supervisor.'
        : !tracked && (reserved.has(id) || reserved.has(null))
          ? 'Resolve open material reservations in Inventory or finish through tracked Production before using direct completion.'
        : null;
      if (!blockedReason && (!tracked || !job?.startedAt)) {
        const proof = await resolveLineItemProofReleaseGate(executor, { organizationId, lineItemId: id });
        blockedReason = proof.allowed ? await readCreditBlock()
          : 'Resolve the required proof approval in Proofing before completing production.';
      }
      if (!blockedReason) productionAction = tracked ? 'tracked_completion' : 'administrative_completion';
    }
    const maximumQuantity = Math.min(notReadyQuantity, missingReady + (productionAction ? outstandingQuantity : 0));
    const action = productionAction ?? (maximumQuantity > 0 ? 'confirm_readiness' : 'blocked');
    const statusLabel = terminalLine ? 'Canceled or void'
      : job ? workflowLabel(job.stationKey) + ' · ' + workflowLabel(job.status)
      : productionBypassed ? 'Production bypassed'
      : productionCompleteQuantity === orderedQuantity && orderedQuantity > 0 ? 'Production complete'
      : productionCompleteQuantity > 0 ? 'Partially production-complete'
      : ['new', 'ready_for_production'].includes(workflowState) ? 'Production not started'
      : workflowLabel(workflowState);
    const revision = createHash('sha256').update(JSON.stringify({
      id, order, updatedAt, orderedQuantity, productionCompleteQuantity, operationallyFulfilledQuantity, readyWaitingQuantity,
      maximumQuantity, action, blockedReason, route, owners: owners.map(owner => [owner.id, owner.stationKey, owner.stepKey, owner.status, owner.updatedAt]),
    })).digest('hex');
    const line: FulfillmentProductionOverrideLine = {
      lineItemId: id, name: productName, productionRequired: !productionBypassed,
      orderedQuantity, productionCompleteQuantity, outstandingQuantity, maximumQuantity, revision, statusLabel, action, blockedReason,
    };
    return { line, job, missingReady, readyWaitingQuantity, productionAction };
  }))).filter(entry => entry !== null);
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
    // Ownership and combined-run allocation use the same sorted line locks.
    // A concurrent allocation must commit before this preview is recomputed.
    await lockOrderProductionOverrideLines(tx, organizationId, orderId);
    const [order] = await tx.select({ id: orders.id }).from(orders).where(and(
      eq(orders.organizationId, organizationId), eq(orders.id, orderId),
    )).for('no key update');
    if (!order) throw new FulfillmentHttpError(404, 'Order not found.', 'ORDER_NOT_FOUND');
    await tx.select({ id: productionJobs.id }).from(productionJobs).where(and(
      eq(productionJobs.organizationId, organizationId), eq(productionJobs.orderId, orderId),
      inArray(productionJobs.lineItemId, items.map(item => item.lineItemId)),
    )).orderBy(productionJobs.lineItemId, productionJobs.id).for('update');
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
      return { replayed: true, handedOff: null };
    }
    const available = new Map((await readOverrideLines(input, tx)).map(entry => [entry.line.lineItemId, entry]));
    const planned = items.map(item => {
      const entry = available.get(item.lineItemId);
      if (!entry || item.revision !== entry.line.revision) {
        blocked('PRODUCTION_COMPLETION_STALE', 'Production or ready quantities changed. Reopen the override and review the available quantities.');
      }
      if (entry.line.maximumQuantity === 0) {
        blocked('PRODUCTION_LINE_INELIGIBLE', entry.line.blockedReason ?? 'This line cannot be overridden.');
      }
      if (item.quantity > entry.line.maximumQuantity) {
        blocked('PRODUCTION_COMPLETION_STALE', 'The requested quantity exceeds the current maximum. Review the available quantities.');
      }
      return { item, entry, newProduction: Math.max(0, item.quantity - entry.missingReady) };
    });
    let pendingHandoff: { lineItemId: string; jobId: string | null } | null = null;
    const evidence = [];
    for (const { item, entry, newProduction } of planned) {
      const mode = newProduction > 0 ? entry.productionAction : 'confirm_readiness';
      if (mode === 'tracked_completion' && entry.job) {
        const completed = await completeProductionJobWorkflow(tx, {
          organizationId, userId: actorUserId, jobId: entry.job.id, skipProduction: false,
          deferParentHandoff: { orderId },
          fulfillmentCompletion: { quantity: newProduction, clientRequestId, standaloneRemainingQuantity: entry.line.outstandingQuantity },
          auditUserName: input.actorUserName, ipAddress: input.ipAddress, userAgent: input.userAgent,
        });
        if (completed.nextStationKey === 'fulfillment') pendingHandoff = { lineItemId: item.lineItemId, jobId: entry.job.id };
      } else if (mode === 'administrative_completion') {
        const recorded = await canonicalProductionOperations.recordAdministrativeCompletionInTransaction(tx, {
          organizationId, orderId, lineItemId: item.lineItemId, actorUserId, quantity: newProduction,
          outstandingQuantity: entry.line.outstandingQuantity, ownerId: entry.job?.id ?? null, clientRequestId,
        });
        if (recorded.fullyCompleted) pendingHandoff = { lineItemId: item.lineItemId, jobId: entry.job?.id ?? null };
      } else if (newProduction > 0) {
        blocked('PRODUCTION_LINE_INELIGIBLE', entry.line.blockedReason ?? 'This line cannot be overridden.');
      }
      evidence.push({ lineItemId: item.lineItemId, mode, quantity: item.quantity, newProduction,
        jobId: entry.job?.id ?? null, previousStation: entry.job?.stationKey ?? null,
        previousProductionQuantity: entry.line.productionCompleteQuantity, previousReadyQuantity: entry.readyWaitingQuantity });
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
    const handoff = pendingHandoff && await markOrderReadyForFulfillmentIfProductionComplete(tx, {
      organizationId, orderId, actorUserId, productionJobId: pendingHandoff.jobId,
    });
    return { replayed: false, handedOff: handoff?.changed ? pendingHandoff : null };
  }).catch((error: unknown) => {
    const retry = productionOverrideRetryError(error);
    if (retry) throw new FulfillmentHttpError(retry.status, retry.message, retry.code);
    throw error;
  });
  if (result.handedOff) {
    const { jobId, lineItemId } = result.handedOff;
    await applyWorkflowStatusPillFailSoft({ organizationId, orderId, triggerKey: 'sent_to_fulfillment', actorUserId, source: 'system',
      reason: 'Production completion routed work to fulfillment',
      metadata: { workflowEvent: 'sent_to_fulfillment', productionJobId: jobId, lineItemId, source: 'fulfillment' } });
  }
  return { replayed: result.replayed };
}

/** One full-line standalone production completion and readiness confirmation. */
export async function completeProductionFromFulfillment(input: FulfillmentProductionCompletionInput) {
  assertFulfillmentOperator(input.actorOrgRole);

  const result = await db.transaction(async (tx) => {
    await lockOrderProductionOverrideLines(tx, input.organizationId, input.orderId);
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

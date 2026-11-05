import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '../db';
import {
  auditLogs, customers, fulfillmentAdministrativeReconciliations, fulfillmentEvents,
  fulfillmentReadyQuantities, orderAuditLog, orderLineItems, orders, pickupHandoffItems, pickupHandoffs, pickupTickets,
  productionEvents, productionJobs, productionRunMembers, productionRuns, products,
  shipmentItems, shipmentOrders, shipments,
} from '@shared/schema';
import { ACTIVE_PRODUCTION_RUN_STATUSES } from '@shared/productionRunLifecycle';
import { isTerminalStatus, resolveActiveProductionOwners } from './productionOwnership';
import { projectCanonicalProductionObligations } from './orderProductionCompletionPolicy';
import { FulfillmentDashboardRepo } from './fulfillment/repository';
import { FulfillmentService } from './fulfillment/service';
import { FulfillmentHttpError } from './fulfillment/types';
import { getRuntimeBuildFingerprint } from '../lib/runtimeEnvironment';

function bounded<T>(rows: T[], maximum: number): T[] {
  if (rows.length > maximum) throw new FulfillmentHttpError(409,
    'Related history exceeds the diagnostic snapshot limit. Use the read-only SQL reconciliation procedure.', 'RECONCILIATION_HISTORY_LIMIT');
  return rows;
}

/** Historical metadata is business evidence, not a channel for exporting secrets. */
function redactDiagnostic<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (key, entry: unknown) => {
    if (/(token|secret|password|authorization|cookie|credential|api[_-]?key|database[_-]?url|connection[_-]?(string|url))/i.test(key)) return '[redacted]';
    if (typeof entry !== 'string') return entry;
    return entry.replace(/\b(?:postgres(?:ql)?|mysql|redis):\/\/[^\s]+/gi, '[redacted connection]')
      .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=_\.\-]+/gi, '[redacted authorization]')
      .replace(/https?:\/\/[^\s"<>]+/gi, match => {
        try { const url = new URL(match); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.toString(); }
        catch { return '[redacted URL]'; }
      });
  })) as T;
}

/** No writer is exposed here. All canonical projections use the same read-only snapshot. */
export async function getOrderReconciliationDiagnostic(input: {
  organizationId: string; orderId: string; expectedOrderNumber?: string; expectedPoNumber?: string;
}, database: typeof db = db) {
  return database.transaction(async tx => {
    await tx.execute(sql`set local statement_timeout = '15s'`);
    await tx.execute(sql`set local lock_timeout = '3s'`);
    const [order] = await tx.select({ id: orders.id, organizationId: orders.organizationId,
      orderNumber: orders.orderNumber, poNumber: orders.poNumber, customerId: orders.customerId,
      customerName: customers.companyName, linkedCustomerId: customers.id,
      state: orders.state, status: orders.status, fulfillmentStatus: orders.fulfillmentStatus,
      updatedAt: orders.updatedAt, canceledAt: orders.canceledAt })
      .from(orders).leftJoin(customers, and(eq(customers.id, orders.customerId), eq(customers.organizationId, input.organizationId)))
      .where(and(eq(orders.organizationId, input.organizationId), eq(orders.id, input.orderId))).limit(1);
    if (!order || (input.expectedOrderNumber !== undefined && order.orderNumber !== input.expectedOrderNumber)
      || (input.expectedPoNumber !== undefined && order.poNumber !== input.expectedPoNumber))
      throw new FulfillmentHttpError(404, 'Order identity was not found in this organization.', 'NOT_FOUND');
    if (order.customerId && !order.linkedCustomerId)
      throw new FulfillmentHttpError(409, 'Customer ownership must be reviewed before preparing this diagnostic.', 'RECONCILIATION_CUSTOMER_CONFLICT');

    const lines = bounded(await tx.select({ id: orderLineItems.id, description: orderLineItems.description,
      quantity: orderLineItems.quantity, productId: orderLineItems.productId, canonicalProductId: products.id,
      lineItemRole: orderLineItems.lineItemRole, workflowState: orderLineItems.workflowState,
      lifecycleStatus: orderLineItems.status, productionBypassed: orderLineItems.productionBypassed,
      requiresProductionJob: products.requiresProductionJob, workflowIntent: products.workflowIntent,
      requiresDesign: orderLineItems.requiresDesign, requiresPrepress: orderLineItems.requiresPrepress,
      requiresProofApproval: orderLineItems.requiresProofApproval, updatedAt: orderLineItems.updatedAt })
      .from(orderLineItems).leftJoin(products, and(eq(products.id, orderLineItems.productId), eq(products.organizationId, input.organizationId)))
      .where(eq(orderLineItems.orderId, order.id)).orderBy(asc(orderLineItems.id)).limit(501), 500);
    const lineIds = lines.map(line => line.id);
    const jobs = bounded(await tx.select({ id: productionJobs.id, lineItemId: productionJobs.lineItemId,
      stationId: sql<string | null>`production_jobs.station_id`, stationKey: productionJobs.stationKey,
      stepKey: productionJobs.stepKey, status: productionJobs.status, startedAt: productionJobs.startedAt,
      completedAt: productionJobs.completedAt, createdAt: productionJobs.createdAt, updatedAt: productionJobs.updatedAt })
      .from(productionJobs).where(and(eq(productionJobs.organizationId, input.organizationId), eq(productionJobs.orderId, order.id)))
      .orderBy(asc(productionJobs.id)).limit(1001), 1000);
    const jobIds = jobs.map(job => job.id);
    const members = lineIds.length || jobIds.length ? bounded(await tx.select({ member: productionRunMembers,
      run: { id: productionRuns.id, status: productionRuns.status, updatedAt: productionRuns.updatedAt } })
      .from(productionRunMembers).leftJoin(productionRuns, and(eq(productionRuns.id, productionRunMembers.productionRunId), eq(productionRuns.organizationId, input.organizationId)))
      .where(and(eq(productionRunMembers.organizationId, input.organizationId), or(
        lineIds.length ? inArray(productionRunMembers.orderLineItemId, lineIds) : undefined,
        jobIds.length ? inArray(productionRunMembers.productionJobId, jobIds) : undefined)))
      .orderBy(asc(productionRunMembers.id)).limit(1001), 1000) : [];
    const productionHistory = bounded(await tx.select().from(productionEvents).where(and(
      eq(productionEvents.organizationId, input.organizationId), or(eq(productionEvents.orderId, order.id),
        jobIds.length ? inArray(productionEvents.productionJobId, jobIds) : undefined,
        lineIds.length ? inArray(productionEvents.orderLineItemId, lineIds) : undefined)))
      .orderBy(asc(productionEvents.createdAt), asc(productionEvents.id)).limit(2001), 2000);
    const shipmentAllocations = bounded(await tx.select().from(shipmentItems).where(and(
      eq(shipmentItems.organizationId, input.organizationId), eq(shipmentItems.orderId, order.id)))
      .orderBy(asc(shipmentItems.id)).limit(1001), 1000);
    const shipmentLinks = await tx.select({ shipmentId: shipmentOrders.shipmentId }).from(shipmentOrders)
      .where(and(eq(shipmentOrders.organizationId, input.organizationId), eq(shipmentOrders.orderId, order.id))).limit(1001);
    bounded(shipmentLinks, 1000);
    const shipmentIds = [...new Set([...shipmentAllocations.map(row => row.shipmentId), ...shipmentLinks.map(row => row.shipmentId)])];
    const shipmentHistory = bounded(await tx.select({ id: shipments.id, status: shipments.status, scope: shipments.scope,
      updatedAt: shipments.updatedAt }).from(shipments).where(and(eq(shipments.organizationId, input.organizationId),
      or(eq(shipments.orderId, order.id), eq(shipments.primaryOrderId, order.id), shipmentIds.length ? inArray(shipments.id, shipmentIds) : undefined)))
      .orderBy(asc(shipments.id)).limit(1001), 1000);
    const pickups = bounded(await tx.select().from(pickupHandoffs).where(and(eq(pickupHandoffs.organizationId, input.organizationId), eq(pickupHandoffs.orderId, order.id)))
      .orderBy(asc(pickupHandoffs.id)).limit(1001), 1000);
    const pickupHistory = await tx.select({ id: pickupTickets.id, status: pickupTickets.status, readyAt: pickupTickets.readyAt,
      pickedUpAt: pickupTickets.pickedUpAt, updatedAt: pickupTickets.updatedAt }).from(pickupTickets)
      .where(and(eq(pickupTickets.organizationId, input.organizationId), eq(pickupTickets.orderId, order.id))).limit(2);
    bounded(pickupHistory, 1);
    const pickupAllocations = bounded(await tx.select().from(pickupHandoffItems).where(and(eq(pickupHandoffItems.organizationId, input.organizationId), eq(pickupHandoffItems.orderId, order.id)))
      .orderBy(asc(pickupHandoffItems.id)).limit(1001), 1000);
    const administrative = bounded(await tx.select().from(fulfillmentAdministrativeReconciliations)
      .where(and(eq(fulfillmentAdministrativeReconciliations.organizationId, input.organizationId), eq(fulfillmentAdministrativeReconciliations.orderId, order.id)))
      .orderBy(asc(fulfillmentAdministrativeReconciliations.id)).limit(1001), 1000);
    const ready = bounded(await tx.select().from(fulfillmentReadyQuantities).where(and(eq(fulfillmentReadyQuantities.organizationId, input.organizationId), eq(fulfillmentReadyQuantities.orderId, order.id)))
      .orderBy(asc(fulfillmentReadyQuantities.id)).limit(501), 500);
    const fulfillmentHistory = bounded(await tx.select().from(fulfillmentEvents).where(and(eq(fulfillmentEvents.organizationId, input.organizationId),
      or(and(eq(fulfillmentEvents.entityType, 'ORDER'), eq(fulfillmentEvents.entityId, order.id)),
        sql`${fulfillmentEvents.payloadJson}->>'orderId' = ${order.id}`,
        shipmentHistory.length ? and(eq(fulfillmentEvents.entityType, 'SHIPMENT'), inArray(fulfillmentEvents.entityId, shipmentHistory.map(row => row.id))) : undefined,
        pickupHistory.length ? and(eq(fulfillmentEvents.entityType, 'PICKUP_TICKET'), inArray(fulfillmentEvents.entityId, pickupHistory.map(row => row.id))) : undefined)))
      .orderBy(asc(fulfillmentEvents.createdAt), asc(fulfillmentEvents.id)).limit(2001), 2000);
    const auditHistory = bounded(await tx.select({ id: auditLogs.id, entityType: auditLogs.entityType,
      entityId: auditLogs.entityId, actionType: auditLogs.actionType, description: auditLogs.description,
      oldValues: auditLogs.oldValues, newValues: auditLogs.newValues, createdAt: auditLogs.createdAt }).from(auditLogs)
      .where(and(eq(auditLogs.organizationId, input.organizationId), inArray(auditLogs.entityId, [order.id, ...lineIds, ...jobIds])))
      .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id)).limit(2001), 2000);
    const orderHistory = bounded(await tx.select().from(orderAuditLog).where(eq(orderAuditLog.orderId, order.id))
      .orderBy(asc(orderAuditLog.createdAt), asc(orderAuditLog.id)).limit(2001), 2000);

    // The canonical constructors accept a database handle; this transaction
    // supplies the same select/execute API while preventing any writes in PG.
    const reader = tx as unknown as typeof db;
    const repository = new FulfillmentDashboardRepo(reader);
    const quantities = await repository.listLineEligibility(input.organizationId, { orderIds: [order.id] });
    const canonicalPreview = await new FulfillmentService({ dbInstance: reader, dashboardRepo: repository })
      .getHistoricalFulfillmentReconciliationPreview(input.organizationId, order.id);
    const resolvedOwners = lineIds.length ? await resolveActiveProductionOwners(tx, { organizationId: input.organizationId, lineItemIds: lineIds }) : new Map();
    const activeJobs = jobs.filter(job => !isTerminalStatus(job.status) && job.stationKey.toLowerCase() !== 'fulfillment');
    const counts = new Map<string, number>();
    for (const job of activeJobs) if (job.lineItemId) counts.set(job.lineItemId, (counts.get(job.lineItemId) ?? 0) + 1);
    const obligations = projectCanonicalProductionObligations({ lines, activeOwnerCountByLineItemId: counts });
    const findings: Array<{ code: string; lineItemId: string | null; recordIds: string[]; message: string }> = [];
    for (const line of lines) {
      const projection = quantities.find(row => row.id === line.id)?.projection;
      if (!line.canonicalProductId || !projection) findings.push({ code: 'CANONICAL_PRODUCT_MISSING', lineItemId: line.id, recordIds: [line.productId], message: 'Canonical product ownership/configuration must be reviewed; no quantity repair is inferred.' });
      if ((counts.get(line.id) ?? 0) > 1) findings.push({ code: 'MULTIPLE_ACTIVE_OWNERS', lineItemId: line.id, recordIds: activeJobs.filter(job => job.lineItemId === line.id).map(job => job.id), message: 'Multiple active owners need canonical ownership review.' });
      const terminal = jobs.filter(job => job.lineItemId === line.id && job.stationKey.toLowerCase() !== 'fulfillment' && isTerminalStatus(job.status));
      if (projection?.productionRequired && projection.productionCompleteQuantity < projection.orderedQuantity && terminal.length)
        findings.push({ code: 'TERMINAL_HISTORY_WITH_REMAINING_OBLIGATION', lineItemId: line.id, recordIds: terminal.map(job => job.id), message: 'Terminal job history exists, but canonical production quantity remains incomplete. Terminal status is not proof that the remaining pieces were produced.' });
    }
    const activeRuns = members.filter(row => row.run && (ACTIVE_PRODUCTION_RUN_STATUSES as readonly string[]).includes(row.run.status));
    if (activeRuns.length) findings.push({ code: 'ACTIVE_COMBINED_RUN', lineItemId: null, recordIds: [...new Set(activeRuns.map(row => row.member.productionRunId))], message: 'Resolve active run work through the canonical Combined Run workflow; no independent repair is proposed.' });
    if (members.some(row => !row.run)) findings.push({ code: 'RUN_LINK_CONFLICT', lineItemId: null, recordIds: members.filter(row => !row.run).map(row => row.member.id), message: 'A run membership has no same-tenant run; manual investigation is required.' });

    const snapshot = redactDiagnostic({ order, lines, jobs, members, productionHistory, shipmentAllocations, shipmentHistory, pickupHistory, pickups, pickupAllocations,
      administrative, ready, fulfillmentHistory, auditHistory, orderHistory, quantities, obligations, canonicalPreview,
      resolvedOwners: Array.from(resolvedOwners.values()) });
    const snapshotToken = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    return {
      readOnly: true, mutationAvailable: false, observedAt: new Date().toISOString(), build: getRuntimeBuildFingerprint(), snapshotToken, ...snapshot, findings,
      limitations: ['This endpoint diagnoses records; it does not propose or execute a repair.',
        'A terminal job status does not prove physical completion of outstanding quantities.',
        'Snapshot token identifies evidence; it is not approval.',
        'Any future business-data repair requires a separate exact proposal and explicit Owner authorization.'],
    };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}

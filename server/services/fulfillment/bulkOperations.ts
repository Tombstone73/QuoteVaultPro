import { createHash, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db';
import { fulfillmentEvents, userOrganizations, users } from '@shared/schema';
import { canEditFulfillmentHistoryNotes } from '@shared/fulfillmentHistoryNote';
import { hasAdminOrOwnerOperationalRole } from '@shared/roleAccess';
import { bulkFulfillmentExecuteSchema, bulkFulfillmentPreviewSchema, type BulkFulfillmentAction, type BulkFulfillmentExecute,
  type BulkFulfillmentOrderContext, type BulkFulfillmentPreview, type BulkFulfillmentResult, type BulkFulfillmentSelection, type BulkFulfillmentUnit } from '@shared/bulkFulfillment';
import { canonicalFulfillmentOperations } from './canonicalFulfillmentOperations';
import { validateShipmentShippingContext } from './shippingContext';
import { FulfillmentHttpError } from './types';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const receiptType = 'FULFILLMENT_BULK_OPERATION';
type Operations = typeof canonicalFulfillmentOperations;
type Context = Awaited<ReturnType<Operations['getBulkOrderContext']>>;
type Actor = { userId: string; role: string };

/** Bulk orchestration owns selection/review/receipts only. All quantity,
 * production, shipment, pickup and historical mutations remain canonical. */
export class BulkFulfillmentOperations {
  constructor(private readonly database = db, private readonly operations: Operations = canonicalFulfillmentOperations) {}

  private async actor(orgId: string, userId: string): Promise<Actor> {
    const [membership] = await this.database.select({ role: userOrganizations.role, accountType: users.accountType, userRole: users.role })
      .from(userOrganizations).innerJoin(users, eq(users.id, userOrganizations.userId))
      .where(and(eq(userOrganizations.organizationId, orgId), eq(userOrganizations.userId, userId), sql`user_organizations.is_active = true`)).limit(1);
    if (!membership || membership.accountType === 'PORTAL_CUSTOMER' || membership.userRole === 'customer' || !canEditFulfillmentHistoryNotes(membership.role)) {
      throw new FulfillmentHttpError(403, 'Active internal fulfillment operator access is required.', 'FULFILLMENT_BULK_FORBIDDEN');
    }
    return { userId, role: membership.role };
  }
  async permissions(orgId: string, userId: string) {
    try { const actor = await this.actor(orgId, userId); return { canOperate: true, canReconcileLegacy: hasAdminOrOwnerOperationalRole(actor.role) }; }
    catch (error) { if (error instanceof FulfillmentHttpError && error.status === 403) return { canOperate: false, canReconcileLegacy: false }; throw error; }
  }

  async context(orgId: string, userId: string, orderId: string): Promise<BulkFulfillmentOrderContext> {
    const actor = await this.actor(orgId, userId);
    return this.publicContext(await this.operations.getBulkOrderContext(orgId, orderId, actor.role), actor);
  }
  private publicContext(context: Context, actor: Actor): BulkFulfillmentOrderContext {
    return { orderId: context.detail.orderId, orderNumber: context.detail.orderNumber, fulfillmentType: context.detail.fulfillmentType,
      canReconcileLegacy: hasAdminOrOwnerOperationalRole(actor.role), lines: context.physical.map(line => {
        const p = line.projection, source = context.detail.lineItems.find(item => item.id === line.id);
        const delivery = context.delivery.filter(item => item.orderLineItemId === line.id);
        return { orderLineItemId: line.id, label: source?.description || source?.productName || 'Order line', orderedQuantity: p.orderedQuantity,
          remainingQuantity: p.remainingQuantity, readyQuantity: p.readyWaitingQuantity, productionCompleteQuantity: p.productionCompleteQuantity,
          shippedQuantity: p.shippedQuantity, pickedUpQuantity: p.pickedUpQuantity, availableQuantity: source?.production.availableForAllocationQuantity ?? p.readyWaitingQuantity,
          deliveredQuantity: delivery.reduce((sum, item) => sum + item.deliveredQuantity, 0), pendingDeliveryQuantity: delivery.reduce((sum, item) => sum + item.pendingDeliveryQuantity, 0),
          deliverySources: delivery.filter(item => item.pendingDeliveryQuantity > 0).map(item => ({ shipmentId: item.shipmentId,
            label: context.detail.shipments.find(shipment => shipment.id === item.shipmentId)?.shipmentReference || item.shipmentId,
            pendingQuantity: item.pendingDeliveryQuantity })),
          completed: p.pickedUpQuantity + p.administrativelyReconciledQuantity + delivery.reduce((sum, item) => sum + item.deliveredQuantity, 0) >= p.orderedQuantity };
      }) };
  }

  async preview(orgId: string, userId: string, raw: unknown): Promise<BulkFulfillmentPreview> {
    const input = bulkFulfillmentPreviewSchema.parse(raw), actor = await this.actor(orgId, userId);
    return this.plan(orgId, actor, input.action, input.selection);
  }
  private async plan(orgId: string, actor: Actor, action: BulkFulfillmentAction, selection: BulkFulfillmentSelection): Promise<BulkFulfillmentPreview> {
    if (new Set(selection.map(row => row.orderId)).size !== selection.length || selection.some(row => row.items && new Set(row.items.map(item => item.orderLineItemId)).size !== row.items.length)) {
      throw new FulfillmentHttpError(400, 'Selection contains duplicate orders or lines.', 'DUPLICATE_SELECTION');
    }
    const units: BulkFulfillmentUnit[] = [], states: unknown[] = [];
    const selected = new Map<string, { orderId: string; quantity: number; eligible: boolean; requirements: string[]; label: string }>();
    const shipmentIds = new Set<string>();
    for (const target of selection) {
      let context: Context;
      try { context = await this.operations.getBulkOrderContext(orgId, target.orderId, actor.role); }
      catch (error) {
        if (!(error instanceof FulfillmentHttpError) || error.status !== 404) throw error;
        units.push({ key: `order:${target.orderId}`, orderIds: [target.orderId], orderNumber: 'Unavailable order', items: [], eligible: false, requirements: ['Order unavailable in this organization.'] }); continue;
      }
      const view = this.publicContext(context, actor), detail = context.detail;
      states.push({ orderId: target.orderId, status: detail.status, type: detail.fulfillmentType,
        lines: context.physical, delivery: context.delivery, pickup: detail.pickupTicket,
        shipments: detail.shipments, checklist: detail.checklistComplete });
      const wanted: Array<{ orderLineItemId: string; quantity?: number; shipmentId?: string }> = target.items ?? view.lines.map(line => ({ orderLineItemId: line.orderLineItemId }));
      const items = wanted.map(item => {
        const line = view.lines.find(line => line.orderLineItemId === item.orderLineItemId);
        const requirements: string[] = [];
        if (!line) return { orderId: target.orderId, orderLineItemId: item.orderLineItemId, label: 'Unavailable physical line', quantity: 0, eligible: false, requirements: ['Line does not belong to this order or has no physical fulfillment obligation.'] };
        const p = context.physical.find(row => row.id === line.orderLineItemId)!.projection;
        const draftQuantity = detail.shipments.filter(shipment => shipment.status === 'DRAFT').flatMap(shipment => shipment.allocations).filter(allocation => allocation.orderLineItemId === line.orderLineItemId).reduce((sum, allocation) => sum + allocation.quantity, 0);
        const deliverySource = action === 'delivered' && item.shipmentId ? line.deliverySources?.find(source => source.shipmentId === item.shipmentId) : undefined;
        const pendingDeliveryQuantity = action === 'delivered' && item.shipmentId ? deliverySource?.pendingQuantity ?? 0 : line.pendingDeliveryQuantity;
        const quantity = item.quantity ?? (action === 'ready' ? p.notReadyQuantity : action === 'picked_up' ? Math.min(p.readyWaitingQuantity, p.remainingQuantity)
          : action === 'shipped' ? draftQuantity : action === 'delivered' ? pendingDeliveryQuantity : action === 'archive' ? p.orderedQuantity : p.remainingQuantity);
        if (['picked_up', 'shipped', 'delivered'].includes(action) && detail.fulfillmentType !== (action === 'picked_up' ? 'PICKUP' : 'SHIP')) requirements.push(action === 'picked_up' ? 'Pickup orders only.' : 'Shipping orders only.');
        if (!['archive', 'legacy'].includes(action) && quantity <= 0) requirements.push(action === 'shipped' ? 'Prepare a draft shipment and save its exact package allocations.' : 'No eligible quantity remains for this action.');
        if (['ready', 'picked_up', 'shipped'].includes(action) && quantity > p.productionCompleteQuantity - p.operationallyFulfilledQuantity - (action === 'ready' ? p.readyWaitingQuantity : 0)) requirements.push('Production is incomplete or ownership is unresolved. Resolve it in the production/fulfillment workspace.');
        if (action === 'ready' && quantity > p.notReadyQuantity) requirements.push('Quantity exceeds units not yet marked ready.');
        if (['picked_up', 'shipped'].includes(action) && quantity > p.readyWaitingQuantity) requirements.push('Quantity exceeds physically ready units.');
        if (action === 'picked_up' && quantity > line.availableQuantity) requirements.push('Units are reserved in a draft shipment. Correct its allocations first.');
        if (action === 'delivered' && (quantity > pendingDeliveryQuantity || p.productionCompleteQuantity < p.orderedQuantity || (item.shipmentId && !deliverySource))) requirements.push('Confirm only shipped, undelivered quantities from the chosen shipment with resolved production.');
        if (action === 'delivered' && !item.shipmentId && (line.deliverySources?.length ?? 0) > 1 && quantity < line.pendingDeliveryQuantity) requirements.push('Choose the actual delivery shipment in the expanded line before confirming this partial quantity.');
        return { orderId: target.orderId, orderLineItemId: line.orderLineItemId, label: deliverySource ? `${line.label} · Shipment ${deliverySource.label}` : line.label,
          ...(action === 'delivered' && item.shipmentId ? { shipmentId: item.shipmentId } : {}), quantity, eligible: requirements.length === 0, requirements };
      });
      if (action === 'shipped') {
        for (const item of items) selected.set(item.orderLineItemId, item);
        detail.shipments.filter(shipment => shipment.status === 'DRAFT').forEach(shipment => shipmentIds.add(shipment.id));
        continue;
      }
      const requirements: string[] = [];
      let historicalPreviewToken: string | undefined;
      if (action === 'archive' || action === 'legacy') {
        if (action === 'legacy' && target.items) requirements.push('Select the complete order for historical reconciliation.');
        if (!view.lines.length) requirements.push('No physical fulfillment lines.');
        if (view.lines.filter(line => action === 'legacy' || wanted.some(item => item.orderLineItemId === line.orderLineItemId)).some(line => line.productionCompleteQuantity < line.orderedQuantity)) requirements.push('Resolve production completion first.');
        if (action === 'archive' && context.physical.filter(line => wanted.some(item => item.orderLineItemId === line.id)).some(line => {
          const delivered = view.lines.find(row => row.orderLineItemId === line.id)!.deliveredQuantity;
          return line.projection.pickedUpQuantity + delivered + line.projection.administrativelyReconciledQuantity < line.projection.orderedQuantity;
        })) requirements.push('Every physical line must be fully picked up, delivered, or administratively reconciled. In-transit and partial orders stay active.');
        if (action === 'legacy') {
          if (!hasAdminOrOwnerOperationalRole(actor.role)) requirements.push('Organization Owner or Admin authorization is required.');
          const historical = await this.operations.getHistoricalFulfillmentReconciliationPreview(orgId, target.orderId);
          historicalPreviewToken = historical.previewToken;
          if (!historical.canCloseJobOverride) requirements.push('Historical reconciliation is blocked by unresolved production, ownership, or an already completed obligation.');
        }
        for (const item of items) { item.requirements = [...requirements]; item.eligible = requirements.length === 0; }
        if (action === 'archive') for (const item of items) {
          const line = view.lines.find(row => row.orderLineItemId === item.orderLineItemId);
          if (!line || item.quantity !== line.orderedQuantity) { item.eligible = false; item.requirements.push('Archive the complete physical line, without a partial action quantity.'); }
        }
      }
      units.push({ key: `order:${target.orderId}`, orderIds: [target.orderId], orderNumber: String(view.orderNumber), items,
        eligible: items.some(item => item.eligible) && !requirements.length, requirements, historicalPreviewToken,
        readyBefore: Object.fromEntries(view.lines.map(line => [line.orderLineItemId, line.readyQuantity])),
        deliveredBefore: Object.fromEntries(view.lines.map(line => [line.orderLineItemId, line.deliveredQuantity])) });
    }
    if (action === 'shipped') {
      const covered = new Set<string>();
      for (const shipmentId of shipmentIds) {
        const shipment = await this.operations.getShipment(orgId, shipmentId);
        if (!shipment) continue;
        const requirements: string[] = [];
        const allocations = new Map<string, { orderId: string; quantity: number }>();
        for (const item of shipment.items) {
          const old = allocations.get(item.orderLineItemId);
          allocations.set(item.orderLineItemId, { orderId: item.orderId, quantity: (old?.quantity ?? 0) + item.quantity });
          if (!item.packageId) requirements.push('Assign every saved allocation to a package.');
        }
        if (!shipment.carrier?.trim()) requirements.push('Enter the carrier in the shipment workspace.');
        if (/ups|fedex|usps|dhl/i.test(shipment.carrier || '') && !shipment.trackingNumber?.trim()) requirements.push('Enter real tracking information for the parcel shipment.');
        if (!shipment.packages.length || !allocations.size) requirements.push('Save packages and shipment quantities.');
        try { validateShipmentShippingContext(shipment.shippingContext, shipment.orders.map(order => order.orderId), true); }
        catch (error) { requirements.push(error instanceof Error ? error.message : 'Complete the shipment addresses.'); }
        const items = [...allocations].map(([lineId, allocation]) => {
          const target = selected.get(lineId);
          if (!target || target.orderId !== allocation.orderId) requirements.push('Select every order/line allocated to this shipment; bulk shipping never adds unselected units.');
          if (target) covered.add(lineId);
          return { orderId: allocation.orderId, orderLineItemId: lineId, label: target?.label ?? 'Unselected allocation', quantity: allocation.quantity,
            eligible: Boolean(target?.eligible), requirements: target?.requirements ?? ['Allocation is not selected.'] };
        });
        units.push({ key: `shipment:${shipmentId}`, shipmentId, shipmentUpdatedAt: new Date(shipment.updatedAt).toISOString(),
          orderIds: [...new Set(items.map(item => item.orderId))], orderNumber: shipment.shipmentReference || 'Shipment', items,
          eligible: !requirements.length && items.every(item => item.eligible), requirements: [...new Set(requirements)] });
      }
      for (const [lineId, target] of selected) {
        const allocated = units.filter(unit => unit.shipmentId).flatMap(unit => unit.items).filter(item => item.orderLineItemId === lineId).reduce((sum, item) => sum + item.quantity, 0);
        if (covered.has(lineId) && allocated !== target.quantity) for (const unit of units.filter(unit => unit.items.some(item => item.orderLineItemId === lineId))) {
          unit.eligible = false; unit.requirements.push('Selected quantity differs from saved draft allocations. Review the shipment quantities.');
        }
        if (!covered.has(lineId)) units.push({ key: `line:${lineId}`, orderIds: [target.orderId], orderNumber: 'Shipment required', items: [{ ...target, orderLineItemId: lineId }], eligible: false,
          requirements: ['Prepare this line in the existing shipment workspace, then refresh the preview.'] });
      }
    }
    const eligibleCount = units.reduce((sum, unit) => sum + (unit.eligible ? unit.items.filter(item => item.eligible).length : 0), 0);
    const skippedCount = units.reduce((sum, unit) => sum + (unit.eligible ? unit.items.filter(item => !item.eligible).length : Math.max(1, unit.items.length)), 0);
    if (eligibleCount + skippedCount > 2000) throw new FulfillmentHttpError(400, 'Select at most 2,000 physical lines per bulk operation.', 'BULK_SELECTION_TOO_LARGE');
    return { action, units, eligibleCount, skippedCount, selectedOrderCount: selection.length, previewToken: digest({ action, selection, units, states }) };
  }

  async execute(orgId: string, userId: string, raw: unknown): Promise<BulkFulfillmentResult> {
    const input = bulkFulfillmentExecuteSchema.parse(raw), actor = await this.actor(orgId, userId);
    if (input.action === 'legacy' && (!input.legacyConfirmed || !hasAdminOrOwnerOperationalRole(actor.role))) throw new FulfillmentHttpError(403, 'Explicit Owner/Admin historical reconciliation confirmation is required.', 'LEGACY_CONFIRMATION_REQUIRED');
    const fingerprint = digest({ ...input, actorUserId: userId }), leaseId = randomUUID();
    const existing = await this.database.select().from(fulfillmentEvents).where(and(eq(fulfillmentEvents.organizationId, orgId), sql`${fulfillmentEvents.payloadJson}->>'requestId' = ${input.requestId}`, eq(fulfillmentEvents.eventType, receiptType))).limit(1);
    const freshPlan = existing.length ? undefined : await this.plan(orgId, actor, input.action, input.selection);
    if (freshPlan && !freshPlan.units.length) throw new FulfillmentHttpError(409, 'No physical fulfillment items were selected.', 'NO_PHYSICAL_LINES');
    if (freshPlan && freshPlan.previewToken !== input.previewToken) throw new FulfillmentHttpError(409, 'Fulfillment changed after review. Refresh the preview before confirming.', 'BULK_PREVIEW_STALE');
    const receipt = await this.database.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`fulfillment-bulk:${orgId}:${input.requestId}`}))`);
      const [stored] = await tx.select().from(fulfillmentEvents).where(and(eq(fulfillmentEvents.organizationId, orgId), sql`${fulfillmentEvents.payloadJson}->>'requestId' = ${input.requestId}`, eq(fulfillmentEvents.eventType, receiptType))).limit(1);
      if (stored && stored.payloadJson.fingerprint !== fingerprint) throw new FulfillmentHttpError(409, 'Retry key belongs to another reviewed operation.', 'BULK_REQUEST_CONFLICT');
      if (stored?.payloadJson.complete) return stored;
      if (stored && Date.parse(stored.payloadJson.leaseUntil || '') > Date.now()) throw new FulfillmentHttpError(409, 'This bulk operation is running. Retry the same operation shortly.', 'BULK_IN_PROGRESS');
      const payload = { ...(stored?.payloadJson ?? {}), fingerprint, plan: stored?.payloadJson.plan ?? freshPlan, results: stored?.payloadJson.results ?? [],
        requestId: input.requestId, orderIds: input.selection.map(row => row.orderId), leaseId, leaseUntil: new Date(Date.now() + 120000).toISOString(), complete: false, action: input.action, reason: input.reason };
      if (stored) { const [updated] = await tx.update(fulfillmentEvents).set({ payloadJson: payload }).where(eq(fulfillmentEvents.id, stored.id)).returning(); return updated; }
      const [created] = await tx.insert(fulfillmentEvents).values({ organizationId: orgId, actorUserId: userId, entityType: 'ORDER', entityId: input.selection[0].orderId, eventType: receiptType, payloadJson: payload }).returning(); return created;
    });
    const payload = receipt.payloadJson, plan = payload.plan as BulkFulfillmentPreview;
    const results = payload.results as BulkFulfillmentResult['results'];
    if (payload.complete) return { requestId: input.requestId, results: results.map(result => ({ ...result, replayed: true })) };
    for (const unit of plan.units) {
      if (results.some(result => result.key === unit.key)) continue;
      const items = unit.items.filter(item => item.eligible);
      const result: BulkFulfillmentResult['results'][number] = { key: unit.key, orderIds: unit.orderIds, items: items.map(item => ({ orderId: item.orderId, orderLineItemId: item.orderLineItemId })), status: 'skipped', message: [...new Set([...unit.requirements, ...unit.items.flatMap(item => item.requirements)])].join(' ') || 'No eligible items.' };
      if (unit.eligible) try {
        await this.perform(orgId, actor, input, unit);
        result.status = 'succeeded'; result.message = `${items.length} eligible items completed through the canonical fulfillment workflow.${unit.items.some(item => !item.eligible) ? ' Skipped lines remain selected.' : ''}`;
      } catch (error) { result.status = 'failed'; result.message = error instanceof Error ? error.message : 'Operation failed; refresh and review.'; result.code = error instanceof FulfillmentHttpError ? error.code : undefined; }
      results.push(result);
      const [saved] = await this.database.update(fulfillmentEvents).set({ payloadJson: { ...payload, results, leaseUntil: new Date(Date.now() + 120000).toISOString(), complete: results.length === plan.units.length } })
        .where(and(eq(fulfillmentEvents.id, receipt.id), eq(fulfillmentEvents.organizationId, orgId), sql`${fulfillmentEvents.payloadJson}->>'leaseId' = ${leaseId}`)).returning();
      if (!saved) throw new FulfillmentHttpError(409, 'Operation recovery is in progress. Retry the same request.', 'BULK_IN_PROGRESS');
    }
    return { requestId: input.requestId, results };
  }
  private async perform(orgId: string, actor: Actor, input: BulkFulfillmentExecute, unit: BulkFulfillmentUnit) {
    const orderId = unit.orderIds[0], clientRequestId = `${input.requestId}:${unit.key}`;
    const items = unit.items.filter(item => item.eligible).map(item => ({ orderLineItemId: item.orderLineItemId, quantity: item.quantity,
      ...(input.action === 'delivered' && item.shipmentId ? { shipmentId: item.shipmentId } : {}) }));
    if (input.action === 'ready') return this.operations.adjustReadyQuantities(orgId, orderId, { items: items.map(item => ({ orderLineItemId: item.orderLineItemId, quantityDelta: item.quantity })),
      reason: input.reason, clientRequestId, requireProductionComplete: true, expectedReadyByLine: unit.readyBefore }, actor.userId, actor.role);
    if (input.action === 'picked_up') {
      const ticket = await this.operations.createOrGetPickupTicket(orgId, orderId, actor.userId);
      return this.operations.recordPickupHandoff(orgId, ticket.id, { items, notes: input.reason, clientRequestId,
        effectivePickupDate: input.effectivePickupDate, requireProductionComplete: true, expectedReadyByLine: unit.readyBefore }, actor.userId);
    }
    if (input.action === 'shipped') return this.operations.markShipmentShipped(orgId, unit.shipmentId!, actor.userId, { clientRequestId, requireProductionComplete: true, expectedUpdatedAt: unit.shipmentUpdatedAt });
    if (input.action === 'delivered' || input.action === 'archive') return this.operations[input.action === 'delivered' ? 'recordDelivery' : 'archiveCompleted']({
      organizationId: orgId, orderId, actorUserId: actor.userId, actorOrgRole: actor.role, items, reason: input.reason, clientRequestId, expectedDeliveredByLine: unit.deliveredBefore });
    return this.operations.reconcileHistoricalFulfillment(orgId, { orderId, actorUserId: actor.userId, reason: 'completed_outside_printershero', note: input.reason, expectedPreviewToken: unit.historicalPreviewToken });
  }
}
export const bulkFulfillmentOperations = new BulkFulfillmentOperations();

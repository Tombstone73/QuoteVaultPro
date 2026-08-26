import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from '../../db';
import { emailService } from '../../emailService';
import { auditLogs, customers, fulfillmentChecklistItems, orderLineItems, organizations, orders, pickupTickets, shipmentItems, shipmentOrders, shipments } from '@shared/schema';
import { FulfillmentDashboardRepo, PickupRepo, ShipmentRepo } from './repository';
import { FulfillmentHttpError } from './types';
import { isCanceledOrder } from '@shared/operationalState';
import { isFulfillmentQueueEligibleOrder } from './eligibility';
import { billingInvoiceAutomationService, type BillingInvoiceAutomationResult } from '../billingInvoiceAutomation';
import { fulfillmentPackingModeFromSettings, fulfillmentVerificationPolicyFromSettings, hasExplicitSplitAllocations, parseShipmentDate, type FulfillmentPackingMode, type FulfillmentVerificationPolicy } from '@shared/fulfillmentVerification';

export const FULFILLMENT_REVERT_STATUS_PERMISSION = 'fulfillment.revert_status';

export function canRevertFulfillmentStatus(actorOrgRole?: string | null): boolean {
  const normalizedRole = String(actorOrgRole || '').trim().toLowerCase();
  // TODO: Replace this role fallback with the org permission key
  // `fulfillment.revert_status` once configurable RBAC is available.
  return normalizedRole === 'owner' || normalizedRole === 'admin' || normalizedRole === 'manager';
}

export class FulfillmentService {
  private readonly shipmentRepo: ShipmentRepo;
  private readonly pickupRepo: PickupRepo;
  private readonly dashboardRepo: FulfillmentDashboardRepo;
  private readonly dbInstance: typeof db;
  private readonly billingAutomationService: typeof billingInvoiceAutomationService;

  constructor(deps?: {
    shipmentRepo?: ShipmentRepo;
    pickupRepo?: PickupRepo;
    dashboardRepo?: FulfillmentDashboardRepo;
    dbInstance?: typeof db;
    billingAutomationService?: typeof billingInvoiceAutomationService;
  }) {
    this.dbInstance = deps?.dbInstance ?? db;
    this.shipmentRepo = deps?.shipmentRepo ?? new ShipmentRepo(this.dbInstance);
    this.pickupRepo = deps?.pickupRepo ?? new PickupRepo(this.dbInstance);
    this.dashboardRepo = deps?.dashboardRepo ?? new FulfillmentDashboardRepo(this.dbInstance);
    this.billingAutomationService = deps?.billingAutomationService ?? billingInvoiceAutomationService;
  }

  private canOverridePickupReady(actorRole?: string | null): boolean {
    const normalizedRole = String(actorRole || '').trim().toLowerCase();
    return normalizedRole === 'owner' || normalizedRole === 'admin';
  }

  /** Billing runs after the irreversible physical transaction.  A failed run is
   * recorded durably so an operator can replay the canonical, idempotent
   * invoice operation without recreating fulfillment. */
  private async ensureTerminalBilling(input: Parameters<typeof billingInvoiceAutomationService.ensureDraftInvoiceForOrderTrigger>[0]) {
    const result = await this.billingAutomationService.ensureDraftInvoiceForOrderTrigger(input);
    if (result.status === 'failed_controlled_error') {
      await this.dbInstance.insert(auditLogs).values({
        organizationId: input.organizationId,
        userId: input.actorUserId ?? null,
        actionType: 'FULFILLMENT_BILLING_RECONCILIATION_REQUIRED',
        entityType: 'order',
        entityId: input.orderId,
        entityName: null,
        description: 'Terminal fulfillment completed; billing reconciliation is required.',
        newValues: { trigger: input.trigger, sourceEvent: input.sourceEvent, code: result.code ?? null, message: result.message },
      } as any);
    }
    return result;
  }

  async reconcileTerminalBilling(orgId: string, orderId: string, actorUserId?: string | null) {
    const [order] = await this.dbInstance.select({ id: orders.id, fulfillmentStatus: orders.fulfillmentStatus })
      .from(orders).where(and(eq(orders.organizationId, orgId), eq(orders.id, orderId))).limit(1);
    if (!order) throw new FulfillmentHttpError(404, 'Order not found', 'NOT_FOUND');
    if (!['shipped', 'delivered'].includes(String(order.fulfillmentStatus || '').toLowerCase())) {
      throw new FulfillmentHttpError(409, 'Billing reconciliation is available after terminal fulfillment only.', 'FULFILLMENT_NOT_TERMINAL');
    }
    return this.ensureTerminalBilling({ organizationId: orgId, orderId, trigger: 'picked_up_or_shipped', sourceEvent: 'FULFILLMENT_BILLING_RECONCILILED', actorUserId });
  }

  private isOrderProductionComplete(order: {
    state: string | null;
    productionCompletedAt: string | null;
    completedProductionAt: string | null;
  }) {
    return order.state === 'production_complete' || !!order.productionCompletedAt || !!order.completedProductionAt;
  }

  async listQueue(orgId: string, filters: {
    type: 'all' | 'ship' | 'pickup';
    status: string;
    showArchived: boolean;
    overdueOnly: boolean;
    search?: string;
    printer?: string;
    page: number;
    pageSize: number;
    sortBy: 'orderNumber' | 'customer' | 'fulfillmentType' | 'status' | 'dueDate' | 'createdAt' | 'readyQuantity' | 'destination';
    sortDirection: 'asc' | 'desc';
  }) {
    return this.dashboardRepo.listFulfillmentQueue(orgId, filters);
  }

  async getOrderDetail(orgId: string, orderId: string, actorOrgRole?: string | null) {
    const detail = await this.dashboardRepo.getFulfillmentDetail(orgId, orderId);
    if (!detail) {
      throw new FulfillmentHttpError(404, 'Fulfillment row not found', 'NOT_FOUND');
    }
    return {
      ...detail,
      permissions: {
        canRevertStatus: canRevertFulfillmentStatus(actorOrgRole),
        revertPermission: FULFILLMENT_REVERT_STATUS_PERMISSION,
      },
    };
  }

  async markOrderReady(orgId: string, orderId: string, actorUserId?: string | null, actorOrgRole?: string | null) {
    const result = await this.dashboardRepo.markOrderReady(orgId, orderId, actorUserId);
    if (!result.ok) {
      if (result.code === 'NOT_FOUND') throw new FulfillmentHttpError(404, result.message, result.code);
      throw new FulfillmentHttpError(400, result.message, result.code);
    }
    return this.getOrderDetail(orgId, orderId, actorOrgRole);
  }

  async markOrderReadyForPickup(orgId: string, orderId: string, payload: {
    stagingLocation?: string | null;
    pickupNotes?: string | null;
    contactName?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
  }, actorUserId?: string | null, actorUserRole?: string | null) {
    const ticket = await this.createOrGetPickupTicket(orgId, orderId, actorUserId);
    const pickupReadyResult = await this.markPickupReady(orgId, ticket.id, payload, actorUserId, actorUserRole);
    const detail = await this.getOrderDetail(orgId, orderId, actorUserRole);
    return { ...detail, billingAutomation: (pickupReadyResult as any).billingAutomation ?? null };
  }

  async unreadyOrder(orgId: string, orderId: string, reason: string, actorUserId?: string | null, actorOrgRole?: string | null) {
    if (!canRevertFulfillmentStatus(actorOrgRole)) {
      throw new FulfillmentHttpError(403, `Missing permission: ${FULFILLMENT_REVERT_STATUS_PERMISSION}`, 'FULFILLMENT_REVERT_FORBIDDEN');
    }
    const result = await this.dashboardRepo.unreadyOrder(orgId, orderId, reason, actorUserId);
    if (!result.ok) {
      if (result.code === 'NOT_FOUND') throw new FulfillmentHttpError(404, result.message, result.code);
      if (result.code === 'TERMINAL_STATUS_REVERT_BLOCKED') throw new FulfillmentHttpError(409, result.message, result.code);
      throw new FulfillmentHttpError(400, result.message, result.code);
    }
    return this.getOrderDetail(orgId, orderId, actorOrgRole);
  }

  async updateChecklistItem(orgId: string, orderId: string, lineItemId: string, payload: {
    checked: boolean;
    fulfilledQuantity?: number;
    notes?: string | null;
  }, actorUserId?: string | null) {
    const result = await this.dashboardRepo.updateChecklistItem(orgId, orderId, lineItemId, payload, actorUserId);
    if (!result.ok) {
      if (result.code === 'NOT_FOUND') throw new FulfillmentHttpError(404, result.message, result.code);
      throw new FulfillmentHttpError(400, result.message, result.code);
    }
    return this.getOrderDetail(orgId, orderId);
  }

  async adjustReadyQuantities(orgId: string, orderId: string, payload: {
    items: Array<{ orderLineItemId: string; quantityDelta: number }>;
  }, actorUserId?: string | null, actorOrgRole?: string | null) {
    const result = await this.dashboardRepo.adjustReadyQuantities(orgId, orderId, payload.items, actorUserId);
    if (!result.ok) {
      const status = result.code === 'NOT_FOUND' ? 404 : 409;
      throw new FulfillmentHttpError(status, result.message, result.code);
    }

    // Legacy readiness records remain available for compatibility, but changing
    // them is no longer a physical-fulfillment or customer-notification action.
    return this.getOrderDetail(orgId, orderId);
  }

  async addOrderNote(orgId: string, orderId: string, note: string, actorUserId?: string | null) {
    const result = await this.dashboardRepo.addOrderNote(orgId, orderId, note, actorUserId);
    if (!result.ok) {
      if (result.code === 'NOT_FOUND') throw new FulfillmentHttpError(404, result.message, result.code);
      throw new FulfillmentHttpError(400, result.message, result.code);
    }
    return this.getOrderDetail(orgId, orderId);
  }

  private async requireChecklistComplete(orgId: string, orderId: string, target: 'ready_for_pickup' | 'shipped') {
    const result = await this.dashboardRepo.assertOrderChecklistComplete(orgId, orderId);
    if (!result.ok) {
      const count = result.summary?.unchecked ?? 0;
      const message = target === 'shipped'
        ? `${count} item${count === 1 ? '' : 's'} still require fulfillment verification.`
        : 'Verify all fulfillment checklist items before marking ready for pickup.';
      throw new FulfillmentHttpError(409, message, result.code);
    }
    return result.summary;
  }

  private async validateCombinedShipmentEligibility(orgId: string, orderIds: string[]) {
    if (orderIds.length === 0) {
      throw new FulfillmentHttpError(400, 'At least one order is required', 'EMPTY_ORDER_IDS');
    }

    const uniqueOrderIds = Array.from(new Set(orderIds));
    const ordersForValidation = await this.dashboardRepo.getOrdersForCombinedShipmentValidation(orgId, uniqueOrderIds);

    if (ordersForValidation.length !== uniqueOrderIds.length) {
      throw new FulfillmentHttpError(404, 'One or more orders were not found', 'ORDER_NOT_FOUND');
    }

    const lineEligibility = await this.dashboardRepo.listLineEligibility(orgId, { orderIds: uniqueOrderIds });
    const remainingQuantityByOrderId = new Map<string, number>();
    const physicalLineCountByOrderId = new Map<string, number>();
    for (const line of lineEligibility) {
      if (!line.projection.requiresFulfillment) continue;
      physicalLineCountByOrderId.set(line.orderId, (physicalLineCountByOrderId.get(line.orderId) ?? 0) + 1);
      remainingQuantityByOrderId.set(line.orderId, (remainingQuantityByOrderId.get(line.orderId) ?? 0) + line.projection.remainingQuantity);
    }

    for (const order of ordersForValidation) {
      if (isCanceledOrder(order)) {
        throw new FulfillmentHttpError(400, `Order ${order.id} is cancelled and not ship-eligible`, 'ORDER_NOT_SHIP_ELIGIBLE');
      }

      if (order.shippingMethod === 'pickup') {
        throw new FulfillmentHttpError(400, 'Cannot combine pickup and shipping orders', 'MIXED_FULFILLMENT_TYPES');
      }

      const lineItemCount = physicalLineCountByOrderId.get(order.id) || 0;
      if (lineItemCount <= 0) {
        throw new FulfillmentHttpError(400, `Order ${order.id} has no shippable line items`, 'ORDER_NOT_SHIP_ELIGIBLE');
      }
      if ((remainingQuantityByOrderId.get(order.id) ?? 0) <= 0) {
        throw new FulfillmentHttpError(409, `Order ${order.id} has no remaining quantity to ship`, 'NO_REMAINING_QUANTITY');
      }
    }

    if (ordersForValidation.length > 1) {
      const firstAddressKey = this.dashboardRepo.getAddressKey(ordersForValidation[0]);
      for (let i = 1; i < ordersForValidation.length; i += 1) {
        const key = this.dashboardRepo.getAddressKey(ordersForValidation[i]);
        if (key !== firstAddressKey) {
          throw new FulfillmentHttpError(400, 'All combined-shipment orders must have identical Ship To address', 'ADDRESS_MISMATCH');
        }
      }
    }

    return ordersForValidation;
  }

  async createShipment(orgId: string, payload: {
    scope: 'SINGLE_ORDER' | 'MULTI_ORDER';
    orderIds: string[];
    primaryOrderId?: string;
    actorUserId?: string | null;
  }) {
    const normalizedOrderIds = Array.from(new Set(payload.orderIds));

    if (payload.scope === 'SINGLE_ORDER' && normalizedOrderIds.length !== 1) {
      throw new FulfillmentHttpError(400, 'SINGLE_ORDER scope requires exactly one orderId', 'INVALID_SCOPE');
    }

    await this.validateCombinedShipmentEligibility(orgId, normalizedOrderIds);

    const primaryOrderId = payload.primaryOrderId || normalizedOrderIds[0];
    if (!normalizedOrderIds.includes(primaryOrderId)) {
      throw new FulfillmentHttpError(400, 'primaryOrderId must be included in orderIds', 'INVALID_PRIMARY_ORDER');
    }

    const shipment = await this.shipmentRepo.createDraftShipment(orgId, {
      scope: payload.scope,
      orderIds: normalizedOrderIds,
      primaryOrderId,
      createdByUserId: payload.actorUserId,
    });
    if (await this.getPackingMode(orgId) === 'simple_verified_packing') {
      await this.syncSimpleShipmentAllocations(orgId, shipment.id, payload.actorUserId);
    }
    return this.shipmentRepo.getShipmentById(orgId, shipment.id) ?? shipment;
  }

  async getShipment(orgId: string, shipmentId: string) {
    const shipment = await this.shipmentRepo.getShipmentById(orgId, shipmentId);
    return shipment ? { ...shipment, packingMode: await this.getPackingMode(orgId), boxCount: shipment.packages.length } : null;
  }

  async patchShipment(orgId: string, shipmentId: string, payload: {
    carrier?: string | null;
    serviceLevel?: string | null;
    trackingNumber?: string | null;
    shipDate?: string | null;
    boxCount?: number | null;
    weight?: number | null;
    dims?: {
      length?: number | null;
      width?: number | null;
      height?: number | null;
    };
    internalNotes?: string | null;
    shipmentItems?: Array<{
      orderId: string;
      orderLineItemId: string;
      quantity: number;
      packageId?: string | null;
    }>;
    packages?: Array<{
      id: string;
      weightLbs?: number | null;
      dims?: { length?: number | null; width?: number | null; height?: number | null };
      notes?: string | null;
    }>;
    actorUserId?: string | null;
  }) {
    const existing = await this.shipmentRepo.getShipmentById(orgId, shipmentId);
    if (!existing) {
      throw new FulfillmentHttpError(404, 'Shipment not found', 'NOT_FOUND');
    }
    if (existing.status !== 'DRAFT') {
      throw new FulfillmentHttpError(400, 'Only DRAFT shipments are editable', 'INVALID_STATE');
    }

    let parsedShipDate: Date | null | undefined;
    try {
      const dateOnly = payload.shipDate === undefined ? undefined : parseShipmentDate(payload.shipDate);
      // `shipments.shipDate` uses Drizzle's `date({ mode: 'date' })` mapping,
      // which serializes a JavaScript Date. Passing the validated date-only
      // string through causes Drizzle to call `.toISOString()` on a string at
      // update time. Construct midnight UTC only after validating the calendar
      // date so this remains a date-only operational value, not a local-time
      // timestamp conversion.
      parsedShipDate = dateOnly == null ? dateOnly : new Date(`${dateOnly}T00:00:00.000Z`);
    }
    catch (error: any) { throw new FulfillmentHttpError(400, error.message, 'SHIP_DATE_INVALID'); }

    const updated = await this.shipmentRepo.patchDraftShipment(orgId, shipmentId, {
      carrier: payload.carrier,
      serviceLevel: payload.serviceLevel,
      trackingNumber: payload.trackingNumber,
      shipDate: parsedShipDate,
      boxCount: payload.boxCount,
      weightLbs: payload.weight,
      dimLengthIn: payload.dims?.length,
      dimWidthIn: payload.dims?.width,
      dimHeightIn: payload.dims?.height,
      internalNotes: payload.internalNotes,
    });

    if (!updated) {
      throw new FulfillmentHttpError(404, 'Shipment not found', 'NOT_FOUND');
    }

    if (payload.packages) {
      await this.shipmentRepo.patchDraftShipmentPackages(orgId, shipmentId, payload.packages.map((item) => ({
        id: item.id,
        weightLbs: item.weightLbs,
        dimLengthIn: item.dims?.length,
        dimWidthIn: item.dims?.width,
        dimHeightIn: item.dims?.height,
        notes: item.notes,
      })));
    }

    if (payload.shipmentItems) {
      await this.assertExplicitAllocationsEligible(orgId, payload.shipmentItems);
      const replacement = await this.shipmentRepo.replaceDraftShipmentItems(orgId, shipmentId, payload.shipmentItems);
      if (!replacement.ok) {
        throw new FulfillmentHttpError(409, replacement.message, replacement.code);
      }
    }

    await this.shipmentRepo.insertEvent(
      orgId,
      payload.actorUserId || null,
      'SHIPMENT',
      shipmentId,
      'SHIPMENT_UPDATED',
      { hasItemsUpdate: !!payload.shipmentItems },
    );

    return this.shipmentRepo.getShipmentById(orgId, shipmentId);
  }

  /** Order shippingMethod is the current fulfillment intent. Historical draft
   * execution records remain auditable, but terminal fulfillment cannot be
   * silently reclassified between Ship and Pickup. */
  async assertFulfillmentMethodChangeAllowed(orgId: string, orderId: string, nextShippingMethod: string | null | undefined) {
    const [order] = await this.dbInstance.select({
      id: orders.id,
      shippingMethod: orders.shippingMethod,
      fulfillmentStatus: orders.fulfillmentStatus,
    }).from(orders).where(and(eq(orders.organizationId, orgId), eq(orders.id, orderId))).limit(1);
    if (!order) throw new FulfillmentHttpError(404, 'Order not found', 'NOT_FOUND');
    const currentMethod = order.shippingMethod === 'pickup' ? 'pickup' : 'ship';
    const targetMethod = nextShippingMethod === 'pickup' ? 'pickup' : 'ship';
    if (currentMethod === targetMethod) return;

    const [pickupTicket] = await this.dbInstance.select({ status: pickupTickets.status })
      .from(pickupTickets).where(and(eq(pickupTickets.organizationId, orgId), eq(pickupTickets.orderId, orderId))).limit(1);
    const shipped = await this.dbInstance.select({ id: shipments.id }).from(shipmentOrders)
      .innerJoin(shipments, eq(shipments.id, shipmentOrders.shipmentId))
      .where(and(eq(shipmentOrders.organizationId, orgId), eq(shipmentOrders.orderId, orderId), eq(shipments.organizationId, orgId), eq(shipments.status, 'SHIPPED'))).limit(1);
    if (pickupTicket?.status === 'PICKED_UP' || shipped.length > 0 || ['shipped', 'delivered'].includes(String(order.fulfillmentStatus || '').toLowerCase())) {
      throw new FulfillmentHttpError(409, 'Completed shipment or pickup fulfillment cannot be changed without the existing reversal workflow.', 'FULFILLMENT_METHOD_TERMINAL');
    }
  }

  private async getVerificationPolicy(orgId: string): Promise<FulfillmentVerificationPolicy> {
    const [organization] = await this.dbInstance.select({ settings: organizations.settings })
      .from(organizations).where(eq(organizations.id, orgId)).limit(1);
    return fulfillmentVerificationPolicyFromSettings(organization?.settings);
  }

  private async getPackingMode(orgId: string): Promise<FulfillmentPackingMode> {
    const [organization] = await this.dbInstance.select({ settings: organizations.settings })
      .from(organizations).where(eq(organizations.id, orgId)).limit(1);
    return fulfillmentPackingModeFromSettings(organization?.settings);
  }

  private async assertExplicitAllocationsEligible(orgId: string, items: Array<{ orderId: string; orderLineItemId: string; quantity: number }>) {
    const lineItemIds = Array.from(new Set(items.map((item) => item.orderLineItemId)));
    if (!lineItemIds.length) return;
    const lines = await this.dashboardRepo.listLineEligibility(orgId, { lineItemIds });
    const byId = new Map(lines.map((line) => [line.id, line]));
    const quantityByLine = new Map<string, number>();
    for (const item of items) quantityByLine.set(item.orderLineItemId, (quantityByLine.get(item.orderLineItemId) ?? 0) + Number(item.quantity));
    for (const [lineItemId, quantity] of quantityByLine) {
      const line = byId.get(lineItemId);
      if (!line || line.orderId !== items.find((item) => item.orderLineItemId === lineItemId)?.orderId || !line.projection.requiresFulfillment) {
        throw new FulfillmentHttpError(409, 'Shipment quantities require a physical fulfillment line item.', 'LINE_NOT_FULFILLABLE');
      }
      const allowed = line.projection.remainingQuantity;
      if (quantity > allowed) throw new FulfillmentHttpError(409, 'Shipment quantity exceeds the remaining order quantity for a line item.', 'QTY_EXCEEDS_ORDER');
    }
  }

  /** Simple mode writes normal shipment_items and a real default package; it
   * only removes the repetitive entry work from the operator. */
  private async syncSimpleShipmentAllocations(orgId: string, shipmentId: string, actorUserId?: string | null) {
    const shipment = await this.shipmentRepo.getShipmentById(orgId, shipmentId);
    if (!shipment || shipment.status !== 'DRAFT') return;
    const orderIds = Array.from(new Set(shipment.orders.map((order: any) => String(order.orderId)).filter(Boolean)));
    if (!orderIds.length) return;
    const lines = await this.dashboardRepo.listLineEligibility(orgId, { orderIds });
    let defaultPackage = shipment.packages[0] ?? null;
    if (!defaultPackage) defaultPackage = await this.createShipmentPackage(orgId, shipmentId, { actorUserId });
    const items = lines.flatMap((line) => {
      const allocatableQuantity = line.projection.remainingQuantity;
      return line.projection.requiresFulfillment && allocatableQuantity > 0
        ? [{ orderId: line.orderId, orderLineItemId: line.id, quantity: allocatableQuantity, packageId: defaultPackage!.id }]
        : [];
    });
    const replacement = await this.shipmentRepo.replaceDraftShipmentItems(orgId, shipmentId, items);
    if (!replacement.ok) throw new FulfillmentHttpError(409, replacement.message, replacement.code);
  }

  /** Packing is eligible to satisfy verification only after the existing
   * production-complete fulfillment gate has been rechecked. */
  private async syncSimplePackedQuantities(orgId: string, shipmentId: string, actorUserId?: string | null, previousLineItemIds: string[] = []) {
    const current = await this.shipmentRepo.getShipmentById(orgId, shipmentId);
    const lineItemIds = Array.from(new Set([...(current?.items ?? []).map((item: any) => item.orderLineItemId), ...previousLineItemIds]));
    if (!lineItemIds.length) return;
    const rows = await this.dbInstance.select({
      lineItemId: shipmentItems.orderLineItemId, quantity: sql<number>`COALESCE(SUM(${shipmentItems.quantity}), 0)::int`,
      ordered: orderLineItems.quantity, orderId: orderLineItems.orderId, state: orders.state, status: orders.status,
      canceledAt: orders.canceledAt, routingTarget: orders.routingTarget,
    }).from(shipmentItems).innerJoin(shipments, eq(shipments.id, shipmentItems.shipmentId))
      .innerJoin(orderLineItems, eq(orderLineItems.id, shipmentItems.orderLineItemId)).innerJoin(orders, eq(orders.id, orderLineItems.orderId))
      .where(and(eq(shipmentItems.organizationId, orgId), eq(orders.organizationId, orgId), inArray(shipmentItems.orderLineItemId, lineItemIds), ne(shipments.status, 'VOIDED')))
      .groupBy(shipmentItems.orderLineItemId, orderLineItems.quantity, orderLineItems.orderId, orders.state, orders.status, orders.canceledAt, orders.routingTarget);
    const allLines = await this.dbInstance.select({ lineItemId: orderLineItems.id, ordered: orderLineItems.quantity, orderId: orderLineItems.orderId,
      state: orders.state, status: orders.status, canceledAt: orders.canceledAt, routingTarget: orders.routingTarget,
    }).from(orderLineItems).innerJoin(orders, eq(orders.id, orderLineItems.orderId)).where(and(eq(orders.organizationId, orgId), inArray(orderLineItems.id, lineItemIds)));
    const packedByLineItem = new Map(rows.map((row) => [row.lineItemId, Number(row.quantity || 0)]));
    for (const row of allLines) {
      if (!isFulfillmentQueueEligibleOrder(row as any)) {
        throw new FulfillmentHttpError(409, 'Packed quantities require production-complete fulfillment eligibility', 'PRODUCTION_NOT_COMPLETE');
      }
      await this.dashboardRepo.ensureChecklistItemsForOrder(orgId, row.orderId);
      const fulfilled = Math.min(packedByLineItem.get(row.lineItemId) || 0, Number(row.ordered || 0));
      const isComplete = fulfilled >= Number(row.ordered || 0);
      await this.dbInstance.update(fulfillmentChecklistItems).set({ fulfilledQuantity: fulfilled, checked: isComplete,
        checkedByUserId: isComplete ? actorUserId || null : null, checkedAt: isComplete ? new Date() : null, updatedAt: new Date(),
      }).where(and(eq(fulfillmentChecklistItems.organizationId, orgId), eq(fulfillmentChecklistItems.lineItemId, row.lineItemId)));
    }
  }

  async createShipmentPackage(orgId: string, shipmentId: string, payload: {
    weightLbs?: number | null;
    dims?: { length?: number | null; width?: number | null; height?: number | null };
    notes?: string | null;
    actorUserId?: string | null;
  }) {
    const created = await this.shipmentRepo.createShipmentPackage(orgId, shipmentId, {
      weightLbs: payload.weightLbs,
      dimLengthIn: payload.dims?.length,
      dimWidthIn: payload.dims?.width,
      dimHeightIn: payload.dims?.height,
      notes: payload.notes,
    });
    if (!created) throw new FulfillmentHttpError(404, 'Draft shipment not found', 'NOT_FOUND');
    await this.shipmentRepo.insertEvent(orgId, payload.actorUserId || null, 'SHIPMENT', shipmentId, 'SHIPMENT_UPDATED', {
      packageId: created.id, action: 'package_created', packageReference: created.packageReference,
    });
    return created;
  }

  async deleteShipmentPackage(orgId: string, shipmentId: string, packageId: string, actorUserId?: string | null) {
    const deleted = await this.shipmentRepo.deleteShipmentPackage(orgId, shipmentId, packageId);
    if (!deleted) throw new FulfillmentHttpError(404, 'Draft shipment package not found', 'NOT_FOUND');
    await this.shipmentRepo.insertEvent(orgId, actorUserId || null, 'SHIPMENT', shipmentId, 'SHIPMENT_UPDATED', {
      packageId, action: 'package_deleted',
    });
    return deleted;
  }

  async markShipmentShipped(orgId: string, shipmentId: string, actorUserId?: string | null, options: { suppressBillingAutomation?: boolean } = {}) {
    let existing = await this.shipmentRepo.getShipmentById(orgId, shipmentId);
    if (!existing) {
      throw new FulfillmentHttpError(404, 'Shipment not found', 'NOT_FOUND');
    }
    if (await this.getPackingMode(orgId) === 'simple_verified_packing' && !hasExplicitSplitAllocations(existing)) {
      await this.syncSimpleShipmentAllocations(orgId, shipmentId, actorUserId);
      existing = await this.shipmentRepo.getShipmentById(orgId, shipmentId);
      if (!existing) throw new FulfillmentHttpError(404, 'Shipment not found', 'NOT_FOUND');
    }
    const linkedOrders = await this.dashboardRepo.getOrdersForCombinedShipmentValidation(orgId, (existing.orders || []).map((order: any) => order.orderId));
    if (linkedOrders.some((order: any) => order.shippingMethod === 'pickup')) {
      throw new FulfillmentHttpError(409, 'This Order is currently Pickup. A draft shipment cannot be marked shipped.', 'FULFILLMENT_METHOD_MISMATCH');
    }
    const canceledOrder = (existing.orders || []).find((order: any) =>
      isCanceledOrder({ state: order.orderState, status: order.orderStatus, canceledAt: order.orderCanceledAt }),
    );
    if (canceledOrder) {
      throw new FulfillmentHttpError(409, 'Cancelled orders cannot be marked shipped', 'ORDER_CANCELLED');
    }

    const orderIds = Array.from(new Set((existing.orders || []).map((order: any) => String(order.orderId)).filter(Boolean)));
    await this.assertExplicitAllocationsEligible(orgId, (existing.items || []).map((item: any) => ({
      orderId: String(item.orderId),
      orderLineItemId: String(item.orderLineItemId),
      quantity: Number(item.quantity || 0),
    })));
    const result = await this.shipmentRepo.markShipped(orgId, shipmentId, actorUserId);

    if (!result.ok) {
      if (result.code === 'NOT_FOUND') throw new FulfillmentHttpError(404, result.message, result.code);
      throw new FulfillmentHttpError(400, result.message, result.code);
    }

    const billingAutomationResults: BillingInvoiceAutomationResult[] = [];
    for (const orderId of orderIds) {
      await this.dashboardRepo.logChecklistVerified(orgId, orderId, actorUserId, { terminalAction: 'SHIPMENT_SHIPPED', shipmentId });
      if (!options.suppressBillingAutomation) {
        billingAutomationResults.push(await this.ensureTerminalBilling({
          organizationId: orgId,
          orderId,
          trigger: 'picked_up_or_shipped',
          sourceEvent: 'SHIPMENT_SHIPPED',
          actorUserId,
        }));
      }
    }
    return { ...(result.shipment as any), billingAutomation: billingAutomationResults };
  }

  async voidShipment(orgId: string, shipmentId: string, actorUserId?: string | null) {
    const result = await this.shipmentRepo.voidShipment(orgId, shipmentId, actorUserId);

    if (!result.ok) {
      if (result.code === 'NOT_FOUND') throw new FulfillmentHttpError(404, result.message, result.code);
      throw new FulfillmentHttpError(400, result.message, result.code);
    }

    return result.shipment;
  }

  async createOrGetPickupTicket(orgId: string, orderId: string, actorUserId?: string | null) {
    const [order] = await db
      .select({
        id: orders.id,
        shippingMethod: orders.shippingMethod,
        state: orders.state,
        status: orders.status,
        canceledAt: orders.canceledAt,
      })
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.organizationId, orgId)))
      .limit(1);

    if (!order) throw new FulfillmentHttpError(404, 'Order not found', 'NOT_FOUND');
    if (isCanceledOrder(order)) {
      throw new FulfillmentHttpError(409, 'Cancelled orders cannot create pickup tickets', 'ORDER_CANCELLED');
    }
    if (order.shippingMethod !== 'pickup') {
      throw new FulfillmentHttpError(400, 'Pickup tickets can only be created for pickup orders', 'MIXED_FULFILLMENT_TYPES');
    }

    return this.pickupRepo.createOrGetDraftTicket(orgId, orderId, actorUserId);
  }

  async markPickupReady(orgId: string, ticketId: string, payload: {
    stagingLocation?: string | null;
    pickupNotes?: string | null;
    contactName?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    overrideProductionComplete?: boolean;
  }, actorUserId?: string | null, actorUserRole?: string | null) {
    const [ticketWithOrder] = await db
      .select({
        ticketId: pickupTickets.id,
        orderId: pickupTickets.orderId,
        status: pickupTickets.status,
        orderState: orders.state,
        orderStatus: orders.status,
        orderCanceledAt: orders.canceledAt,
        shippingMethod: orders.shippingMethod,
        productionCompletedAt: orders.productionCompletedAt,
        completedProductionAt: orders.completedProductionAt,
        orderNumber: orders.orderNumber,
        displayNumber: orders.displayNumber,
        customerName: customers.companyName,
      })
      .from(pickupTickets)
      .innerJoin(orders, eq(orders.id, pickupTickets.orderId))
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .where(and(eq(pickupTickets.id, ticketId), eq(pickupTickets.organizationId, orgId), eq(orders.organizationId, orgId)))
      .limit(1);

    if (!ticketWithOrder) throw new FulfillmentHttpError(404, 'Pickup ticket not found', 'NOT_FOUND');
    if (ticketWithOrder.shippingMethod !== 'pickup') throw new FulfillmentHttpError(409, 'This Order is currently Ship. Pickup cannot be marked ready.', 'FULFILLMENT_METHOD_MISMATCH');
    const shippedForOrder = await this.dbInstance.select({ id: shipments.id }).from(shipmentOrders)
      .innerJoin(shipments, eq(shipments.id, shipmentOrders.shipmentId))
      .where(and(eq(shipmentOrders.organizationId, orgId), eq(shipmentOrders.orderId, ticketWithOrder.orderId), eq(shipments.organizationId, orgId), eq(shipments.status, 'SHIPPED'))).limit(1);
    if (shippedForOrder.length) throw new FulfillmentHttpError(409, 'A shipped fulfillment record must be reversed before pickup can be readied.', 'FULFILLMENT_METHOD_TERMINAL');
    if (isCanceledOrder({
      state: ticketWithOrder.orderState,
      status: ticketWithOrder.orderStatus,
      canceledAt: ticketWithOrder.orderCanceledAt,
    })) {
      throw new FulfillmentHttpError(409, 'Cancelled orders cannot advance pickup fulfillment', 'ORDER_CANCELLED');
    }

    const markResult = await this.pickupRepo.markReady(orgId, ticketId, {
      stagingLocation: payload.stagingLocation,
      pickupNotes: payload.pickupNotes,
      contactName: payload.contactName,
      contactEmail: payload.contactEmail,
      contactPhone: payload.contactPhone,
      overrideProductionCompleteUsed: false,
      overrideActorRole: actorUserRole || null,
    }, actorUserId);

    if (!markResult.ok) {
      if (markResult.code === 'NOT_FOUND') throw new FulfillmentHttpError(404, markResult.message, markResult.code);
      throw new FulfillmentHttpError(400, markResult.message, markResult.code);
    }

    const { notification, ticket } = markResult;
    await this.dashboardRepo.logChecklistVerified(orgId, ticketWithOrder.orderId, actorUserId, {
      terminalAction: 'PICKUP_READY',
      pickupTicketId: ticket.id,
    });

    const billingAutomation = await this.ensureTerminalBilling({
      organizationId: orgId,
      orderId: ticketWithOrder.orderId,
      trigger: 'ready_for_pickup_or_ready_to_ship',
      sourceEvent: 'PICKUP_READY',
      actorUserId,
    });

    // Fail-soft notification attempt.
    if (!notification.toAddress) {
      const errorMessage = 'No pickup contact email found';
      await this.pickupRepo.updateNotificationFailed(orgId, notification.id, errorMessage);
      await this.shipmentRepo.insertEvent(orgId, actorUserId || null, 'PICKUP_TICKET', ticket.id, 'NOTIFICATION_FAILED', {
        notificationId: notification.id,
        errorMessage,
      });
      return {
        ticket,
        billingAutomation,
        notification: {
          id: notification.id,
          status: 'FAILED',
          errorMessage,
        },
      };
    }

    try {
      const orderDisplayNumber = ticketWithOrder.displayNumber || ticketWithOrder.orderNumber;
      const providerMessageId = await emailService.sendEmail(orgId, {
        to: notification.toAddress,
        subject: `Order ${orderDisplayNumber} is ready for pickup`,
        html: [
          `<p>Hello ${ticket.contactName || ticketWithOrder.customerName || 'Customer'},</p>`,
          `<p>Your order <strong>${orderDisplayNumber}</strong> is now ready for pickup.</p>`,
          ticket.stagingLocation ? `<p>Pickup location: ${ticket.stagingLocation}</p>` : '',
          ticket.pickupNotes ? `<p>Notes: ${ticket.pickupNotes}</p>` : '',
        ].join(''),
      });

      await this.pickupRepo.updateNotificationSent(orgId, notification.id, providerMessageId);
      await this.shipmentRepo.insertEvent(orgId, actorUserId || null, 'PICKUP_TICKET', ticket.id, 'NOTIFICATION_SENT', {
        notificationId: notification.id,
      });

      return {
        ticket,
        billingAutomation,
        notification: {
          id: notification.id,
          status: 'SENT',
        },
      };
    } catch (error: any) {
      const errorMessage = String(error?.message || error || 'Notification failed');
      await this.pickupRepo.updateNotificationFailed(orgId, notification.id, errorMessage);
      await this.shipmentRepo.insertEvent(orgId, actorUserId || null, 'PICKUP_TICKET', ticket.id, 'NOTIFICATION_FAILED', {
        notificationId: notification.id,
        errorMessage,
      });

      return {
        ticket,
        billingAutomation,
        notification: {
          id: notification.id,
          status: 'FAILED',
          errorMessage,
        },
      };
    }
  }

  async markPickupPickedUp(orgId: string, ticketId: string, actorUserId?: string | null) {
    if (ticketId || !ticketId) throw new FulfillmentHttpError(409, 'Use the quantity-aware pickup handoff action; whole-order pickup is no longer permitted.', 'PICKUP_QUANTITY_REQUIRED');
    const [ticketWithOrder] = await db
      .select({
        orderId: pickupTickets.orderId,
        orderState: orders.state,
        orderStatus: orders.status,
        orderCanceledAt: orders.canceledAt,
        shippingMethod: orders.shippingMethod,
      })
      .from(pickupTickets)
      .innerJoin(orders, eq(orders.id, pickupTickets.orderId))
      .where(and(eq(pickupTickets.id, ticketId), eq(pickupTickets.organizationId, orgId), eq(orders.organizationId, orgId)))
      .limit(1);

    if (!ticketWithOrder) throw new FulfillmentHttpError(404, 'Pickup ticket not found', 'NOT_FOUND');
    if (ticketWithOrder.shippingMethod !== 'pickup') throw new FulfillmentHttpError(409, 'This Order is currently Ship. Pickup cannot be marked picked up.', 'FULFILLMENT_METHOD_MISMATCH');
    const shippedForOrder = await this.dbInstance.select({ id: shipments.id }).from(shipmentOrders)
      .innerJoin(shipments, eq(shipments.id, shipmentOrders.shipmentId))
      .where(and(eq(shipmentOrders.organizationId, orgId), eq(shipmentOrders.orderId, ticketWithOrder.orderId), eq(shipments.organizationId, orgId), eq(shipments.status, 'SHIPPED'))).limit(1);
    if (shippedForOrder.length) throw new FulfillmentHttpError(409, 'A shipped fulfillment record must be reversed before pickup can be marked picked up.', 'FULFILLMENT_METHOD_TERMINAL');
    if (isCanceledOrder({
      state: ticketWithOrder.orderState,
      status: ticketWithOrder.orderStatus,
      canceledAt: ticketWithOrder.orderCanceledAt,
    })) {
      throw new FulfillmentHttpError(409, 'Cancelled orders cannot advance pickup fulfillment', 'ORDER_CANCELLED');
    }

    const result = await this.pickupRepo.markPickedUp(orgId, ticketId, actorUserId);

    if (!result.ok) {
      if (result.code === 'NOT_FOUND') throw new FulfillmentHttpError(404, result.message, result.code);
      throw new FulfillmentHttpError(400, result.message, result.code);
    }

    const billingAutomation = await this.ensureTerminalBilling({
      organizationId: orgId,
      orderId: ticketWithOrder.orderId,
      trigger: 'picked_up_or_shipped',
      sourceEvent: 'PICKUP_PICKED_UP',
      actorUserId,
    });

    return { ...(result.ticket as any), billingAutomation };
  }

  async recordPickupHandoff(orgId: string, ticketId: string, payload: {
    items: Array<{ orderLineItemId: string; quantity: number }>;
    notes?: string | null;
    clientRequestId?: string | null;
  }, actorUserId?: string | null) {
    const [ticketWithOrder] = await this.dbInstance.select({
      orderId: pickupTickets.orderId, shippingMethod: orders.shippingMethod, state: orders.state, status: orders.status, canceledAt: orders.canceledAt,
    }).from(pickupTickets).innerJoin(orders, eq(orders.id, pickupTickets.orderId)).where(and(
      eq(pickupTickets.id, ticketId), eq(pickupTickets.organizationId, orgId), eq(orders.organizationId, orgId),
    )).limit(1);
    if (!ticketWithOrder) throw new FulfillmentHttpError(404, 'Pickup ticket not found', 'NOT_FOUND');
    if (ticketWithOrder.shippingMethod !== 'pickup') throw new FulfillmentHttpError(409, 'This Order is currently Ship. Pickup cannot be recorded.', 'FULFILLMENT_METHOD_MISMATCH');
    if (isCanceledOrder(ticketWithOrder)) throw new FulfillmentHttpError(409, 'Cancelled orders cannot advance pickup fulfillment', 'ORDER_CANCELLED');
    const result = await this.pickupRepo.recordPartialPickup(orgId, ticketId, payload, actorUserId);
    if (!result.ok) throw new FulfillmentHttpError(result.code === 'NOT_FOUND' ? 404 : 409, result.message, result.code);
    const billingAutomation = await this.ensureTerminalBilling({ organizationId: orgId, orderId: ticketWithOrder.orderId,
      trigger: 'picked_up_or_shipped', sourceEvent: 'PICKUP_HANDOFF_RECORDED', actorUserId });
    return { ...result, billingAutomation };
  }
}

export const fulfillmentServiceV2 = new FulfillmentService();

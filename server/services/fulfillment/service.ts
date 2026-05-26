import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { emailService } from '../../emailService';
import { customers, orders, pickupTickets, shipmentItems, shipmentOrders, shipments } from '@shared/schema';
import { FulfillmentDashboardRepo, PickupRepo, ShipmentRepo } from './repository';
import { FulfillmentHttpError } from './types';
import { isCanceledOrder } from '@shared/operationalState';

export class FulfillmentService {
  private readonly shipmentRepo = new ShipmentRepo(db);
  private readonly pickupRepo = new PickupRepo(db);
  private readonly dashboardRepo = new FulfillmentDashboardRepo(db);

  private canOverridePickupReady(actorRole?: string | null): boolean {
    const normalizedRole = String(actorRole || '').trim().toLowerCase();
    return normalizedRole === 'owner' || normalizedRole === 'admin';
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
    page: number;
    pageSize: number;
  }) {
    return this.dashboardRepo.listFulfillmentQueue(orgId, filters);
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

    const lineItemCounts = await this.dashboardRepo.getLineItemCountsForOrders(uniqueOrderIds);
    const lineItemCountByOrderId = new Map(lineItemCounts.map((r) => [r.orderId, r.count]));

    for (const order of ordersForValidation) {
      if (isCanceledOrder(order)) {
        throw new FulfillmentHttpError(400, `Order ${order.id} is cancelled and not ship-eligible`, 'ORDER_NOT_SHIP_ELIGIBLE');
      }

      if (order.state !== 'production_complete' || order.routingTarget !== 'fulfillment') {
        throw new FulfillmentHttpError(400, `Order ${order.id} is not yet eligible for fulfillment`, 'ORDER_NOT_FULFILLMENT_ELIGIBLE');
      }

      if (order.shippingMethod === 'pickup') {
        throw new FulfillmentHttpError(400, 'Cannot combine pickup and shipping orders', 'MIXED_FULFILLMENT_TYPES');
      }

      const lineItemCount = lineItemCountByOrderId.get(order.id) || 0;
      if (lineItemCount <= 0) {
        throw new FulfillmentHttpError(400, `Order ${order.id} has no shippable line items`, 'ORDER_NOT_SHIP_ELIGIBLE');
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

    return this.shipmentRepo.createDraftShipment(orgId, {
      scope: payload.scope,
      orderIds: normalizedOrderIds,
      primaryOrderId,
      createdByUserId: payload.actorUserId,
    });
  }

  async getShipment(orgId: string, shipmentId: string) {
    return this.shipmentRepo.getShipmentById(orgId, shipmentId);
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

    const parsedShipDate = payload.shipDate ? new Date(payload.shipDate) : null;

    if (payload.shipDate && Number.isNaN(parsedShipDate?.getTime())) {
      throw new FulfillmentHttpError(400, 'Invalid shipDate', 'VALIDATION_ERROR');
    }

    const updated = await this.shipmentRepo.patchDraftShipment(orgId, shipmentId, {
      carrier: payload.carrier,
      serviceLevel: payload.serviceLevel,
      trackingNumber: payload.trackingNumber,
      shipDate: payload.shipDate ? parsedShipDate : undefined,
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

    if (payload.shipmentItems) {
      await this.shipmentRepo.upsertShipmentItems(orgId, shipmentId, payload.shipmentItems);
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

  async markShipmentShipped(orgId: string, shipmentId: string, actorUserId?: string | null) {
    const existing = await this.shipmentRepo.getShipmentById(orgId, shipmentId);
    if (!existing) {
      throw new FulfillmentHttpError(404, 'Shipment not found', 'NOT_FOUND');
    }
    const canceledOrder = (existing.orders || []).find((order: any) =>
      isCanceledOrder({ state: order.orderState, status: order.orderStatus, canceledAt: order.orderCanceledAt }),
    );
    if (canceledOrder) {
      throw new FulfillmentHttpError(409, 'Cancelled orders cannot be marked shipped', 'ORDER_CANCELLED');
    }

    const result = await this.shipmentRepo.markShipped(orgId, shipmentId, actorUserId);

    if (!result.ok) {
      if (result.code === 'NOT_FOUND') throw new FulfillmentHttpError(404, result.message, result.code);
      throw new FulfillmentHttpError(400, result.message, result.code);
    }

    return result.shipment;
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
    if (isCanceledOrder({
      state: ticketWithOrder.orderState,
      status: ticketWithOrder.orderStatus,
      canceledAt: ticketWithOrder.orderCanceledAt,
    })) {
      throw new FulfillmentHttpError(409, 'Cancelled orders cannot advance pickup fulfillment', 'ORDER_CANCELLED');
    }

    const productionComplete = this.isOrderProductionComplete({
      state: ticketWithOrder.orderState,
      productionCompletedAt: ticketWithOrder.productionCompletedAt,
      completedProductionAt: ticketWithOrder.completedProductionAt,
    });

    const overrideRequested = payload.overrideProductionComplete === true;
    const overrideAllowed = this.canOverridePickupReady(actorUserRole);

    if (!productionComplete && !overrideRequested) {
      throw new FulfillmentHttpError(400, 'Order production must be complete before pickup-ready', 'PRODUCTION_NOT_COMPLETE');
    }

    if (!productionComplete && overrideRequested && !overrideAllowed) {
      throw new FulfillmentHttpError(403, 'Only Owner/Admin may override production-complete for pickup-ready', 'PICKUP_READY_OVERRIDE_FORBIDDEN');
    }

    const markResult = await this.pickupRepo.markReady(orgId, ticketId, {
      stagingLocation: payload.stagingLocation,
      pickupNotes: payload.pickupNotes,
      contactName: payload.contactName,
      contactEmail: payload.contactEmail,
      contactPhone: payload.contactPhone,
      overrideProductionCompleteUsed: !productionComplete && overrideRequested,
      overrideActorRole: actorUserRole || null,
    }, actorUserId);

    if (!markResult.ok) {
      if (markResult.code === 'NOT_FOUND') throw new FulfillmentHttpError(404, markResult.message, markResult.code);
      throw new FulfillmentHttpError(400, markResult.message, markResult.code);
    }

    const { notification, ticket } = markResult;

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
        notification: {
          id: notification.id,
          status: 'FAILED',
          errorMessage,
        },
      };
    }
  }

  async markPickupPickedUp(orgId: string, ticketId: string, actorUserId?: string | null) {
    const [ticketWithOrder] = await db
      .select({
        orderState: orders.state,
        orderStatus: orders.status,
        orderCanceledAt: orders.canceledAt,
      })
      .from(pickupTickets)
      .innerJoin(orders, eq(orders.id, pickupTickets.orderId))
      .where(and(eq(pickupTickets.id, ticketId), eq(pickupTickets.organizationId, orgId), eq(orders.organizationId, orgId)))
      .limit(1);

    if (!ticketWithOrder) throw new FulfillmentHttpError(404, 'Pickup ticket not found', 'NOT_FOUND');
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

    return result.ticket;
  }
}

export const fulfillmentServiceV2 = new FulfillmentService();

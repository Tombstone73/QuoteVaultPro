import { and, desc, eq, ilike, inArray, ne, notInArray, or, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  customers,
  fulfillmentEvents,
  orderLineItems,
  orders,
  outboundNotifications,
  pickupTickets,
  productionJobs,
  shipmentItems,
  shipmentOrders,
  shipments,
} from '@shared/schema';
import type { DerivedOrderFulfillmentStatus, QueueRowDto } from './types';
import { TERMINAL_PRODUCTION_STATUSES } from '@shared/operationalState';
import { buildPrepressOptionRows, extractFinishingBullets } from '../../routes/flatStockNesting.shared';

const SHIP_READY_OVERDUE_HOURS = 48;
const PRINT_CONTEXT_EXCLUDED_STATIONS = new Set(['fulfillment', 'prepress', 'design']);

type DbExecutor = typeof db;

function toShipAddressKey(order: {
  shipToName: string | null;
  shipToCompany: string | null;
  shipToAddress1: string | null;
  shipToAddress2: string | null;
  shipToCity: string | null;
  shipToState: string | null;
  shipToPostalCode: string | null;
  shipToCountry: string | null;
}) {
  const normalize = (v: string | null | undefined) => String(v || '').trim();
  return [
    normalize(order.shipToName),
    normalize(order.shipToCompany),
    normalize(order.shipToAddress1),
    normalize(order.shipToAddress2),
    normalize(order.shipToCity),
    normalize(order.shipToState),
    normalize(order.shipToPostalCode),
    normalize(order.shipToCountry),
  ].join('|');
}

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function uniqueNonEmpty(values: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = cleanText(value);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push(text);
  }
  return out;
}

function latestIso(values: unknown[]): string | null {
  const latest = values
    .map((value) => {
      const ms = value ? new Date(value as any).getTime() : Number.NaN;
      return Number.isFinite(ms) ? ms : null;
    })
    .filter((value): value is number => value != null)
    .sort((a, b) => b - a)[0];
  return latest ? new Date(latest).toISOString() : null;
}

function buildLineItemProductionContext(lineItem: any) {
  const optionRows = buildPrepressOptionRows(lineItem);
  const lamination = optionRows.find((row) =>
    /laminat/i.test(row.optionLabel) && !/^(none|no|false|not selected|n\/a)$/i.test(cleanText(row.selectedLabel)),
  );
  const registrationMarks = optionRows
    .filter((row) => /(registration|reg\.?\s*mark|marks?)/i.test(row.optionLabel))
    .filter((row) => !/^(none|no|false|not selected|n\/a)$/i.test(cleanText(row.selectedLabel)))
    .map((row) => `${row.optionLabel}: ${row.selectedLabel}`);

  return {
    finishingRequirements: extractFinishingBullets(lineItem),
    lamination: lamination?.selectedLabel ?? null,
    registrationMarks,
    productionNotes: cleanText(lineItem?.productionNotes) ? [cleanText(lineItem.productionNotes)] : [],
  };
}

export class ShipmentRepo {
  constructor(private readonly dbInstance: DbExecutor = db) {}

  private async syncShipOrderFulfillmentStatus(runner: any, orgId: string, orderId: string) {
    const [orderedRow] = await runner
      .select({
        orderedQty: sql<number>`COALESCE(SUM(${orderLineItems.quantity}), 0)::int`,
      })
      .from(orderLineItems)
      .where(eq(orderLineItems.orderId, orderId));

    const [shippedRow] = await runner
      .select({
        shippedQty: sql<number>`COALESCE(SUM(${shipmentItems.quantity}), 0)::int`,
      })
      .from(shipmentItems)
      .innerJoin(shipments, eq(shipments.id, shipmentItems.shipmentId))
      .where(and(
        eq(shipmentItems.orderId, orderId),
        eq(shipmentItems.organizationId, orgId),
        eq(shipments.organizationId, orgId),
        eq(shipments.status, 'SHIPPED'),
      ));

    const orderedQty = Number(orderedRow?.orderedQty || 0);
    const shippedQty = Number(shippedRow?.shippedQty || 0);

    const nextStatus = shippedQty <= 0
      ? 'pending'
      : (orderedQty > 0 && shippedQty >= orderedQty ? 'shipped' : 'packed');

    await runner
      .update(orders)
      .set({
        fulfillmentStatus: nextStatus,
        updatedAt: new Date(),
      })
      .where(and(eq(orders.id, orderId), eq(orders.organizationId, orgId)));

    return nextStatus;
  }

  async createDraftShipment(orgId: string, payload: {
    scope: 'SINGLE_ORDER' | 'MULTI_ORDER';
    orderIds: string[];
    primaryOrderId?: string;
    createdByUserId?: string | null;
  }) {
    const primaryOrderId = payload.primaryOrderId || payload.orderIds[0] || null;

    const [shipment] = await this.dbInstance
      .insert(shipments)
      .values({
        organizationId: orgId,
        status: 'DRAFT',
        scope: payload.scope,
        orderId: primaryOrderId,
        primaryOrderId,
        createdByUserId: payload.createdByUserId || null,
      })
      .returning();

    if (payload.orderIds.length > 0) {
      await this.dbInstance
        .insert(shipmentOrders)
        .values(payload.orderIds.map((orderId) => ({
          organizationId: orgId,
          shipmentId: shipment.id,
          orderId,
        })))
        .onConflictDoNothing();
    }

    await this.insertEvent(orgId, payload.createdByUserId || null, 'SHIPMENT', shipment.id, 'SHIPMENT_CREATED', {
      orderIds: payload.orderIds,
      scope: payload.scope,
    });

    return shipment;
  }

  async addOrdersToShipment(orgId: string, shipmentId: string, orderIds: string[]) {
    if (orderIds.length === 0) return;
    await this.dbInstance
      .insert(shipmentOrders)
      .values(orderIds.map((orderId) => ({
        organizationId: orgId,
        shipmentId,
        orderId,
      })))
      .onConflictDoNothing();
  }

  async upsertShipmentItems(orgId: string, shipmentId: string, items: Array<{
    orderId: string;
    orderLineItemId: string;
    quantity: number;
  }>) {
    await this.dbInstance
      .delete(shipmentItems)
      .where(and(eq(shipmentItems.organizationId, orgId), eq(shipmentItems.shipmentId, shipmentId)));

    if (items.length === 0) return;

    await this.dbInstance
      .insert(shipmentItems)
      .values(items.map((item) => ({
        organizationId: orgId,
        shipmentId,
        orderId: item.orderId,
        orderLineItemId: item.orderLineItemId,
        quantity: item.quantity,
      })));
  }

  async patchDraftShipment(orgId: string, shipmentId: string, patch: {
    carrier?: string | null;
    serviceLevel?: string | null;
    trackingNumber?: string | null;
    shipDate?: Date | null;
    boxCount?: number | null;
    weightLbs?: number | null;
    dimLengthIn?: number | null;
    dimWidthIn?: number | null;
    dimHeightIn?: number | null;
    internalNotes?: string | null;
  }) {
    const setPayload: any = {
      updatedAt: new Date(),
    };

    if (patch.carrier !== undefined) setPayload.carrier = patch.carrier;
    if (patch.serviceLevel !== undefined) setPayload.serviceLevel = patch.serviceLevel;
    if (patch.trackingNumber !== undefined) setPayload.trackingNumber = patch.trackingNumber;
    if (patch.shipDate !== undefined) setPayload.shipDate = patch.shipDate;
    if (patch.boxCount !== undefined) setPayload.boxCount = patch.boxCount;
    if (patch.weightLbs !== undefined) setPayload.weightLbs = patch.weightLbs == null ? null : String(patch.weightLbs);
    if (patch.dimLengthIn !== undefined) setPayload.dimLengthIn = patch.dimLengthIn == null ? null : String(patch.dimLengthIn);
    if (patch.dimWidthIn !== undefined) setPayload.dimWidthIn = patch.dimWidthIn == null ? null : String(patch.dimWidthIn);
    if (patch.dimHeightIn !== undefined) setPayload.dimHeightIn = patch.dimHeightIn == null ? null : String(patch.dimHeightIn);
    if (patch.internalNotes !== undefined) setPayload.internalNotes = patch.internalNotes;

    const [updated] = await this.dbInstance
      .update(shipments)
      .set(setPayload)
      .where(and(
        eq(shipments.id, shipmentId),
        eq(shipments.organizationId, orgId),
        eq(shipments.status, 'DRAFT'),
      ))
      .returning();

    return updated || null;
  }

  async markShipped(orgId: string, shipmentId: string, actorUserId?: string | null) {
    return this.dbInstance.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT ${shipments.id}
        FROM ${shipments}
        WHERE ${shipments.id} = ${shipmentId}
          AND ${shipments.organizationId} = ${orgId}
        FOR UPDATE
      `);

      const [shipment] = await tx
        .select()
        .from(shipments)
        .where(and(eq(shipments.id, shipmentId), eq(shipments.organizationId, orgId)))
        .limit(1);

      if (!shipment) return { ok: false as const, code: 'NOT_FOUND', message: 'Shipment not found' };
      if (shipment.status !== 'DRAFT') return { ok: false as const, code: 'INVALID_STATE', message: 'Only DRAFT shipments can be marked SHIPPED' };

      const draftItems = await tx
        .select()
        .from(shipmentItems)
        .where(and(eq(shipmentItems.organizationId, orgId), eq(shipmentItems.shipmentId, shipmentId)));

      if (draftItems.length === 0) {
        return { ok: false as const, code: 'EMPTY_SHIPMENT', message: 'Shipment must include at least one item before shipping' };
      }

      const draftByLineItem = new Map<string, number>();
      for (const item of draftItems) {
        const prev = draftByLineItem.get(item.orderLineItemId) || 0;
        draftByLineItem.set(item.orderLineItemId, prev + item.quantity);
      }

      const lineItemIds = Array.from(draftByLineItem.keys());
      const lineRows = lineItemIds.length > 0
        ? await tx
          .select({
            id: orderLineItems.id,
            quantity: orderLineItems.quantity,
          })
          .from(orderLineItems)
          .where(inArray(orderLineItems.id, lineItemIds))
        : [];

      const orderedQtyByLineItem = new Map(lineRows.map((row) => [row.id, row.quantity]));

      const shippedAggRows = lineItemIds.length > 0
        ? await tx
          .select({
            orderLineItemId: shipmentItems.orderLineItemId,
            shippedQty: sql<number>`COALESCE(SUM(${shipmentItems.quantity}), 0)::int`,
          })
          .from(shipmentItems)
          .innerJoin(shipments, eq(shipments.id, shipmentItems.shipmentId))
          .where(and(
            eq(shipments.organizationId, orgId),
            eq(shipments.status, 'SHIPPED'),
            inArray(shipmentItems.orderLineItemId, lineItemIds),
            ne(shipmentItems.shipmentId, shipmentId),
          ))
          .groupBy(shipmentItems.orderLineItemId)
        : [];

      const alreadyShippedByLineItem = new Map(shippedAggRows.map((row) => [row.orderLineItemId, row.shippedQty]));

      for (const [lineItemId, draftQty] of Array.from(draftByLineItem.entries())) {
        const orderedQty = orderedQtyByLineItem.get(lineItemId);
        if (!orderedQty) {
          return { ok: false as const, code: 'LINE_ITEM_NOT_FOUND', message: `Line item ${lineItemId} was not found` };
        }
        const shippedAlready = alreadyShippedByLineItem.get(lineItemId) || 0;
        const remaining = Math.max(orderedQty - shippedAlready, 0);
        if (draftQty > remaining) {
          return {
            ok: false as const,
            code: 'QTY_EXCEEDS_REMAINING',
            message: `Quantity exceeds remaining for line item ${lineItemId}`,
          };
        }
      }

      const now = new Date();
      const [updated] = await tx
        .update(shipments)
        .set({
          status: 'SHIPPED',
          shippedAt: now,
          shipDate: shipment.shipDate || now,
          updatedAt: now,
        })
        .where(and(eq(shipments.id, shipmentId), eq(shipments.organizationId, orgId), eq(shipments.status, 'DRAFT')))
        .returning();

      if (!updated) {
        return { ok: false as const, code: 'CONFLICT', message: 'Shipment state changed during update' };
      }

      await tx.insert(fulfillmentEvents).values({
        organizationId: orgId,
        actorUserId: actorUserId || null,
        entityType: 'SHIPMENT',
        entityId: shipmentId,
        eventType: 'SHIPMENT_SHIPPED',
        payloadJson: {
          itemCount: draftItems.length,
        },
      });

      const affectedOrderIds = Array.from(new Set(draftItems.map((item) => item.orderId)));
      for (const orderId of affectedOrderIds) {
        await this.syncShipOrderFulfillmentStatus(tx, orgId, orderId);
      }

      return { ok: true as const, shipment: updated };
    });
  }

  async voidShipment(orgId: string, shipmentId: string, actorUserId?: string | null) {
    return this.dbInstance.transaction(async (tx) => {
      const [shipment] = await tx
        .select()
        .from(shipments)
        .where(and(eq(shipments.id, shipmentId), eq(shipments.organizationId, orgId)))
        .limit(1);

      if (!shipment) return { ok: false as const, code: 'NOT_FOUND', message: 'Shipment not found' };
      if (shipment.status !== 'DRAFT') {
        return { ok: false as const, code: 'INVALID_STATE', message: 'Only DRAFT shipments can be voided in v1' };
      }

      const [updated] = await tx
        .update(shipments)
        .set({ status: 'VOIDED', updatedAt: new Date() })
        .where(and(eq(shipments.id, shipmentId), eq(shipments.organizationId, orgId), eq(shipments.status, 'DRAFT')))
        .returning();

      await tx.insert(fulfillmentEvents).values({
        organizationId: orgId,
        actorUserId: actorUserId || null,
        entityType: 'SHIPMENT',
        entityId: shipmentId,
        eventType: 'SHIPMENT_VOIDED',
        payloadJson: {},
      });

      return { ok: true as const, shipment: updated };
    });
  }

  async getShipmentById(orgId: string, shipmentId: string) {
    const [shipment] = await this.dbInstance
      .select()
      .from(shipments)
      .where(and(eq(shipments.id, shipmentId), eq(shipments.organizationId, orgId)))
      .limit(1);

    if (!shipment) return null;

    const [orderLinks, items] = await Promise.all([
      this.dbInstance
        .select({
          shipmentOrderId: shipmentOrders.id,
          orderId: shipmentOrders.orderId,
          orderNumber: orders.orderNumber,
          orderState: orders.state,
          orderStatus: orders.status,
          orderCanceledAt: orders.canceledAt,
          customerName: customers.companyName,
        })
        .from(shipmentOrders)
        .innerJoin(orders, eq(orders.id, shipmentOrders.orderId))
        .leftJoin(customers, eq(customers.id, orders.customerId))
        .where(and(
          eq(shipmentOrders.organizationId, orgId),
          eq(shipmentOrders.shipmentId, shipmentId),
        )),
      this.dbInstance
        .select({
          id: shipmentItems.id,
          orderId: shipmentItems.orderId,
          orderLineItemId: shipmentItems.orderLineItemId,
          quantity: shipmentItems.quantity,
        })
        .from(shipmentItems)
        .where(and(
          eq(shipmentItems.organizationId, orgId),
          eq(shipmentItems.shipmentId, shipmentId),
        )),
    ]);

    return {
      ...shipment,
      orders: orderLinks,
      items,
    };
  }

  async listShipments(orgId: string, filters: {
    status?: string;
    search?: string;
    page: number;
    pageSize: number;
  }) {
    const conditions = [eq(shipments.organizationId, orgId)] as any[];

    if (filters.status && filters.status !== 'all') {
      conditions.push(eq(shipments.status, filters.status.toUpperCase()));
    }

    if (filters.search) {
      const pattern = `%${filters.search.trim()}%`;
      conditions.push(or(
        ilike(shipments.trackingNumber, pattern),
        ilike(shipments.carrier, pattern),
      ));
    }

    const whereClause = and(...conditions);

    const [{ total }] = await this.dbInstance
      .select({ total: sql<number>`count(*)::int` })
      .from(shipments)
      .where(whereClause);

    const rows = await this.dbInstance
      .select()
      .from(shipments)
      .where(whereClause)
      .orderBy(desc(shipments.updatedAt), desc(shipments.createdAt))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize);

    return { rows, total };
  }

  async insertEvent(
    orgId: string,
    actorUserId: string | null,
    entityType: 'SHIPMENT' | 'PICKUP_TICKET',
    entityId: string,
    eventType:
      | 'SHIPMENT_CREATED'
      | 'SHIPMENT_UPDATED'
      | 'SHIPMENT_SHIPPED'
      | 'SHIPMENT_VOIDED'
      | 'PICKUP_READY'
      | 'PICKUP_PICKED_UP'
      | 'NOTIFICATION_SENT'
      | 'NOTIFICATION_FAILED',
    payloadJson: Record<string, any>,
    tx?: any,
  ) {
    const runner = tx || this.dbInstance;
    await runner.insert(fulfillmentEvents).values({
      organizationId: orgId,
      actorUserId,
      entityType,
      entityId,
      eventType,
      payloadJson,
    });
  }
}

export class PickupRepo {
  constructor(private readonly dbInstance: DbExecutor = db) {}

  async createOrGetDraftTicket(orgId: string, orderId: string, createdByUserId?: string | null) {
    const [existing] = await this.dbInstance
      .select()
      .from(pickupTickets)
      .where(and(eq(pickupTickets.organizationId, orgId), eq(pickupTickets.orderId, orderId)))
      .limit(1);

    if (existing) return existing;

    const [created] = await this.dbInstance
      .insert(pickupTickets)
      .values({
        organizationId: orgId,
        orderId,
        status: 'DRAFT',
        createdByUserId: createdByUserId || null,
      })
      .returning();

    return created;
  }

  async markReady(
    orgId: string,
    ticketId: string,
    payload: {
      stagingLocation?: string | null;
      pickupNotes?: string | null;
      contactName?: string | null;
      contactEmail?: string | null;
      contactPhone?: string | null;
      overrideProductionCompleteUsed?: boolean;
      overrideActorRole?: string | null;
    },
    actorUserId?: string | null,
  ) {
    return this.dbInstance.transaction(async (tx) => {
      const [ticket] = await tx
        .select()
        .from(pickupTickets)
        .where(and(eq(pickupTickets.id, ticketId), eq(pickupTickets.organizationId, orgId)))
        .limit(1);

      if (!ticket) return { ok: false as const, code: 'NOT_FOUND', message: 'Pickup ticket not found' };
      if (ticket.status !== 'DRAFT') {
        return { ok: false as const, code: 'INVALID_STATE', message: 'Only DRAFT tickets can be marked READY_FOR_PICKUP' };
      }

      const now = new Date();
      const [updated] = await tx
        .update(pickupTickets)
        .set({
          status: 'READY_FOR_PICKUP',
          readyAt: now,
          updatedAt: now,
          stagingLocation: payload.stagingLocation ?? ticket.stagingLocation,
          pickupNotes: payload.pickupNotes ?? ticket.pickupNotes,
          contactName: payload.contactName ?? ticket.contactName,
          contactEmail: payload.contactEmail ?? ticket.contactEmail,
          contactPhone: payload.contactPhone ?? ticket.contactPhone,
        })
        .where(and(
          eq(pickupTickets.id, ticketId),
          eq(pickupTickets.organizationId, orgId),
          eq(pickupTickets.status, 'DRAFT'),
        ))
        .returning();

      if (!updated) return { ok: false as const, code: 'CONFLICT', message: 'Pickup ticket state changed during update' };

      await tx.insert(fulfillmentEvents).values({
        organizationId: orgId,
        actorUserId: actorUserId || null,
        entityType: 'PICKUP_TICKET',
        entityId: ticketId,
        eventType: 'PICKUP_READY',
        payloadJson: {
          contactEmail: updated.contactEmail,
          overrideProductionCompleteUsed: payload.overrideProductionCompleteUsed === true,
          overrideActorRole: payload.overrideActorRole || null,
        },
      });

      await tx
        .update(orders)
        .set({
          fulfillmentStatus: 'packed',
          updatedAt: new Date().toISOString(),
        })
        .where(and(eq(orders.id, ticket.orderId), eq(orders.organizationId, orgId)));

      const toAddress = updated.contactEmail || '';
      const [notification] = await tx
        .insert(outboundNotifications)
        .values({
          organizationId: orgId,
          relatedType: 'PICKUP_TICKET',
          relatedId: updated.id,
          channel: 'email',
          toAddress,
          status: 'PENDING',
        })
        .returning();

      return { ok: true as const, ticket: updated, notification };
    });
  }

  async updateNotificationSent(orgId: string, notificationId: string, providerMessageId?: string | null) {
    const [updated] = await this.dbInstance
      .update(outboundNotifications)
      .set({
        status: 'SENT',
        providerMessageId: providerMessageId || null,
        sentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(outboundNotifications.id, notificationId),
        eq(outboundNotifications.organizationId, orgId),
      ))
      .returning();
    return updated || null;
  }

  async updateNotificationFailed(orgId: string, notificationId: string, errorMessage: string) {
    const [updated] = await this.dbInstance
      .update(outboundNotifications)
      .set({
        status: 'FAILED',
        errorMessage,
        updatedAt: new Date(),
      })
      .where(and(
        eq(outboundNotifications.id, notificationId),
        eq(outboundNotifications.organizationId, orgId),
      ))
      .returning();
    return updated || null;
  }

  async markPickedUp(orgId: string, ticketId: string, actorUserId?: string | null) {
    return this.dbInstance.transaction(async (tx) => {
      const [ticket] = await tx
        .select()
        .from(pickupTickets)
        .where(and(eq(pickupTickets.id, ticketId), eq(pickupTickets.organizationId, orgId)))
        .limit(1);

      if (!ticket) return { ok: false as const, code: 'NOT_FOUND', message: 'Pickup ticket not found' };
      if (ticket.status !== 'READY_FOR_PICKUP') {
        return { ok: false as const, code: 'INVALID_STATE', message: 'Only READY_FOR_PICKUP tickets can be marked PICKED_UP' };
      }

      const [updated] = await tx
        .update(pickupTickets)
        .set({
          status: 'PICKED_UP',
          pickedUpAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(
          eq(pickupTickets.id, ticketId),
          eq(pickupTickets.organizationId, orgId),
          eq(pickupTickets.status, 'READY_FOR_PICKUP'),
        ))
        .returning();

      await tx.insert(fulfillmentEvents).values({
        organizationId: orgId,
        actorUserId: actorUserId || null,
        entityType: 'PICKUP_TICKET',
        entityId: ticketId,
        eventType: 'PICKUP_PICKED_UP',
        payloadJson: {},
      });

      await tx
        .update(orders)
        .set({
          fulfillmentStatus: 'delivered',
          updatedAt: new Date().toISOString(),
        })
        .where(and(eq(orders.id, ticket.orderId), eq(orders.organizationId, orgId)));

      return { ok: true as const, ticket: updated };
    });
  }

  async getTicketByOrder(orgId: string, orderId: string) {
    const [ticket] = await this.dbInstance
      .select()
      .from(pickupTickets)
      .where(and(eq(pickupTickets.organizationId, orgId), eq(pickupTickets.orderId, orderId)))
      .limit(1);
    return ticket || null;
  }

  async getTicketById(orgId: string, ticketId: string) {
    const [ticket] = await this.dbInstance
      .select()
      .from(pickupTickets)
      .where(and(eq(pickupTickets.organizationId, orgId), eq(pickupTickets.id, ticketId)))
      .limit(1);
    return ticket || null;
  }

  async listTickets(orgId: string, filters: {
    status?: string;
    search?: string;
    page: number;
    pageSize: number;
  }) {
    const conditions = [eq(pickupTickets.organizationId, orgId)] as any[];

    if (filters.status && filters.status !== 'all') {
      conditions.push(eq(pickupTickets.status, filters.status.toUpperCase()));
    }

    const whereClause = and(...conditions);

    const [{ total }] = await this.dbInstance
      .select({ total: sql<number>`count(*)::int` })
      .from(pickupTickets)
      .where(whereClause);

    const rows = await this.dbInstance
      .select()
      .from(pickupTickets)
      .where(whereClause)
      .orderBy(desc(pickupTickets.updatedAt), desc(pickupTickets.createdAt))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize);

    return { rows, total };
  }
}

export class FulfillmentDashboardRepo {
  constructor(private readonly dbInstance: DbExecutor = db) {}

  private deriveShipStatus(ordered: number, shipped: number): DerivedOrderFulfillmentStatus {
    if (shipped <= 0) return 'READY';
    if (shipped >= ordered) return 'SHIPPED';
    return 'PARTIAL';
  }

  async listFulfillmentQueue(orgId: string, filters: {
    type: 'all' | 'ship' | 'pickup';
    status: string;
    showArchived: boolean;
    overdueOnly: boolean;
    search?: string;
    page: number;
    pageSize: number;
  }) {
    const baseOrderConditions = [eq(orders.organizationId, orgId)] as any[];

    if (filters.search?.trim()) {
      const pattern = `%${filters.search.trim()}%`;
      baseOrderConditions.push(or(
        ilike(orders.orderNumber, pattern),
        ilike(customers.companyName, pattern),
      ));
    }

    const orderRows = await this.dbInstance
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        shippingMethod: orders.shippingMethod,
        state: orders.state,
        status: orders.status,
        canceledAt: orders.canceledAt,
        routingTarget: orders.routingTarget,
        productionCompletedAt: orders.productionCompletedAt,
        updatedAt: orders.updatedAt,
        shipToCity: orders.shipToCity,
        shipToState: orders.shipToState,
        customerName: customers.companyName,
      })
      .from(orders)
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .where(and(...baseOrderConditions));

    const orderIds = orderRows.map((o) => o.id);

    const lineItemAgg = orderIds.length > 0
      ? await this.dbInstance
        .select({
          orderId: orderLineItems.orderId,
          orderedQty: sql<number>`COALESCE(SUM(${orderLineItems.quantity}), 0)::int`,
        })
        .from(orderLineItems)
        .where(inArray(orderLineItems.orderId, orderIds))
        .groupBy(orderLineItems.orderId)
      : [];

    const shippedAgg = orderIds.length > 0
      ? await this.dbInstance
        .select({
          orderId: shipmentItems.orderId,
          shippedQty: sql<number>`COALESCE(SUM(${shipmentItems.quantity}), 0)::int`,
        })
        .from(shipmentItems)
        .innerJoin(shipments, eq(shipments.id, shipmentItems.shipmentId))
        .where(and(
          eq(shipments.organizationId, orgId),
          eq(shipments.status, 'SHIPPED'),
          inArray(shipmentItems.orderId, orderIds),
        ))
        .groupBy(shipmentItems.orderId)
      : [];

    const ticketRows = orderIds.length > 0
      ? await this.dbInstance
        .select()
        .from(pickupTickets)
        .where(and(
          eq(pickupTickets.organizationId, orgId),
          inArray(pickupTickets.orderId, orderIds),
        ))
      : [];

    const productionJobRows = orderIds.length > 0
      ? await this.dbInstance
        .select({
          id: productionJobs.id,
          orderId: productionJobs.orderId,
          lineItemId: productionJobs.lineItemId,
          quantity: orderLineItems.quantity,
        })
        .from(productionJobs)
        .leftJoin(orderLineItems, eq(orderLineItems.id, productionJobs.lineItemId))
        .where(and(
          eq(productionJobs.organizationId, orgId),
          inArray(productionJobs.orderId, orderIds),
          notInArray(productionJobs.status, [...TERMINAL_PRODUCTION_STATUSES]),
        ))
        .orderBy(desc(productionJobs.updatedAt))
      : [];

    const productionContextRows = orderIds.length > 0
      ? await this.dbInstance
        .select({
          id: productionJobs.id,
          orderId: productionJobs.orderId,
          stationKey: productionJobs.stationKey,
          status: productionJobs.status,
          assignedPrinterName: productionJobs.assignedPrinterName,
          assignedPrinterAt: productionJobs.assignedPrinterAt,
          completedAt: productionJobs.completedAt,
          updatedAt: productionJobs.updatedAt,
          lineItemId: productionJobs.lineItemId,
          description: orderLineItems.description,
          productionNotes: orderLineItems.productionNotes,
          optionSelectionsJson: orderLineItems.optionSelectionsJson,
          pbv2SnapshotJson: orderLineItems.pbv2SnapshotJson,
          specsJson: orderLineItems.specsJson,
          selectedOptions: orderLineItems.selectedOptions,
        })
        .from(productionJobs)
        .leftJoin(orderLineItems, eq(orderLineItems.id, productionJobs.lineItemId))
        .where(and(
          eq(productionJobs.organizationId, orgId),
          inArray(productionJobs.orderId, orderIds),
          ne(productionJobs.status, 'cancelled' as any),
        ))
        .orderBy(desc(productionJobs.updatedAt))
      : [];

    const orderedMap = new Map(lineItemAgg.map((row) => [row.orderId, row.orderedQty]));
    const shippedMap = new Map(shippedAgg.map((row) => [row.orderId, row.shippedQty]));
    const ticketMap = new Map(ticketRows.map((row) => [row.orderId, row]));
    const productionJobsByOrder = new Map<string, QueueRowDto['productionJobs']>();
    for (const job of productionJobRows) {
      const list = productionJobsByOrder.get(job.orderId) ?? [];
      list.push({
        id: job.id,
        lineItemId: job.lineItemId,
        quantity: job.quantity == null ? null : Number(job.quantity),
      });
      productionJobsByOrder.set(job.orderId, list);
    }

    type ProductionContextRow = (typeof productionContextRows)[number];
    const productionContextByOrder = new Map<string, QueueRowDto['productionContext']>();
    const rowsByOrder = new Map<string, ProductionContextRow[]>();
    for (const row of productionContextRows) {
      const list = rowsByOrder.get(row.orderId) ?? [];
      list.push(row);
      rowsByOrder.set(row.orderId, list);
    }

    for (const [orderId, contextRows] of Array.from(rowsByOrder.entries())) {
      const printRows = contextRows.filter((row) => {
        const station = cleanText(row.stationKey).toLowerCase();
        return !PRINT_CONTEXT_EXCLUDED_STATIONS.has(station);
      });
      const sourceRows = printRows.length > 0 ? printRows : contextRows;
      const printerRows = sourceRows
        .filter((row) => cleanText(row.assignedPrinterName))
        .sort((a, b) => {
          const left = new Date((a.assignedPrinterAt ?? a.completedAt ?? a.updatedAt) as any).getTime();
          const right = new Date((b.assignedPrinterAt ?? b.completedAt ?? b.updatedAt) as any).getTime();
          return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
        });
      const lineItemContexts = sourceRows.map((row) => buildLineItemProductionContext(row));
      productionContextByOrder.set(orderId, {
        primaryPrinterName: cleanText(printerRows[0]?.assignedPrinterName) || null,
        printerNames: uniqueNonEmpty(sourceRows.map((row) => row.assignedPrinterName)),
        finishingRequirements: uniqueNonEmpty(lineItemContexts.flatMap((ctx) => ctx.finishingRequirements)),
        lamination: uniqueNonEmpty(lineItemContexts.map((ctx) => ctx.lamination))[0] ?? null,
        registrationMarks: uniqueNonEmpty(lineItemContexts.flatMap((ctx) => ctx.registrationMarks)),
        productionNotes: uniqueNonEmpty(lineItemContexts.flatMap((ctx) => ctx.productionNotes)),
        completedAt: latestIso(sourceRows.map((row) => row.completedAt)),
      });
    }

    const nowMs = Date.now();
    const rows: QueueRowDto[] = [];

    for (const order of orderRows) {
      const orderedQty = orderedMap.get(order.id) || 0;
      const shippedQty = shippedMap.get(order.id) || 0;
      const remaining = Math.max(orderedQty - shippedQty, 0);

      const isPickup = order.shippingMethod === 'pickup';
      const productionComplete = order.state === 'production_complete';
      const shipEligible = !isPickup && productionComplete && order.routingTarget === 'fulfillment';
      const pickupEligible = isPickup && productionComplete;

      if (!shipEligible && !pickupEligible) continue;

      if (filters.type === 'ship' && isPickup) continue;
      if (filters.type === 'pickup' && !isPickup) continue;

      if (isPickup) {
        const ticket = ticketMap.get(order.id);
        const status = ticket?.status || 'DRAFT';
        const isArchivedPickup = status === 'PICKED_UP';
        if (!filters.showArchived && isArchivedPickup) continue;
        const readySince = (ticket?.readyAt as Date | null)?.toISOString?.() || null;
        const row: QueueRowDto = {
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerName: order.customerName || 'Unknown Customer',
          fulfillmentType: 'PICKUP',
          status,
          itemsRemaining: `${remaining} item(s)`,
          readySince,
          shipTo: 'In-Store',
          overdue: false,
          productionJobs: productionJobsByOrder.get(order.id) ?? [],
          productionContext: productionContextByOrder.get(order.id),
        };

        if (filters.status !== 'all' && filters.status.toLowerCase() !== status.toLowerCase()) continue;
        rows.push(row);
        continue;
      }

      const shipStatus = this.deriveShipStatus(orderedQty, shippedQty);
      const isArchivedShip = shipStatus === 'SHIPPED';
      if (!filters.showArchived && isArchivedShip) continue;
      const readySinceIso = order.productionCompletedAt
        ? new Date(order.productionCompletedAt).toISOString()
        : new Date(order.updatedAt).toISOString();

      const readySinceMs = Date.parse(readySinceIso);
      const overdue = Number.isFinite(readySinceMs)
        ? (nowMs - readySinceMs) > (SHIP_READY_OVERDUE_HOURS * 60 * 60 * 1000)
        : false;

      const shipStatusForFilter = shipStatus === 'SHIPPED' ? 'shipped' : 'ready';

      if (filters.status !== 'all' && filters.status.toLowerCase() !== shipStatusForFilter) continue;
      if (filters.overdueOnly && !overdue) continue;

      rows.push({
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerName: order.customerName || 'Unknown Customer',
        fulfillmentType: 'SHIP',
        status: shipStatus,
        itemsRemaining: `${remaining} item(s)`,
        readySince: readySinceIso,
        shipTo: [order.shipToCity, order.shipToState].filter(Boolean).join(', ') || 'Unknown',
        overdue,
        productionJobs: productionJobsByOrder.get(order.id) ?? [],
        productionContext: productionContextByOrder.get(order.id),
      });
    }

    const total = rows.length;
    const start = (filters.page - 1) * filters.pageSize;
    const paged = rows.slice(start, start + filters.pageSize);

    return { rows: paged, total };
  }

  async getOrdersForCombinedShipmentValidation(orgId: string, orderIds: string[]) {
    if (orderIds.length === 0) return [];
    return this.dbInstance
      .select({
        id: orders.id,
        shippingMethod: orders.shippingMethod,
        state: orders.state,
        routingTarget: orders.routingTarget,
        shipToName: orders.shipToName,
        shipToCompany: orders.shipToCompany,
        shipToAddress1: orders.shipToAddress1,
        shipToAddress2: orders.shipToAddress2,
        shipToCity: orders.shipToCity,
        shipToState: orders.shipToState,
        shipToPostalCode: orders.shipToPostalCode,
        shipToCountry: orders.shipToCountry,
      })
      .from(orders)
      .where(and(
        eq(orders.organizationId, orgId),
        inArray(orders.id, orderIds),
      ));
  }

  async getLineItemCountsForOrders(orderIds: string[]) {
    if (orderIds.length === 0) return [];
    return this.dbInstance
      .select({
        orderId: orderLineItems.orderId,
        count: sql<number>`count(*)::int`,
      })
      .from(orderLineItems)
      .where(inArray(orderLineItems.orderId, orderIds))
      .groupBy(orderLineItems.orderId);
  }

  getAddressKey = toShipAddressKey;
}

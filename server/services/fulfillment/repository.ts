import { and, desc, eq, ilike, inArray, ne, notInArray, or, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  customers,
  fulfillmentChecklistItems,
  fulfillmentEvents,
  lineItemFiles,
  materials,
  orderAttachments,
  orderLineItems,
  orders,
  organizations,
  outboundNotifications,
  pickupTickets,
  products,
  productionJobs,
  shipmentItems,
  shipmentOrders,
  shipments,
  users,
} from '@shared/schema';
import type { DerivedOrderFulfillmentStatus, FulfillmentDetailDto, QueueRowDto } from './types';
import { TERMINAL_PRODUCTION_STATUSES } from '@shared/operationalState';
import { buildPrepressOptionRows, extractFinishingBullets } from '../../routes/flatStockNesting.shared';
import { fulfillmentQueueEligibleOrderCondition, isFulfillmentQueueEligibleOrder } from './eligibility';
import {
  createRequestLogOnce,
  enrichAttachmentWithUrls,
  resolveOriginalFileAccess,
} from '../../lib/supabaseObjectHelpers';
import { assetRepository } from '../assets/AssetRepository';
import { enrichAssetsWithRoles } from '../assets/enrichAssetWithUrls';

const SHIP_READY_OVERDUE_HOURS = 48;
const DEFAULT_PICKUP_RETENTION_DAYS_AFTER_PICKED_UP = 7;
const PRINT_CONTEXT_EXCLUDED_STATIONS = new Set(['fulfillment', 'prepress', 'design']);

type FulfillmentArtworkDto = FulfillmentDetailDto['lineItems'][number]['artwork'][number];

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

function pushArtwork(
  map: Map<string, FulfillmentArtworkDto[]>,
  lineItemId: string | null | undefined,
  artwork: FulfillmentArtworkDto,
  seen: Set<string>,
) {
  if (!lineItemId) return;
  const dedupeKey = [
    artwork.source,
    artwork.id,
    artwork.objectPath || artwork.originalUrl || artwork.fileUrl || artwork.fileName,
  ].join(':');
  if (seen.has(dedupeKey)) return;
  seen.add(dedupeKey);
  const bucket = map.get(lineItemId) ?? [];
  bucket.push(artwork);
  map.set(lineItemId, bucket);
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

function toIso(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(value as any);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function getPickupRetentionDaysFromSettings(settings: unknown): number {
  const raw = (settings as any)?.preferences?.fulfillment?.pickupRetentionDaysAfterPickedUp;
  const days = Number(raw);
  if (!Number.isFinite(days) || days < 0) return DEFAULT_PICKUP_RETENTION_DAYS_AFTER_PICKED_UP;
  return Math.min(Math.floor(days), 365);
}

export function isPickedUpArchivedForRetention(ticket: { status?: string | null; pickedUpAt?: unknown }, retentionDays: number, nowMs = Date.now()): boolean {
  if (String(ticket?.status || '').toUpperCase() !== 'PICKED_UP') return false;
  if (retentionDays <= 0) return true;
  const pickedUpMs = ticket?.pickedUpAt ? new Date(ticket.pickedUpAt as any).getTime() : Number.NaN;
  if (!Number.isFinite(pickedUpMs)) return false;
  return nowMs - pickedUpMs >= retentionDays * 24 * 60 * 60 * 1000;
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

function formatLineItemSize(width: unknown, height: unknown): string | null {
  const w = cleanText(width);
  const h = cleanText(height);
  if (!w && !h) return null;
  if (!w || !h) return null;
  return `${w}" x ${h}"`;
}

function stationLabel(value: string | null | undefined): string | null {
  const station = cleanText(value);
  if (!station) return null;
  if (station === 'flatbed') return 'Flatbed';
  if (station === 'roll') return 'Roll';
  if (station === 'prepress') return 'Prepress';
  if (station === 'fulfillment') return 'Fulfillment';
  return station.charAt(0).toUpperCase() + station.slice(1);
}

export function summarizeFulfillmentChecklist(items: Array<{ checked?: boolean | null }>) {
  const total = items.length;
  const checked = items.filter((item) => item.checked === true).length;
  const unchecked = total - checked;
  return {
    total,
    checked,
    unchecked,
    complete: total > 0 && unchecked === 0,
  };
}

async function resolveExistingActorUserId(dbRunner: any, actorUserId?: string | null): Promise<string | null> {
  const cleanActorUserId = cleanText(actorUserId);
  if (!cleanActorUserId) return null;
  if (typeof dbRunner?.select !== 'function') return null;

  try {
    const [actor] = await dbRunner
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, cleanActorUserId))
      .limit(1);

    return actor?.id ?? null;
  } catch (error) {
    console.warn('[fulfillment] actor lookup failed; continuing with null actor', {
      actorUserId: cleanActorUserId,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export function resolveFulfillmentUnreadyTransition(status: string | null | undefined): { ok: true; previousStatus: 'READY' | 'READY_FOR_PICKUP'; newStatus: 'DRAFT' | 'READY' } | { ok: false; code: 'INVALID_STATE' | 'TERMINAL_STATUS_REVERT_BLOCKED' } {
  const normalized = cleanText(status).toUpperCase();
  if (normalized === 'READY_FOR_PICKUP') {
    return { ok: true, previousStatus: 'READY_FOR_PICKUP', newStatus: 'READY' };
  }
  if (normalized === 'READY') {
    return { ok: true, previousStatus: 'READY', newStatus: 'DRAFT' };
  }
  if (normalized === 'PICKED_UP' || normalized === 'SHIPPED') {
    return { ok: false, code: 'TERMINAL_STATUS_REVERT_BLOCKED' };
  }
  return { ok: false, code: 'INVALID_STATE' };
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
    const safeCreatedByUserId = await resolveExistingActorUserId(this.dbInstance, payload.createdByUserId);

    const [shipment] = await this.dbInstance
      .insert(shipments)
      .values({
        organizationId: orgId,
        status: 'DRAFT',
        scope: payload.scope,
        orderId: primaryOrderId,
        primaryOrderId,
        createdByUserId: safeCreatedByUserId,
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

      const safeActorUserId = await resolveExistingActorUserId(tx, actorUserId);
      await tx.insert(fulfillmentEvents).values({
        organizationId: orgId,
        actorUserId: safeActorUserId,
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

      const safeActorUserId = await resolveExistingActorUserId(tx, actorUserId);
      await tx.insert(fulfillmentEvents).values({
        organizationId: orgId,
        actorUserId: safeActorUserId,
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
    entityType: 'SHIPMENT' | 'PICKUP_TICKET' | 'ORDER',
    entityId: string,
    eventType:
      | 'SHIPMENT_CREATED'
      | 'SHIPMENT_UPDATED'
      | 'SHIPMENT_SHIPPED'
      | 'SHIPMENT_VOIDED'
      | 'FULFILLMENT_READY'
      | 'FULFILLMENT_NOTE'
      | 'FULFILLMENT_AUTO_ARCHIVED'
      | 'FULFILLMENT_CHECKLIST_ITEM_UPDATED'
      | 'FULFILLMENT_CHECKLIST_VERIFIED'
      | 'FULFILLMENT_UNREADY'
      | 'PICKUP_READY'
      | 'PICKUP_PICKED_UP'
      | 'NOTIFICATION_SENT'
      | 'NOTIFICATION_FAILED',
    payloadJson: Record<string, any>,
    tx?: any,
  ) {
    const runner = tx || this.dbInstance;
    const safeActorUserId = await resolveExistingActorUserId(runner, actorUserId);
    await runner.insert(fulfillmentEvents).values({
      organizationId: orgId,
      actorUserId: safeActorUserId,
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

    const safeCreatedByUserId = await resolveExistingActorUserId(this.dbInstance, createdByUserId);
    const [created] = await this.dbInstance
      .insert(pickupTickets)
      .values({
        organizationId: orgId,
        orderId,
        status: 'DRAFT',
        createdByUserId: safeCreatedByUserId,
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

      const safeActorUserId = await resolveExistingActorUserId(tx, actorUserId);
      await tx.insert(fulfillmentEvents).values({
        organizationId: orgId,
        actorUserId: safeActorUserId,
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

      const safeActorUserId = await resolveExistingActorUserId(tx, actorUserId);
      await tx.insert(fulfillmentEvents).values({
        organizationId: orgId,
        actorUserId: safeActorUserId,
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

  private deriveShipQueueStatus(orderFulfillmentStatus: string | null | undefined, ordered: number, shipped: number): 'DRAFT' | 'READY' | 'PARTIAL' | 'SHIPPED' {
    const derived = this.deriveShipStatus(ordered, shipped);
    if (derived !== 'READY') return derived;
    return cleanText(orderFulfillmentStatus).toLowerCase() === 'packed' ? 'READY' : 'DRAFT';
  }

  private derivePickupQueueStatus(orderFulfillmentStatus: string | null | undefined, ticket?: { status?: string | null } | null): string {
    const ticketStatus = cleanText(ticket?.status).toUpperCase();
    if (ticketStatus === 'READY_FOR_PICKUP' || ticketStatus === 'PICKED_UP') return ticketStatus;
    return cleanText(orderFulfillmentStatus).toLowerCase() === 'packed' ? 'READY' : 'DRAFT';
  }

  private async getPickupRetentionDays(orgId: string): Promise<number> {
    const [org] = await this.dbInstance
      .select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    return getPickupRetentionDaysFromSettings(org?.settings);
  }

  private isPickedUpTicketArchived(ticket: any, retentionDays: number, nowMs = Date.now()): boolean {
    return isPickedUpArchivedForRetention(ticket, retentionDays, nowMs);
  }

  private async logPickupAutoArchiveOnce(orgId: string, ticketId: string, retentionDays: number) {
    const [existing] = await this.dbInstance
      .select({ id: fulfillmentEvents.id })
      .from(fulfillmentEvents)
      .where(and(
        eq(fulfillmentEvents.organizationId, orgId),
        eq(fulfillmentEvents.entityType, 'PICKUP_TICKET'),
        eq(fulfillmentEvents.entityId, ticketId),
        eq(fulfillmentEvents.eventType, 'FULFILLMENT_AUTO_ARCHIVED'),
      ))
      .limit(1);

    if (existing) return;

    await this.dbInstance.insert(fulfillmentEvents).values({
      organizationId: orgId,
      actorUserId: null,
      entityType: 'PICKUP_TICKET',
      entityId: ticketId,
      eventType: 'FULFILLMENT_AUTO_ARCHIVED',
      payloadJson: {
        reason: `Auto-archived picked-up fulfillment after ${retentionDays} days`,
        retentionDays,
      },
    });
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
    const baseOrderConditions = [fulfillmentQueueEligibleOrderCondition(orgId)] as any[];

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
        fulfillmentStatus: orders.fulfillmentStatus,
        updatedAt: orders.updatedAt,
        shipToCity: orders.shipToCity,
        shipToState: orders.shipToState,
        customerName: customers.companyName,
      })
      .from(orders)
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .where(and(...baseOrderConditions));

    const orderIds = orderRows.map((o) => o.id);
    const pickupRetentionDays = await this.getPickupRetentionDays(orgId);

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
          shippedAt: sql<string | null>`MAX(${shipments.shippedAt})`,
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

    const shipmentRows = orderIds.length > 0
      ? await this.dbInstance
        .select({
          id: shipments.id,
          orderId: shipmentOrders.orderId,
          status: shipments.status,
          shippedAt: shipments.shippedAt,
          updatedAt: shipments.updatedAt,
        })
        .from(shipmentOrders)
        .innerJoin(shipments, eq(shipments.id, shipmentOrders.shipmentId))
        .where(and(
          eq(shipmentOrders.organizationId, orgId),
          eq(shipments.organizationId, orgId),
          inArray(shipmentOrders.orderId, orderIds),
        ))
        .orderBy(desc(shipments.updatedAt), desc(shipments.createdAt))
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
    const shippedAtMap = new Map(shippedAgg.map((row) => [row.orderId, row.shippedAt]));
    const ticketMap = new Map(ticketRows.map((row) => [row.orderId, row]));
    const shipmentMap = new Map<string, (typeof shipmentRows)[number]>();
    for (const shipment of shipmentRows) {
      if (!shipmentMap.has(shipment.orderId)) shipmentMap.set(shipment.orderId, shipment);
    }
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
      if (!isFulfillmentQueueEligibleOrder(order)) continue;

      if (filters.type === 'ship' && isPickup) continue;
      if (filters.type === 'pickup' && !isPickup) continue;

      if (isPickup) {
        const ticket = ticketMap.get(order.id);
        const status = this.derivePickupQueueStatus(order.fulfillmentStatus, ticket);
        const isArchivedPickup = ticket ? this.isPickedUpTicketArchived(ticket, pickupRetentionDays, nowMs) : false;
        if (isArchivedPickup && ticket?.id) {
          await this.logPickupAutoArchiveOnce(orgId, ticket.id, pickupRetentionDays);
        }
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
          pickupTicketId: ticket?.id ?? null,
          shipmentId: null,
          isArchived: isArchivedPickup,
          archivedReason: isArchivedPickup ? `Picked up more than ${pickupRetentionDays} day(s) ago` : null,
          productionJobs: productionJobsByOrder.get(order.id) ?? [],
          productionContext: productionContextByOrder.get(order.id),
        };

        if (filters.status !== 'all' && filters.status.toLowerCase() !== status.toLowerCase()) continue;
        rows.push(row);
        continue;
      }

      const shipStatus = this.deriveShipQueueStatus(order.fulfillmentStatus, orderedQty, shippedQty);
      const shippedAtMs = Date.parse(String(shippedAtMap.get(order.id) || ''));
      const isArchivedShip = shipStatus === 'SHIPPED' &&
        Number.isFinite(shippedAtMs) &&
        nowMs - shippedAtMs >= pickupRetentionDays * 24 * 60 * 60 * 1000;
      if (!filters.showArchived && isArchivedShip) continue;
      const readySinceIso = order.productionCompletedAt
        ? new Date(order.productionCompletedAt).toISOString()
        : new Date(order.updatedAt).toISOString();

      const readySinceMs = Date.parse(readySinceIso);
      const overdue = Number.isFinite(readySinceMs)
        ? (nowMs - readySinceMs) > (SHIP_READY_OVERDUE_HOURS * 60 * 60 * 1000)
        : false;

      const shipStatusForFilter = shipStatus.toLowerCase();

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
        pickupTicketId: null,
        shipmentId: shipmentMap.get(order.id)?.id ?? null,
        isArchived: isArchivedShip,
        archivedReason: isArchivedShip ? `Shipped more than ${pickupRetentionDays} day(s) ago` : null,
        productionJobs: productionJobsByOrder.get(order.id) ?? [],
        productionContext: productionContextByOrder.get(order.id),
      });
    }

    const total = rows.length;
    const start = (filters.page - 1) * filters.pageSize;
    const paged = rows.slice(start, start + filters.pageSize);

    return { rows: paged, total };
  }

  async countFulfillmentQueue(orgId: string, filters?: Partial<{
    type: 'all' | 'ship' | 'pickup';
    status: string;
    showArchived: boolean;
    overdueOnly: boolean;
  }>) {
    const result = await this.listFulfillmentQueue(orgId, {
      type: filters?.type ?? 'all',
      status: filters?.status ?? 'all',
      showArchived: filters?.showArchived ?? false,
      overdueOnly: filters?.overdueOnly ?? false,
      page: 1,
      pageSize: 1,
    });
    return result.total;
  }

  async ensureChecklistItemsForOrder(orgId: string, orderId: string) {
    const lineRows = await this.dbInstance
      .select({
        id: orderLineItems.id,
      })
      .from(orderLineItems)
      .innerJoin(orders, eq(orders.id, orderLineItems.orderId))
      .where(and(eq(orders.organizationId, orgId), eq(orderLineItems.orderId, orderId)));

    if (lineRows.length === 0) {
      return [];
    }

    const existingRows = await this.dbInstance
      .select({
        lineItemId: fulfillmentChecklistItems.lineItemId,
      })
      .from(fulfillmentChecklistItems)
      .where(and(eq(fulfillmentChecklistItems.organizationId, orgId), eq(fulfillmentChecklistItems.orderId, orderId)));

    const existingLineItemIds = new Set(existingRows.map((row) => row.lineItemId));
    const missingRows = lineRows
      .filter((line) => !existingLineItemIds.has(line.id))
      .map((line) => ({
        organizationId: orgId,
        orderId,
        lineItemId: line.id,
        checked: false,
      }));

    if (missingRows.length > 0) {
      await this.dbInstance
        .insert(fulfillmentChecklistItems)
        .values(missingRows)
        .onConflictDoNothing();
    }

    return this.dbInstance
      .select()
      .from(fulfillmentChecklistItems)
      .where(and(eq(fulfillmentChecklistItems.organizationId, orgId), eq(fulfillmentChecklistItems.orderId, orderId)));
  }

  async getChecklistCompletion(orgId: string, orderId: string) {
    const rows = await this.ensureChecklistItemsForOrder(orgId, orderId);
    return summarizeFulfillmentChecklist(rows);
  }

  async assertOrderChecklistComplete(orgId: string, orderId: string) {
    const summary = await this.getChecklistCompletion(orgId, orderId);
    if (!summary.complete) {
      return {
        ok: false as const,
        code: 'FULFILLMENT_CHECKLIST_INCOMPLETE',
        message: 'Verify all fulfillment checklist items before marking ready.',
        summary,
      };
    }
    return { ok: true as const, summary };
  }

  async logChecklistVerified(orgId: string, orderId: string, actorUserId?: string | null, payload?: Record<string, any>) {
    const summary = await this.getChecklistCompletion(orgId, orderId);
    const safeActorUserId = await resolveExistingActorUserId(this.dbInstance, actorUserId);
    await this.dbInstance.insert(fulfillmentEvents).values({
      organizationId: orgId,
      actorUserId: safeActorUserId,
      entityType: 'ORDER',
      entityId: orderId,
      eventType: 'FULFILLMENT_CHECKLIST_VERIFIED',
      payloadJson: {
        total: summary.total,
        checked: summary.checked,
        ...(payload ?? {}),
      },
    });
  }

  async updateChecklistItem(orgId: string, orderId: string, lineItemId: string, input: {
    checked: boolean;
    notes?: string | null;
  }, actorUserId?: string | null) {
    const [lineItem] = await this.dbInstance
      .select({ id: orderLineItems.id })
      .from(orderLineItems)
      .innerJoin(orders, eq(orders.id, orderLineItems.orderId))
      .where(and(
        eq(orders.organizationId, orgId),
        eq(orderLineItems.orderId, orderId),
        eq(orderLineItems.id, lineItemId),
      ))
      .limit(1);

    if (!lineItem) {
      return { ok: false as const, code: 'NOT_FOUND', message: 'Fulfillment checklist item not found' };
    }

    await this.ensureChecklistItemsForOrder(orgId, orderId);

    const now = new Date();
    const safeActorUserId = await resolveExistingActorUserId(this.dbInstance, actorUserId);
    const [updated] = await this.dbInstance
      .update(fulfillmentChecklistItems)
      .set({
        checked: input.checked,
        checkedByUserId: input.checked ? safeActorUserId : null,
        checkedAt: input.checked ? now : null,
        notes: input.notes ?? null,
        updatedAt: now,
      })
      .where(and(
        eq(fulfillmentChecklistItems.organizationId, orgId),
        eq(fulfillmentChecklistItems.orderId, orderId),
        eq(fulfillmentChecklistItems.lineItemId, lineItemId),
      ))
      .returning();

    if (!updated) {
      return { ok: false as const, code: 'NOT_FOUND', message: 'Fulfillment checklist item not found' };
    }

    await this.dbInstance.insert(fulfillmentEvents).values({
      organizationId: orgId,
      actorUserId: safeActorUserId,
      entityType: 'ORDER',
      entityId: orderId,
      eventType: 'FULFILLMENT_CHECKLIST_ITEM_UPDATED',
      payloadJson: {
        lineItemId,
        checklistItemId: updated.id,
        checked: updated.checked,
        hasNotes: !!cleanText(updated.notes),
      },
    });

    return { ok: true as const, item: updated };
  }

  async markOrderReady(orgId: string, orderId: string, actorUserId?: string | null) {
    const [order] = await this.dbInstance
      .select({
        id: orders.id,
        state: orders.state,
        status: orders.status,
        canceledAt: orders.canceledAt,
        routingTarget: orders.routingTarget,
        shippingMethod: orders.shippingMethod,
      })
      .from(orders)
      .where(and(eq(orders.organizationId, orgId), eq(orders.id, orderId)))
      .limit(1);

    if (!order) return { ok: false as const, code: 'NOT_FOUND', message: 'Fulfillment row not found' };
    if (!isFulfillmentQueueEligibleOrder(order as any)) {
      return { ok: false as const, code: 'INVALID_STATE', message: 'Order is not ready for fulfillment' };
    }

    await this.dbInstance.transaction(async (tx) => {
      const safeActorUserId = await resolveExistingActorUserId(tx, actorUserId);
      await tx
        .update(orders)
        .set({ fulfillmentStatus: 'packed', updatedAt: new Date().toISOString() })
        .where(and(eq(orders.organizationId, orgId), eq(orders.id, orderId)));

      await tx.insert(fulfillmentEvents).values({
        organizationId: orgId,
        actorUserId: safeActorUserId,
        entityType: 'ORDER',
        entityId: orderId,
        eventType: 'FULFILLMENT_READY',
        payloadJson: { fulfillmentStatus: 'packed' },
      });
    });

    return { ok: true as const };
  }

  async unreadyOrder(orgId: string, orderId: string, reason: string, actorUserId?: string | null) {
    const trimmedReason = cleanText(reason);
    if (!trimmedReason) {
      return { ok: false as const, code: 'REASON_REQUIRED', message: 'Reason is required to revert fulfillment status' };
    }

    return this.dbInstance.transaction(async (tx) => {
      const [order] = await tx
        .select({
          id: orders.id,
          shippingMethod: orders.shippingMethod,
          fulfillmentStatus: orders.fulfillmentStatus,
          state: orders.state,
          status: orders.status,
          canceledAt: orders.canceledAt,
        })
        .from(orders)
        .where(and(eq(orders.organizationId, orgId), eq(orders.id, orderId)))
        .limit(1);

      if (!order) return { ok: false as const, code: 'NOT_FOUND', message: 'Fulfillment row not found' };
      if (!isFulfillmentQueueEligibleOrder(order as any)) {
        return { ok: false as const, code: 'INVALID_STATE', message: 'Order is not in active fulfillment' };
      }

      const [ticket] = await tx
        .select()
        .from(pickupTickets)
        .where(and(eq(pickupTickets.organizationId, orgId), eq(pickupTickets.orderId, orderId)))
        .limit(1);

      const shippedRows = await tx
        .select({ id: shipments.id })
        .from(shipmentOrders)
        .innerJoin(shipments, eq(shipments.id, shipmentOrders.shipmentId))
        .where(and(
          eq(shipmentOrders.organizationId, orgId),
          eq(shipmentOrders.orderId, orderId),
          eq(shipments.organizationId, orgId),
          eq(shipments.status, 'SHIPPED'),
        ))
        .limit(1);

      if (shippedRows.length > 0) {
        return { ok: false as const, code: 'TERMINAL_STATUS_REVERT_BLOCKED', message: 'Shipped fulfillment cannot be reverted from this action' };
      }
      if (ticket?.status === 'PICKED_UP') {
        return { ok: false as const, code: 'TERMINAL_STATUS_REVERT_BLOCKED', message: 'Picked-up fulfillment cannot be reverted from this action' };
      }

      const previousStatus = order.shippingMethod === 'pickup'
        ? this.derivePickupQueueStatus(order.fulfillmentStatus, ticket)
        : (cleanText(order.fulfillmentStatus).toLowerCase() === 'packed' ? 'READY' : 'DRAFT');

      const transition = resolveFulfillmentUnreadyTransition(previousStatus);
      if (!transition.ok) {
        const message = transition.code === 'TERMINAL_STATUS_REVERT_BLOCKED'
          ? 'Terminal fulfillment cannot be reverted from this action'
          : 'Only ready or ready-for-pickup fulfillment can be reverted';
        return { ok: false as const, code: transition.code, message };
      }

      const now = new Date();

      if (transition.previousStatus === 'READY_FOR_PICKUP') {
        if (ticket?.id) {
          await tx
            .update(pickupTickets)
            .set({
              status: 'DRAFT',
              readyAt: null,
              updatedAt: now,
            })
            .where(and(eq(pickupTickets.organizationId, orgId), eq(pickupTickets.id, ticket.id)));
        }
        await tx
          .update(orders)
          .set({ fulfillmentStatus: 'packed', updatedAt: now.toISOString() })
          .where(and(eq(orders.organizationId, orgId), eq(orders.id, orderId)));
      } else {
        await tx
          .update(orders)
          .set({ fulfillmentStatus: 'pending', updatedAt: now.toISOString() })
          .where(and(eq(orders.organizationId, orgId), eq(orders.id, orderId)));
      }

      const safeActorUserId = await resolveExistingActorUserId(tx, actorUserId);
      await tx.insert(fulfillmentEvents).values({
        organizationId: orgId,
        actorUserId: safeActorUserId,
        entityType: 'ORDER',
        entityId: orderId,
        eventType: 'FULFILLMENT_UNREADY',
        payloadJson: {
          previousStatus: transition.previousStatus,
          newStatus: transition.newStatus,
          reason: trimmedReason,
          permission: 'fulfillment.revert_status',
        },
      });

      return { ok: true as const, previousStatus: transition.previousStatus, newStatus: transition.newStatus };
    });
  }

  async addOrderNote(orgId: string, orderId: string, note: string, actorUserId?: string | null) {
    const [order] = await this.dbInstance
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.organizationId, orgId), eq(orders.id, orderId)))
      .limit(1);

    if (!order) return { ok: false as const, code: 'NOT_FOUND', message: 'Fulfillment row not found' };

    const safeActorUserId = await resolveExistingActorUserId(this.dbInstance, actorUserId);
    await this.dbInstance.insert(fulfillmentEvents).values({
      organizationId: orgId,
      actorUserId: safeActorUserId,
      entityType: 'ORDER',
      entityId: orderId,
      eventType: 'FULFILLMENT_NOTE',
      payloadJson: { note },
    });

    return { ok: true as const };
  }

  async getFulfillmentDetail(orgId: string, orderId: string): Promise<FulfillmentDetailDto | null> {
    const queue = await this.listFulfillmentQueue(orgId, {
      type: 'all',
      status: 'all',
      showArchived: true,
      overdueOnly: false,
      page: 1,
      pageSize: 5000,
    });
    const row = queue.rows.find((entry) => entry.orderId === orderId);
    if (!row) return null;

    const [orderRow] = await this.dbInstance
      .select({
        id: orders.id,
        customerName: customers.companyName,
        customerEmail: customers.email,
        customerPhone: customers.phone,
      })
      .from(orders)
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .where(and(eq(orders.organizationId, orgId), eq(orders.id, orderId)))
      .limit(1);

    const lineItems = await this.dbInstance
      .select({
        id: orderLineItems.id,
        productName: products.name,
        description: orderLineItems.description,
        productType: orderLineItems.productType,
        quantity: orderLineItems.quantity,
        width: orderLineItems.width,
        height: orderLineItems.height,
        materialName: materials.name,
        productionNotes: orderLineItems.productionNotes,
        optionSelectionsJson: orderLineItems.optionSelectionsJson,
        selectedOptions: orderLineItems.selectedOptions,
        specsJson: orderLineItems.specsJson,
        pbv2SnapshotJson: orderLineItems.pbv2SnapshotJson,
      })
      .from(orderLineItems)
      .innerJoin(products, eq(products.id, orderLineItems.productId))
      .leftJoin(materials, eq(materials.id, orderLineItems.materialId))
      .where(eq(orderLineItems.orderId, orderId));

    const lineItemIds = lineItems.map((item) => item.id);
    const checklistRows = await this.ensureChecklistItemsForOrder(orgId, orderId);
    const checklistByLineItemId = new Map(checklistRows.map((item) => [item.lineItemId, item]));
    const checklistSummary = summarizeFulfillmentChecklist(checklistRows);

    const attachmentRows = lineItemIds.length > 0
      ? await this.dbInstance
        .select()
        .from(orderAttachments)
        .where(and(
          eq(orderAttachments.orderId, orderId),
          inArray(orderAttachments.orderLineItemId, lineItemIds),
        ))
        .orderBy(desc(orderAttachments.isPrimary), desc(orderAttachments.createdAt))
      : [];

    const fileRows = lineItemIds.length > 0
      ? await this.dbInstance
        .select({
          id: lineItemFiles.id,
          lineItemId: lineItemFiles.lineItemId,
          fileName: lineItemFiles.originalFilename,
          storageKey: lineItemFiles.storageKey,
          storagePath: lineItemFiles.storagePath,
          role: lineItemFiles.role,
          tag: lineItemFiles.tag,
          mimeType: lineItemFiles.mimeType,
          fileRecordId: lineItemFiles.fileRecordId,
          createdAt: lineItemFiles.createdAt,
        })
        .from(lineItemFiles)
        .where(and(
          eq(lineItemFiles.organizationId, orgId),
          eq(lineItemFiles.orderId, orderId),
          inArray(lineItemFiles.lineItemId, lineItemIds),
          eq(lineItemFiles.status, 'active'),
        ))
        .orderBy(desc(lineItemFiles.createdAt))
      : [];

    const linkedAssetsByLineItemId = lineItemIds.length > 0
      ? await assetRepository.listAssetsForParents(orgId, 'order_line_item', lineItemIds)
      : new Map();

    const productionSummary = await this.dbInstance
      .select({
        id: productionJobs.id,
        lineItemId: productionJobs.lineItemId,
        stationKey: productionJobs.stationKey,
        stepKey: productionJobs.stepKey,
        status: productionJobs.status,
        completedAt: productionJobs.completedAt,
        assignedPrinterName: productionJobs.assignedPrinterName,
      })
      .from(productionJobs)
      .where(and(eq(productionJobs.organizationId, orgId), eq(productionJobs.orderId, orderId)))
      .orderBy(desc(productionJobs.updatedAt));

    const productionByLineItemId = new Map<string, typeof productionSummary[number]>();
    for (const job of productionSummary) {
      if (!job.lineItemId || productionByLineItemId.has(job.lineItemId)) continue;
      productionByLineItemId.set(job.lineItemId, job);
    }

    const artworkByLineItemId = new Map<string, FulfillmentArtworkDto[]>();
    const artworkSeen = new Set<string>();
    const logOnce = createRequestLogOnce();
    const enrichedAttachmentRows = await Promise.all(
      attachmentRows.map((attachment) => enrichAttachmentWithUrls(attachment, { logOnce })),
    );
    for (const attachment of enrichedAttachmentRows) {
      pushArtwork(artworkByLineItemId, attachment.orderLineItemId, {
        id: attachment.id,
        fileName: attachment.originalFilename ?? attachment.fileName,
        fileUrl: attachment.originalUrl ?? attachment.downloadUrl ?? null,
        originalUrl: attachment.originalUrl ?? null,
        downloadUrl: attachment.downloadUrl ?? null,
        previewUrl: attachment.previewUrl ?? null,
        thumbUrl: attachment.thumbUrl ?? null,
        thumbnailUrl: attachment.thumbnailUrl ?? attachment.thumbUrl ?? null,
        thumbKey: attachment.thumbKey ?? null,
        previewKey: attachment.previewKey ?? null,
        objectPath: attachment.objectPath ?? null,
        mimeType: attachment.mimeType ?? null,
        side: attachment.side ?? null,
        role: attachment.role ?? null,
        source: 'order_attachment',
      }, artworkSeen);
    }
    for (const file of fileRows) {
      const originalAccess = await resolveOriginalFileAccess({
        id: file.id,
        fileRecordId: file.fileRecordId ?? null,
        fileName: file.fileName,
        originalFilename: file.fileName,
        mimeType: file.mimeType,
        fileUrl: file.storageKey || file.storagePath || null,
      }, { logOnce });
      pushArtwork(artworkByLineItemId, file.lineItemId, {
        id: file.id,
        fileName: file.fileName,
        fileUrl: originalAccess.originalUrl ?? originalAccess.downloadUrl ?? null,
        originalUrl: originalAccess.originalUrl ?? null,
        downloadUrl: originalAccess.downloadUrl ?? null,
        previewUrl: null,
        thumbUrl: null,
        thumbnailUrl: null,
        thumbKey: null,
        previewKey: null,
        objectPath: originalAccess.objectPath ?? null,
        mimeType: originalAccess.mimeType ?? file.mimeType ?? null,
        side: file.tag ?? null,
        role: file.role ?? null,
        source: 'line_item_file',
      }, artworkSeen);
    }
    for (const [lineItemId, assets] of Array.from(linkedAssetsByLineItemId.entries())) {
      const enrichedAssets = await enrichAssetsWithRoles(assets);
      for (const asset of enrichedAssets) {
        pushArtwork(artworkByLineItemId, lineItemId, {
          id: asset.id,
          fileName: asset.fileName ?? asset.id,
          fileUrl: asset.originalUrl ?? asset.downloadUrl ?? null,
          originalUrl: asset.originalUrl ?? null,
          downloadUrl: asset.downloadUrl ?? null,
          previewUrl: asset.previewUrl ?? null,
          thumbUrl: asset.thumbUrl ?? null,
          thumbnailUrl: asset.thumbnailUrl ?? asset.thumbUrl ?? null,
          thumbKey: asset.thumbKey ?? null,
          previewKey: asset.previewKey ?? null,
          objectPath: asset.objectPath ?? null,
          mimeType: asset.mimeType ?? null,
          side: null,
          role: asset.role ?? null,
          source: 'asset',
        }, artworkSeen);
      }
    }

    const [pickupTicket] = await this.dbInstance
      .select()
      .from(pickupTickets)
      .where(and(eq(pickupTickets.organizationId, orgId), eq(pickupTickets.orderId, orderId)))
      .limit(1);

    const shipmentRows = await this.dbInstance
      .select({
        id: shipments.id,
        status: shipments.status,
        carrier: shipments.carrier,
        serviceLevel: shipments.serviceLevel,
        trackingNumber: shipments.trackingNumber,
        shippedAt: shipments.shippedAt,
        updatedAt: shipments.updatedAt,
      })
      .from(shipmentOrders)
      .innerJoin(shipments, eq(shipments.id, shipmentOrders.shipmentId))
      .where(and(
        eq(shipmentOrders.organizationId, orgId),
        eq(shipments.organizationId, orgId),
        eq(shipmentOrders.orderId, orderId),
      ))
      .orderBy(desc(shipments.updatedAt));

    const eventConditions = [
      and(eq(fulfillmentEvents.entityType, 'ORDER'), eq(fulfillmentEvents.entityId, orderId)),
    ] as any[];
    if (pickupTicket?.id) {
      eventConditions.push(and(eq(fulfillmentEvents.entityType, 'PICKUP_TICKET'), eq(fulfillmentEvents.entityId, pickupTicket.id)));
    }
    if (shipmentRows.length > 0) {
      eventConditions.push(and(eq(fulfillmentEvents.entityType, 'SHIPMENT'), inArray(fulfillmentEvents.entityId, shipmentRows.map((s) => s.id))));
    }

    const events = await this.dbInstance
      .select({
        id: fulfillmentEvents.id,
        entityType: fulfillmentEvents.entityType,
        entityId: fulfillmentEvents.entityId,
        eventType: fulfillmentEvents.eventType,
        actorUserId: fulfillmentEvents.actorUserId,
        payloadJson: fulfillmentEvents.payloadJson,
        createdAt: fulfillmentEvents.createdAt,
      })
      .from(fulfillmentEvents)
      .where(and(eq(fulfillmentEvents.organizationId, orgId), or(...eventConditions)))
      .orderBy(desc(fulfillmentEvents.createdAt));

    return {
      ...row,
      customer: {
        name: orderRow?.customerName || row.customerName,
        email: orderRow?.customerEmail ?? null,
        phone: orderRow?.customerPhone ?? null,
      },
      lineItems: lineItems.map((item) => ({
        id: item.id,
        productName: item.productName ?? null,
        description: item.description ?? null,
        productType: item.productType ?? null,
        quantity: item.quantity == null ? null : Number(item.quantity),
        size: formatLineItemSize(item.width, item.height),
        materialName: item.materialName ?? null,
        optionSummary: buildPrepressOptionRows(item)
          .map((option) => `${option.optionLabel}: ${option.selectedLabel}`)
          .filter((value) => !!cleanText(value)),
        finishing: {
          requirements: extractFinishingBullets(item),
          lamination: buildLineItemProductionContext(item).lamination,
        },
        production: {
          jobId: productionByLineItemId.get(item.id)?.id ?? null,
          stationKey: productionByLineItemId.get(item.id)?.stationKey ?? null,
          stationLabel: stationLabel(productionByLineItemId.get(item.id)?.stationKey),
          status: productionByLineItemId.get(item.id)?.status ?? null,
          completedAt: toIso(productionByLineItemId.get(item.id)?.completedAt),
        },
        artwork: artworkByLineItemId.get(item.id) ?? [],
        checklist: {
          id: checklistByLineItemId.get(item.id)?.id ?? '',
          checked: checklistByLineItemId.get(item.id)?.checked === true,
          checkedByUserId: checklistByLineItemId.get(item.id)?.checkedByUserId ?? null,
          checkedAt: toIso(checklistByLineItemId.get(item.id)?.checkedAt),
          notes: checklistByLineItemId.get(item.id)?.notes ?? null,
        },
      })),
      checklistComplete: checklistSummary.complete,
      checklistSummary: {
        total: checklistSummary.total,
        checked: checklistSummary.checked,
        unchecked: checklistSummary.unchecked,
      },
      productionSummary: productionSummary.map((job) => ({
        id: job.id,
        lineItemId: job.lineItemId ?? null,
        stationKey: job.stationKey,
        stepKey: job.stepKey,
        status: job.status,
        completedAt: toIso(job.completedAt),
        assignedPrinterName: job.assignedPrinterName ?? null,
      })),
      pickupTicket: pickupTicket ? {
        id: pickupTicket.id,
        status: pickupTicket.status,
        readyAt: toIso(pickupTicket.readyAt),
        pickedUpAt: toIso(pickupTicket.pickedUpAt),
        stagingLocation: pickupTicket.stagingLocation ?? null,
        pickupNotes: pickupTicket.pickupNotes ?? null,
        contactName: pickupTicket.contactName ?? null,
        contactEmail: pickupTicket.contactEmail ?? null,
        contactPhone: pickupTicket.contactPhone ?? null,
      } : null,
      shipments: shipmentRows.map((shipment) => ({
        id: shipment.id,
        status: shipment.status,
        carrier: shipment.carrier ?? null,
        serviceLevel: shipment.serviceLevel ?? null,
        trackingNumber: shipment.trackingNumber ?? null,
        shippedAt: toIso(shipment.shippedAt),
        updatedAt: toIso(shipment.updatedAt),
      })),
      events: events.map((event) => ({
        id: event.id,
        entityType: event.entityType,
        entityId: event.entityId,
        eventType: event.eventType,
        actorUserId: event.actorUserId ?? null,
        payloadJson: event.payloadJson ?? {},
        createdAt: toIso(event.createdAt) || new Date().toISOString(),
      })),
    };
  }

  async getOrdersForCombinedShipmentValidation(orgId: string, orderIds: string[]) {
    if (orderIds.length === 0) return [];
    return this.dbInstance
      .select({
        id: orders.id,
        shippingMethod: orders.shippingMethod,
        state: orders.state,
        status: orders.status,
        canceledAt: orders.canceledAt,
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

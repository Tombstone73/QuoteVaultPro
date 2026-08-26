import { and, desc, eq, ilike, inArray, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  customers,
  fulfillmentChecklistItems,
  fulfillmentEvents,
  fulfillmentReadyQuantities,
  materials,
  orderLineItems,
  orders,
  organizations,
  outboundNotifications,
  pickupHandoffItems,
  pickupHandoffs,
  pickupTickets,
  products,
  productionJobs,
  productionRunMembers,
  productionRuns,
  shipmentItems,
  shipmentOrders,
  shipmentPackages,
  shipments,
  users,
} from '@shared/schema';
import { FulfillmentHttpError, type DerivedOrderFulfillmentStatus, type FulfillmentDetailDto, type QueueRowDto } from './types';
import { TERMINAL_PRODUCTION_STATUSES } from '@shared/operationalState';
import { isCanceledOrder } from '@shared/operationalState';
import { buildPrepressOptionRows, extractFinishingBullets } from '../../routes/flatStockNesting.shared';
import { fulfillmentQueueEligibleOrderCondition, isFulfillmentQueueEligibleOrder } from './eligibility';
import { lineItemArtworkReadResolver } from '../artwork/LineItemArtworkReadResolver';
import { buildFulfillmentWorkspaceQueueRow } from './workspace';
import { resolveActiveProductionOwners } from '../productionOwnership';
import { resolveFulfillmentLineQuantity, summarizeFulfillmentOrderQuantities, type FulfillmentLineQuantityProjection } from '@shared/fulfillmentReadiness';

const SHIP_READY_OVERDUE_HOURS = 48;
const DEFAULT_PICKUP_RETENTION_DAYS_AFTER_PICKED_UP = 7;
const PRINT_CONTEXT_EXCLUDED_STATIONS = new Set(['fulfillment', 'prepress', 'design']);

type FulfillmentArtworkDto = FulfillmentDetailDto['lineItems'][number]['artwork'][number];

type DbExecutor = typeof db;

export type FulfillmentLineEligibilityRecord = {
  id: string;
  orderId: string;
  projection: FulfillmentLineQuantityProjection;
};

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
    return this.dbInstance.transaction(async (tx) => {
      // Serialize references for a primary order without making the UUID an
      // operator-facing identifier.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${orgId} || ':' || ${primaryOrderId || ''}))`);
      const safeCreatedByUserId = await resolveExistingActorUserId(tx, payload.createdByUserId);
      const [order] = primaryOrderId ? await tx.select({ orderNumber: orders.orderNumber })
        .from(orders).where(and(eq(orders.id, primaryOrderId), eq(orders.organizationId, orgId))).limit(1) : [];
      const [{ count }] = await tx.select({ count: sql<number>`COUNT(*)::int` }).from(shipments)
        .where(and(eq(shipments.organizationId, orgId), eq(shipments.primaryOrderId, primaryOrderId)));
      const reference = `SH-${order?.orderNumber || 'MULTI'}-${String(Number(count || 0) + 1).padStart(2, '0')}`;
      const [shipment] = await tx.insert(shipments).values({
        organizationId: orgId, status: 'DRAFT', scope: payload.scope, orderId: primaryOrderId,
        primaryOrderId, shipmentReference: reference, createdByUserId: safeCreatedByUserId,
      }).returning();
      if (payload.orderIds.length > 0) {
        await tx.insert(shipmentOrders).values(payload.orderIds.map((orderId) => ({
          organizationId: orgId, shipmentId: shipment.id, orderId,
        }))).onConflictDoNothing();
      }
      await tx.insert(fulfillmentEvents).values({
        organizationId: orgId, actorUserId: safeCreatedByUserId, entityType: 'SHIPMENT', entityId: shipment.id,
        eventType: 'SHIPMENT_CREATED', payloadJson: { orderIds: payload.orderIds, scope: payload.scope, shipmentReference: reference },
      });
      return shipment;
    });
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
    packageId?: string | null;
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
        packageId: item.packageId ?? null,
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

  /** Replace draft allocations atomically, after proving every submitted line
   * belongs to the tenant, shipment order set, and (when provided) package. */
  async replaceDraftShipmentItems(orgId: string, shipmentId: string, items: Array<{
    orderId: string; orderLineItemId: string; quantity: number; packageId?: string | null;
  }>) {
    return this.dbInstance.transaction(async (tx) => {
      const [shipment] = await tx.select({ id: shipments.id }).from(shipments).where(and(
        eq(shipments.id, shipmentId), eq(shipments.organizationId, orgId), eq(shipments.status, 'DRAFT'),
      )).limit(1);
      if (!shipment) return { ok: false as const, code: 'INVALID_STATE', message: 'Only DRAFT shipments are editable' };
      const orderLinks = await tx.select({ orderId: shipmentOrders.orderId }).from(shipmentOrders).where(and(
        eq(shipmentOrders.organizationId, orgId), eq(shipmentOrders.shipmentId, shipmentId),
      ));
      const allowedOrderIds = new Set(orderLinks.map((row) => row.orderId));
      const ids = Array.from(new Set(items.map((item) => item.orderLineItemId)));
      const lineRows = ids.length ? await tx.select({ id: orderLineItems.id, orderId: orderLineItems.orderId, quantity: orderLineItems.quantity })
        .from(orderLineItems).innerJoin(orders, eq(orders.id, orderLineItems.orderId))
        .where(and(eq(orders.organizationId, orgId), inArray(orderLineItems.id, ids))) : [];
      const lines = new Map(lineRows.map((line) => [line.id, line]));
      const packageIds = Array.from(new Set(items.map((item) => item.packageId).filter((id): id is string => !!id)));
      const packages = packageIds.length ? await tx.select({ id: shipmentPackages.id }).from(shipmentPackages).where(and(
        eq(shipmentPackages.organizationId, orgId), eq(shipmentPackages.shipmentId, shipmentId), inArray(shipmentPackages.id, packageIds),
      )) : [];
      const validPackageIds = new Set(packages.map((entry) => entry.id));
      for (const item of items) {
        const line = lines.get(item.orderLineItemId);
        if (!line || line.orderId !== item.orderId || !allowedOrderIds.has(item.orderId)) {
          return { ok: false as const, code: 'INVALID_SHIPMENT_ITEM', message: 'A shipment item does not belong to this shipment order' };
        }
        if (item.packageId && !validPackageIds.has(item.packageId)) {
          return { ok: false as const, code: 'INVALID_PACKAGE', message: 'A shipment item references a package outside this shipment' };
        }
      }
      await tx.delete(shipmentItems).where(and(eq(shipmentItems.organizationId, orgId), eq(shipmentItems.shipmentId, shipmentId)));
      if (items.length) await tx.insert(shipmentItems).values(items.map((item) => ({
        organizationId: orgId, shipmentId, orderId: item.orderId, orderLineItemId: item.orderLineItemId,
        quantity: item.quantity, packageId: item.packageId ?? null,
      })));
      return { ok: true as const };
    });
  }

  async listShipmentPackages(orgId: string, shipmentId: string) {
    return this.dbInstance.select().from(shipmentPackages).where(and(
      eq(shipmentPackages.organizationId, orgId), eq(shipmentPackages.shipmentId, shipmentId),
    )).orderBy(shipmentPackages.ordinal);
  }

  async createShipmentPackage(orgId: string, shipmentId: string, payload: {
    weightLbs?: number | null; dimLengthIn?: number | null; dimWidthIn?: number | null; dimHeightIn?: number | null; notes?: string | null;
  }) {
    return this.dbInstance.transaction(async (tx) => {
      const [shipment] = await tx.select({ id: shipments.id, shipmentReference: shipments.shipmentReference }).from(shipments).where(and(
        eq(shipments.id, shipmentId), eq(shipments.organizationId, orgId), eq(shipments.status, 'DRAFT'),
      )).limit(1);
      if (!shipment) return null;
      const [{ count }] = await tx.select({ count: sql<number>`COUNT(*)::int` }).from(shipmentPackages).where(and(
        eq(shipmentPackages.organizationId, orgId), eq(shipmentPackages.shipmentId, shipmentId),
      ));
      const ordinal = Number(count || 0) + 1;
      const [created] = await tx.insert(shipmentPackages).values({
        organizationId: orgId, shipmentId, ordinal, packageReference: `${shipment.shipmentReference || `SH-${shipmentId.slice(0, 8)}`}-P${ordinal}`,
        weightLbs: payload.weightLbs == null ? null : String(payload.weightLbs), dimLengthIn: payload.dimLengthIn == null ? null : String(payload.dimLengthIn),
        dimWidthIn: payload.dimWidthIn == null ? null : String(payload.dimWidthIn), dimHeightIn: payload.dimHeightIn == null ? null : String(payload.dimHeightIn), notes: payload.notes ?? null,
      }).returning();
      await tx.update(shipments).set({ boxCount: ordinal, updatedAt: new Date() }).where(and(
        eq(shipments.organizationId, orgId), eq(shipments.id, shipmentId), eq(shipments.status, 'DRAFT'),
      ));
      return created;
    });
  }

  async patchDraftShipmentPackages(orgId: string, shipmentId: string, packages: Array<{
    id: string; weightLbs?: number | null; dimLengthIn?: number | null; dimWidthIn?: number | null; dimHeightIn?: number | null; notes?: string | null;
  }>) {
    if (!packages.length) return;
    await this.dbInstance.transaction(async (tx) => {
      const existing = await tx.select({ id: shipmentPackages.id }).from(shipmentPackages).where(and(
        eq(shipmentPackages.organizationId, orgId), eq(shipmentPackages.shipmentId, shipmentId),
      ));
      const existingIds = new Set(existing.map((entry) => entry.id));
      if (packages.some((item) => !existingIds.has(item.id))) {
        throw new FulfillmentHttpError(400, 'A package does not belong to this draft shipment', 'INVALID_PACKAGE');
      }
      for (const item of packages) {
        await tx.update(shipmentPackages).set({
          weightLbs: item.weightLbs == null ? null : String(item.weightLbs),
          dimLengthIn: item.dimLengthIn == null ? null : String(item.dimLengthIn),
          dimWidthIn: item.dimWidthIn == null ? null : String(item.dimWidthIn),
          dimHeightIn: item.dimHeightIn == null ? null : String(item.dimHeightIn),
          notes: item.notes ?? null,
          updatedAt: new Date(),
        }).where(and(eq(shipmentPackages.organizationId, orgId), eq(shipmentPackages.shipmentId, shipmentId), eq(shipmentPackages.id, item.id)));
      }
      await tx.update(shipments).set({ boxCount: existing.length, updatedAt: new Date() }).where(and(
        eq(shipments.organizationId, orgId), eq(shipments.id, shipmentId), eq(shipments.status, 'DRAFT'),
      ));
    });
  }

  async deleteShipmentPackage(orgId: string, shipmentId: string, packageId: string) {
    return this.dbInstance.transaction(async (tx) => {
      const [deleted] = await tx.delete(shipmentPackages).where(and(eq(shipmentPackages.id, packageId), eq(shipmentPackages.shipmentId, shipmentId), eq(shipmentPackages.organizationId, orgId))).returning();
      if (!deleted) return null;
      const [{ count }] = await tx.select({ count: sql<number>`COUNT(*)::int` }).from(shipmentPackages).where(and(
        eq(shipmentPackages.organizationId, orgId), eq(shipmentPackages.shipmentId, shipmentId),
      ));
      await tx.update(shipments).set({ boxCount: Number(count || 0), updatedAt: new Date() }).where(and(
        eq(shipments.organizationId, orgId), eq(shipments.id, shipmentId), eq(shipments.status, 'DRAFT'),
      ));
      return deleted;
    });
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
      if (lineItemIds.length > 0) await tx.execute(sql`SELECT ${orderLineItems.id} FROM ${orderLineItems} WHERE ${inArray(orderLineItems.id, lineItemIds)} FOR UPDATE`);
      const lineRows = lineItemIds.length > 0
        ? await tx
          .select({
            id: orderLineItems.id,
            quantity: orderLineItems.quantity,
            workflowState: orderLineItems.workflowState,
            lifecycleStatus: orderLineItems.status,
            productionBypassed: orderLineItems.productionBypassed,
            lineItemRole: orderLineItems.lineItemRole,
            workflowIntent: products.workflowIntent,
            requiresProductionJob: products.requiresProductionJob,
          })
          .from(orderLineItems).innerJoin(products, eq(products.id, orderLineItems.productId))
          .where(and(eq(products.organizationId, orgId), inArray(orderLineItems.id, lineItemIds)))
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
      const pickedUpRows = lineItemIds.length > 0
        ? await tx.select({ id: pickupHandoffItems.orderLineItemId, quantity: sql<number>`COALESCE(SUM(${pickupHandoffItems.quantity}), 0)::int` })
          .from(pickupHandoffItems).innerJoin(pickupHandoffs, eq(pickupHandoffs.id, pickupHandoffItems.pickupHandoffId))
          .where(and(eq(pickupHandoffItems.organizationId, orgId), eq(pickupHandoffs.organizationId, orgId), inArray(pickupHandoffItems.orderLineItemId, lineItemIds))).groupBy(pickupHandoffItems.orderLineItemId)
        : [];
      const pickedUpByLine = new Map(pickedUpRows.map((row) => [row.id, Number(row.quantity || 0)]));

      for (const [lineItemId, draftQty] of Array.from(draftByLineItem.entries())) {
        const line = lineRows.find((row) => row.id === lineItemId);
        const orderedQty = orderedQtyByLineItem.get(lineItemId);
        if (!orderedQty || !line) {
          return { ok: false as const, code: 'LINE_ITEM_NOT_FOUND', message: `Line item ${lineItemId} was not found` };
        }
        const projection = resolveFulfillmentLineQuantity({ ...line, orderedQuantity: Number(orderedQty),
          shippedQuantity: alreadyShippedByLineItem.get(lineItemId) ?? 0, pickedUpQuantity: pickedUpByLine.get(lineItemId) ?? 0 });
        if (!projection.requiresFulfillment || draftQty > projection.remainingQuantity) {
          return {
            ok: false as const,
            code: 'QTY_EXCEEDS_ORDER',
            message: `Quantity exceeds the remaining order quantity for line item ${lineItemId}`,
          };
        }
      }

      const now = new Date();
      const [updated] = await tx
        .update(shipments)
        .set({
          status: 'SHIPPED',
          shippedAt: now,
          // DATE columns are calendar strings. Never pass a timestamp/invalid
          // Date through the DATE serializer during the terminal transition.
          shipDate: shipment.shipDate || now.toISOString().slice(0, 10),
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

    const [orderLinks, items, packages] = await Promise.all([
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
          packageId: shipmentItems.packageId,
        })
        .from(shipmentItems)
        .where(and(
          eq(shipmentItems.organizationId, orgId),
          eq(shipmentItems.shipmentId, shipmentId),
        )),
      this.listShipmentPackages(orgId, shipmentId),
    ]);

    return {
      ...shipment,
      orders: orderLinks,
      items,
      packages,
    };
  }

  async listShipments(orgId: string, filters: {
    status?: string;
    search?: string;
    page: number;
    pageSize: number;
    sortBy: 'orderNumber' | 'customer' | 'fulfillmentType' | 'status' | 'dueDate' | 'createdAt' | 'readyQuantity' | 'destination';
    sortDirection: 'asc' | 'desc';
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

  /** Append, never overwrite, a pickup handoff. The affected order lines are
   * locked so pickup cannot race shipment or another pickup; immutable prior
   * fulfillment is the authority for the remaining-order ceiling. */
  async recordPartialPickup(orgId: string, ticketId: string, payload: {
    items: Array<{ orderLineItemId: string; quantity: number }>;
    notes?: string | null;
    clientRequestId?: string | null;
  }, actorUserId?: string | null) {
    return this.dbInstance.transaction(async (tx) => {
      const [ticket] = await tx.select().from(pickupTickets).where(and(
        eq(pickupTickets.id, ticketId), eq(pickupTickets.organizationId, orgId),
      )).limit(1);
      if (!ticket) return { ok: false as const, code: 'NOT_FOUND', message: 'Pickup ticket not found' };

      await tx.execute(sql`SELECT ${orderLineItems.id} FROM ${orderLineItems} WHERE ${orderLineItems.orderId} = ${ticket.orderId} FOR UPDATE`);
      // The line lock serializes concurrent pickup/shipment operations. Check
      // the replay key after taking it so a retry cannot append a second
      // immutable handoff while the first request is committing.
      if (payload.clientRequestId) {
        const [existing] = await tx.select().from(pickupHandoffs).where(and(
          eq(pickupHandoffs.organizationId, orgId),
          eq(pickupHandoffs.pickupTicketId, ticketId),
          eq(pickupHandoffs.clientRequestId, payload.clientRequestId),
        )).limit(1);
        if (existing) {
          return { ok: true as const, ticket, handoff: existing, terminal: ticket.status === 'PICKED_UP', replayed: true };
        }
      }
      if (ticket.status !== 'DRAFT' && ticket.status !== 'READY_FOR_PICKUP') {
        return { ok: false as const, code: 'INVALID_STATE', message: 'Only active pickup tickets can record a handoff' };
      }

      const lines = await tx.select({
        id: orderLineItems.id, quantity: orderLineItems.quantity, workflowState: orderLineItems.workflowState,
        lifecycleStatus: orderLineItems.status, productionBypassed: orderLineItems.productionBypassed,
        lineItemRole: orderLineItems.lineItemRole, workflowIntent: products.workflowIntent, requiresProductionJob: products.requiresProductionJob,
      }).from(orderLineItems).innerJoin(products, eq(products.id, orderLineItems.productId)).where(and(
        eq(orderLineItems.orderId, ticket.orderId), eq(products.organizationId, orgId),
      ));
      const byId = new Map(lines.map((line) => [line.id, line]));
      const requested = new Map<string, number>();
      for (const item of payload.items) requested.set(item.orderLineItemId, (requested.get(item.orderLineItemId) ?? 0) + item.quantity);
      if (!requested.size || Array.from(requested.entries()).some(([id, qty]) => !byId.has(id) || !Number.isInteger(qty) || qty <= 0)) {
        return { ok: false as const, code: 'INVALID_HANDOFF_ITEMS', message: 'Pickup handoff items must be positive quantities from this order.' };
      }
      const ids = lines.map((line) => line.id);
      const [shippedRows, pickedRows] = await Promise.all([
        tx.select({ id: shipmentItems.orderLineItemId, quantity: sql<number>`COALESCE(SUM(${shipmentItems.quantity}), 0)::int` })
          .from(shipmentItems).innerJoin(shipments, eq(shipments.id, shipmentItems.shipmentId))
          .where(and(eq(shipmentItems.organizationId, orgId), eq(shipments.organizationId, orgId), eq(shipments.status, 'SHIPPED'), inArray(shipmentItems.orderLineItemId, ids))).groupBy(shipmentItems.orderLineItemId),
        tx.select({ id: pickupHandoffItems.orderLineItemId, quantity: sql<number>`COALESCE(SUM(${pickupHandoffItems.quantity}), 0)::int` })
          .from(pickupHandoffItems).innerJoin(pickupHandoffs, eq(pickupHandoffs.id, pickupHandoffItems.pickupHandoffId))
          .where(and(eq(pickupHandoffItems.organizationId, orgId), eq(pickupHandoffs.organizationId, orgId), inArray(pickupHandoffItems.orderLineItemId, ids))).groupBy(pickupHandoffItems.orderLineItemId),
      ]);
      const shipped = new Map(shippedRows.map((row) => [row.id, Number(row.quantity || 0)]));
      const picked = new Map(pickedRows.map((row) => [row.id, Number(row.quantity || 0)]));
      const projections = lines.map((line) => resolveFulfillmentLineQuantity({
        ...line, orderedQuantity: Number(line.quantity || 0),
        shippedQuantity: shipped.get(line.id) ?? 0, pickedUpQuantity: picked.get(line.id) ?? 0,
      }));
      for (const [lineItemId, handoffQuantity] of Array.from(requested.entries())) {
        const projection = projections[lines.findIndex((line) => line.id === lineItemId)];
        if (!projection?.requiresFulfillment || handoffQuantity > projection.remainingQuantity) {
          return { ok: false as const, code: 'QTY_EXCEEDS_ORDER', message: 'Pickup quantity exceeds the remaining order quantity for a line item.' };
        }
      }
      const safeActorUserId = await resolveExistingActorUserId(tx, actorUserId);
      const [handoff] = await tx.insert(pickupHandoffs).values({ organizationId: orgId, pickupTicketId: ticketId, orderId: ticket.orderId, handedOffByUserId: safeActorUserId, notes: payload.notes ?? null, clientRequestId: payload.clientRequestId ?? null }).returning();
      await tx.insert(pickupHandoffItems).values(Array.from(requested.entries()).map(([orderLineItemId, quantity]) => ({ organizationId: orgId, pickupHandoffId: handoff.id, orderId: ticket.orderId, orderLineItemId, quantity })));
      const now = new Date();
      const allFulfilled = projections.every((projection, index) => !projection.requiresFulfillment || projection.remainingQuantity - (requested.get(lines[index].id) ?? 0) <= 0);
      const [updatedTicket] = await tx.update(pickupTickets).set({
        status: allFulfilled ? 'PICKED_UP' : ticket.status, pickedUpAt: allFulfilled ? now : null, updatedAt: now,
      }).where(and(eq(pickupTickets.id, ticketId), eq(pickupTickets.organizationId, orgId))).returning();
      await tx.update(orders).set({ fulfillmentStatus: allFulfilled ? 'delivered' : 'partially_picked_up', updatedAt: now.toISOString() })
        .where(and(eq(orders.id, ticket.orderId), eq(orders.organizationId, orgId)));
      await tx.insert(fulfillmentEvents).values({ organizationId: orgId, actorUserId: safeActorUserId, entityType: 'PICKUP_TICKET', entityId: ticketId,
        eventType: 'PICKUP_HANDOFF_RECORDED', payloadJson: { handoffId: handoff.id, itemCount: requested.size, terminal: allFulfilled } });
      return { ok: true as const, ticket: updatedTicket, handoff, terminal: allFulfilled };
    });
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

  async listLineEligibility(orgId: string, input: { orderIds?: string[]; lineItemIds?: string[] }): Promise<FulfillmentLineEligibilityRecord[]> {
    const orderIds = Array.from(new Set(input.orderIds ?? [])).filter(Boolean);
    const lineItemIds = Array.from(new Set(input.lineItemIds ?? [])).filter(Boolean);
    if (orderIds.length === 0 && lineItemIds.length === 0) return [];

    const scope = orderIds.length > 0
      ? inArray(orderLineItems.orderId, orderIds)
      : inArray(orderLineItems.id, lineItemIds);
    const lines = await this.dbInstance.select({
      id: orderLineItems.id,
      orderId: orderLineItems.orderId,
      quantity: orderLineItems.quantity,
      workflowState: orderLineItems.workflowState,
      lifecycleStatus: orderLineItems.status,
      productionBypassed: orderLineItems.productionBypassed,
      lineItemRole: orderLineItems.lineItemRole,
      workflowIntent: products.workflowIntent,
      requiresProductionJob: products.requiresProductionJob,
    }).from(orderLineItems)
      .innerJoin(orders, eq(orders.id, orderLineItems.orderId))
      .innerJoin(products, eq(products.id, orderLineItems.productId))
      .where(and(eq(orders.organizationId, orgId), eq(products.organizationId, orgId), scope));
    if (lines.length === 0) return [];

    const ids = lines.map((line) => line.id);
    const [owners, producedRows, shippedRows, pickedUpRows, readyRows] = await Promise.all([
      resolveActiveProductionOwners(this.dbInstance, {
        organizationId: orgId,
        lineItemIds: ids,
        debugLabel: 'FulfillmentDashboardRepo.listLineEligibility',
      }),
      this.dbInstance.select({
        lineItemId: productionRunMembers.orderLineItemId,
        quantity: sql<number>`COALESCE(SUM(${productionRunMembers.successfulQuantity}), 0)::int`,
      }).from(productionRunMembers)
        .innerJoin(productionRuns, eq(productionRuns.id, productionRunMembers.productionRunId))
        .where(and(
          eq(productionRunMembers.organizationId, orgId),
          eq(productionRuns.organizationId, orgId),
          inArray(productionRunMembers.orderLineItemId, ids),
          notInArray(productionRuns.status, ['cancelled', 'canceled'] as any),
        ))
        .groupBy(productionRunMembers.orderLineItemId),
      this.dbInstance.select({
        lineItemId: shipmentItems.orderLineItemId,
        quantity: sql<number>`COALESCE(SUM(${shipmentItems.quantity}), 0)::int`,
      }).from(shipmentItems)
        .innerJoin(shipments, eq(shipments.id, shipmentItems.shipmentId))
        .where(and(
          eq(shipmentItems.organizationId, orgId),
          eq(shipments.organizationId, orgId),
          eq(shipments.status, 'SHIPPED'),
          inArray(shipmentItems.orderLineItemId, ids),
        ))
        .groupBy(shipmentItems.orderLineItemId),
      this.dbInstance.select({
        lineItemId: pickupHandoffItems.orderLineItemId,
        quantity: sql<number>`COALESCE(SUM(${pickupHandoffItems.quantity}), 0)::int`,
      }).from(pickupHandoffItems)
        .innerJoin(pickupHandoffs, eq(pickupHandoffs.id, pickupHandoffItems.pickupHandoffId))
        .where(and(
          eq(pickupHandoffItems.organizationId, orgId),
          eq(pickupHandoffs.organizationId, orgId),
          inArray(pickupHandoffItems.orderLineItemId, ids),
        ))
        .groupBy(pickupHandoffItems.orderLineItemId),
      this.dbInstance.select({
        lineItemId: fulfillmentReadyQuantities.orderLineItemId,
        quantity: fulfillmentReadyQuantities.readyWaitingQuantity,
      }).from(fulfillmentReadyQuantities).where(and(
        eq(fulfillmentReadyQuantities.organizationId, orgId),
        inArray(fulfillmentReadyQuantities.orderLineItemId, ids),
      )),
    ]);
    const producedByLine = new Map(producedRows.map((row) => [row.lineItemId, Number(row.quantity || 0)]));
    const shippedByLine = new Map(shippedRows.map((row) => [row.lineItemId, Number(row.quantity || 0)]));
    const pickedUpByLine = new Map(pickedUpRows.map((row) => [row.lineItemId, Number(row.quantity || 0)]));
    const readyByLine = new Map(readyRows.map((row) => [row.lineItemId, Number(row.quantity || 0)]));

    return lines.map((line) => {
      const owner = owners.get(line.id);
      return {
        id: line.id,
        orderId: line.orderId,
        projection: resolveFulfillmentLineQuantity({
          workflowIntent: line.workflowIntent,
          requiresProductionJob: line.requiresProductionJob,
          lineItemRole: line.lineItemRole,
          productionBypassed: line.productionBypassed,
          workflowState: line.workflowState,
          lifecycleStatus: line.lifecycleStatus,
          activeOwnerStationKey: owner?.stationKey,
          activeOwnerStepKey: owner?.stepKey,
          activeOwnerStatus: owner?.status,
          orderedQuantity: Number(line.quantity || 0),
          productionCompleteQuantity: producedByLine.get(line.id) ?? 0,
          shippedQuantity: shippedByLine.get(line.id) ?? 0,
          pickedUpQuantity: pickedUpByLine.get(line.id) ?? 0,
          readyWaitingQuantity: readyByLine.get(line.id) ?? 0,
        }),
      };
    });
  }

  /** Adjust Fulfillment's mutable ready pool. Handoffs and shipments are
   * deliberately not touched here: they are immutable evidence of fulfillment. */
  async adjustReadyQuantities(orgId: string, orderId: string, items: Array<{ orderLineItemId: string; quantityDelta: number }>, actorUserId?: string | null) {
    return this.dbInstance.transaction(async (tx) => {
      const [order] = await tx.select({
        id: orders.id,
        shippingMethod: orders.shippingMethod,
        state: orders.state,
        status: orders.status,
        canceledAt: orders.canceledAt,
      }).from(orders).where(and(eq(orders.organizationId, orgId), eq(orders.id, orderId))).limit(1);
      if (!order) return { ok: false as const, code: 'NOT_FOUND', message: 'Order not found' };
      if (isCanceledOrder(order)) return { ok: false as const, code: 'ORDER_CANCELLED', message: 'Cancelled orders cannot change fulfillment readiness' };

      const requested = new Map<string, number>();
      for (const item of items) requested.set(item.orderLineItemId, (requested.get(item.orderLineItemId) ?? 0) + Math.trunc(Number(item.quantityDelta)));
      if (!requested.size || Array.from(requested.values()).some((value) => !Number.isInteger(value) || value === 0)) {
        return { ok: false as const, code: 'INVALID_READY_ITEMS', message: 'Readiness adjustments require non-zero integer quantities.' };
      }

      await tx.execute(sql`SELECT ${orderLineItems.id} FROM ${orderLineItems} WHERE ${orderLineItems.orderId} = ${orderId} FOR UPDATE`);
      const lines = await tx.select({ id: orderLineItems.id, quantity: orderLineItems.quantity })
        .from(orderLineItems).where(eq(orderLineItems.orderId, orderId));
      const lineById = new Map(lines.map((line) => [line.id, line]));
      if (Array.from(requested.keys()).some((lineItemId) => !lineById.has(lineItemId))) {
        return { ok: false as const, code: 'LINE_ITEM_NOT_FOUND', message: 'Readiness line item does not belong to this order.' };
      }

      const lineIds = lines.map((line) => line.id);
      const [readyRows, shippedRows, pickedRows] = await Promise.all([
        tx.select().from(fulfillmentReadyQuantities).where(and(eq(fulfillmentReadyQuantities.organizationId, orgId), eq(fulfillmentReadyQuantities.orderId, orderId))),
        tx.select({ lineItemId: shipmentItems.orderLineItemId, quantity: sql<number>`COALESCE(SUM(${shipmentItems.quantity}), 0)::int` })
          .from(shipmentItems).innerJoin(shipments, eq(shipments.id, shipmentItems.shipmentId))
          .where(and(eq(shipmentItems.organizationId, orgId), eq(shipments.organizationId, orgId), eq(shipments.status, 'SHIPPED'), inArray(shipmentItems.orderLineItemId, lineIds))).groupBy(shipmentItems.orderLineItemId),
        tx.select({ lineItemId: pickupHandoffItems.orderLineItemId, quantity: sql<number>`COALESCE(SUM(${pickupHandoffItems.quantity}), 0)::int` })
          .from(pickupHandoffItems).innerJoin(pickupHandoffs, eq(pickupHandoffs.id, pickupHandoffItems.pickupHandoffId))
          .where(and(eq(pickupHandoffItems.organizationId, orgId), eq(pickupHandoffs.organizationId, orgId), inArray(pickupHandoffItems.orderLineItemId, lineIds))).groupBy(pickupHandoffItems.orderLineItemId),
      ]);
      const readyByLine = new Map(readyRows.map((row) => [row.orderLineItemId, Number(row.readyWaitingQuantity || 0)]));
      const shippedByLine = new Map(shippedRows.map((row) => [row.lineItemId, Number(row.quantity || 0)]));
      const pickedByLine = new Map(pickedRows.map((row) => [row.lineItemId, Number(row.quantity || 0)]));
      const adjustments: Array<{ lineItemId: string; quantityDelta: number; next: number }> = [];
      for (const [lineItemId, quantityDelta] of requested) {
        const line = lineById.get(lineItemId)!;
        const current = readyByLine.get(lineItemId) ?? 0;
        const fulfilled = (shippedByLine.get(lineItemId) ?? 0) + (pickedByLine.get(lineItemId) ?? 0);
        const next = current + quantityDelta;
        const remaining = Math.max(0, Number(line.quantity || 0) - fulfilled);
        if (next < 0) return { ok: false as const, code: 'QTY_BELOW_FULFILLED', message: 'Cannot un-ready quantity that has already been picked up or shipped.' };
        if (next > remaining) return { ok: false as const, code: 'QTY_EXCEEDS_ORDER', message: 'Ready quantity exceeds the remaining order quantity.' };
        adjustments.push({ lineItemId, quantityDelta, next });
      }

      // Validate every requested line before touching the mutable pool. Returning a
      // normal error from a transaction commits prior writes, so a multi-line
      // operator action must be fully preflighted to remain all-or-nothing.
      const safeActorUserId = await resolveExistingActorUserId(tx, actorUserId);
      const now = new Date();
      for (const { lineItemId, next } of adjustments) {
        await tx.insert(fulfillmentReadyQuantities).values({
          organizationId: orgId, orderId, orderLineItemId: lineItemId, readyWaitingQuantity: next, updatedByUserId: safeActorUserId, updatedAt: now,
        }).onConflictDoUpdate({
          target: [fulfillmentReadyQuantities.organizationId, fulfillmentReadyQuantities.orderId, fulfillmentReadyQuantities.orderLineItemId],
          set: { readyWaitingQuantity: next, updatedByUserId: safeActorUserId, updatedAt: now },
        });
      }

      await tx.insert(fulfillmentEvents).values({
        organizationId: orgId,
        actorUserId: safeActorUserId,
        entityType: 'ORDER',
        entityId: orderId,
        eventType: 'FULFILLMENT_READY',
        payloadJson: { adjustments: Array.from(requested, ([orderLineItemId, quantityDelta]) => ({ orderLineItemId, quantityDelta })) },
      });
      return { ok: true as const, shippingMethod: order.shippingMethod };
    });
  }

  async listFulfillmentQueue(orgId: string, filters: {
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
    const baseOrderConditions = [
      eq(orders.organizationId, orgId),
      isNull(orders.canceledAt),
      sql`lower(coalesce(${orders.status}, '')) not in ('canceled', 'cancelled')`,
    ] as any[];

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
        createdAt: orders.createdAt,
        dueDate: orders.dueDate,
        shipToCity: orders.shipToCity,
        shipToState: orders.shipToState,
        customerName: customers.companyName,
      })
      .from(orders)
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .where(and(...baseOrderConditions));

    const orderIds = orderRows.map((o) => o.id);
    const pickupRetentionDays = await this.getPickupRetentionDays(orgId);

    const eligibilityRows = orderIds.length > 0 ? await this.listLineEligibility(orgId, { orderIds }) : [];
    const eligibilityByOrder = new Map<string, FulfillmentLineQuantityProjection[]>();
    for (const line of eligibilityRows) {
      const rows = eligibilityByOrder.get(line.orderId) ?? [];
      rows.push(line.projection);
      eligibilityByOrder.set(line.orderId, rows);
    }
    const quantitySummaryByOrder = new Map(orderIds.map((orderId) => [
      orderId,
      summarizeFulfillmentOrderQuantities(eligibilityByOrder.get(orderId) ?? []),
    ]));

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
      const quantitySummary = quantitySummaryByOrder.get(order.id) ?? summarizeFulfillmentOrderQuantities([]);
      if (quantitySummary.physicalLineCount === 0) continue;
      const orderedQty = quantitySummary.orderedQuantity;
      const shippedQty = quantitySummary.shippedQuantity;
      const remaining = quantitySummary.remainingQuantity;

      const isPickup = order.shippingMethod === 'pickup';
      if (filters.type === 'ship' && isPickup) continue;
      if (filters.type === 'pickup' && !isPickup) continue;
      const productionContext = productionContextByOrder.get(order.id);
      if (filters.printer && filters.printer !== 'all') {
        const names = productionContext?.printerNames ?? [];
        if (filters.printer === 'unassigned' ? Boolean(productionContext?.primaryPrinterName) : !names.includes(filters.printer)) continue;
      }

      if (isPickup) {
        const ticket = ticketMap.get(order.id);
        // The ticket is a notification envelope, not the physical readiness
        // authority. Its READY_FOR_PICKUP state can exist after a partial
        // adjustment, so derive the operator-facing status from quantities.
        const status = quantitySummary.remainingQuantity === 0
          ? 'PICKED_UP'
          : quantitySummary.pickedUpQuantity > 0
            ? 'PARTIALLY_PICKED_UP'
            : quantitySummary.status;
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
          ...quantitySummary,
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
          productionContext,
        };

        if (filters.status !== 'all' && filters.status.toLowerCase() !== status.toLowerCase()) continue;
        rows.push(row);
        continue;
      }

      const shipStatus = quantitySummary.status;
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
        ...quantitySummary,
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
        productionContext,
      });
    }

    const compareText = (left: unknown, right: unknown) => String(left ?? '').localeCompare(String(right ?? ''), undefined, { numeric: true, sensitivity: 'base' });
    const statusRank = (status: string) => ({ WAITING_ON_PRODUCTION: 0, PARTIALLY_READY: 1, READY: 2, PARTIALLY_SHIPPED: 3, READY_FOR_PICKUP: 3, PARTIALLY_PICKED_UP: 4, SHIPPED: 5, PICKED_UP: 5 }[status] ?? 99);
    rows.sort((left, right) => {
      let result = 0;
      switch (filters.sortBy) {
        case 'orderNumber': result = compareText(left.orderNumber, right.orderNumber); break;
        case 'customer': result = compareText(left.customerName, right.customerName); break;
        case 'fulfillmentType': result = compareText(left.fulfillmentType, right.fulfillmentType); break;
        case 'status': result = statusRank(left.status) - statusRank(right.status); break;
        case 'readyQuantity': result = left.eligibleQuantity - right.eligibleQuantity; break;
        case 'destination': result = compareText(left.shipTo, right.shipTo); break;
        case 'dueDate': result = compareText((orderRows.find((order) => order.id === left.orderId)?.dueDate) || '', (orderRows.find((order) => order.id === right.orderId)?.dueDate) || ''); break;
        case 'createdAt': result = compareText((orderRows.find((order) => order.id === left.orderId)?.createdAt) || '', (orderRows.find((order) => order.id === right.orderId)?.createdAt) || ''); break;
      }
      if (result === 0) result = compareText(left.orderId, right.orderId);
      return filters.sortDirection === 'desc' ? -result : result;
    });
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
      sortBy: 'createdAt',
      sortDirection: 'asc',
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

  /** Read-only checklist lookup for workspace loading. Missing rows remain
   * unverified in the response and are materialized only by a workflow write. */
  async getChecklistItemsForOrder(orgId: string, orderId: string) {
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
    const checklistRows = await this.ensureChecklistItemsForOrder(orgId, orderId);
    const lines = (await this.listLineEligibility(orgId, { orderIds: [orderId] }))
      .filter((line) => line.projection.requiresFulfillment);
    const physicalLineIds = new Set(lines.map((line) => line.id));
    const summary = summarizeFulfillmentChecklist(checklistRows.filter((row) => physicalLineIds.has(row.lineItemId)));
    if (lines.length === 0 || lines.some((line) => line.projection.productionCompleteQuantity < line.projection.orderedQuantity)) {
      return {
        ok: false as const,
        code: 'PRODUCTION_NOT_COMPLETE',
        message: 'Every line item must be production-complete before terminal fulfillment.',
        summary,
      };
    }
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
    fulfilledQuantity?: number;
    notes?: string | null;
  }, actorUserId?: string | null) {
    const [lineItem] = await this.dbInstance
      .select({ id: orderLineItems.id, quantity: orderLineItems.quantity, workflowState: orderLineItems.workflowState, lifecycleStatus: orderLineItems.status })
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

    const [eligibility] = await this.listLineEligibility(orgId, { lineItemIds: [lineItemId] });
    if (!eligibility?.projection.requiresFulfillment) {
      return { ok: false as const, code: 'LINE_NOT_FULFILLABLE', message: 'This line item has no physical fulfillment responsibility.' };
    }
    const maxVerifiable = eligibility.projection.productionCompleteQuantity;
    const minimumVerified = eligibility.projection.fulfilledQuantity;
    const fulfilledQuantity = input.fulfilledQuantity ?? (input.checked ? maxVerifiable : minimumVerified);
    if (fulfilledQuantity > maxVerifiable) {
      return { ok: false as const, code: 'QTY_EXCEEDS_READY', message: 'Verified quantity exceeds the production-ready quantity for this line item.' };
    }
    if (fulfilledQuantity < minimumVerified) {
      return { ok: false as const, code: 'QTY_BELOW_SHIPPED', message: 'Verified quantity cannot be lower than the quantity already shipped.' };
    }
    if ((input.checked || fulfilledQuantity > minimumVerified) && eligibility.projection.eligibleQuantity <= 0) {
      return { ok: false as const, code: 'PRODUCTION_NOT_COMPLETE', message: 'This line item has no production-ready quantity available for verification.' };
    }

    await this.ensureChecklistItemsForOrder(orgId, orderId);

    const now = new Date();
    const safeActorUserId = await resolveExistingActorUserId(this.dbInstance, actorUserId);
    const [updated] = await this.dbInstance
      .update(fulfillmentChecklistItems)
      .set({
        checked: fulfilledQuantity >= Number(lineItem.quantity || 0) && fulfilledQuantity > 0,
        fulfilledQuantity,
        checkedByUserId: fulfilledQuantity > 0 ? safeActorUserId : null,
        checkedAt: fulfilledQuantity > 0 ? now : null,
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
    const [orderRow] = await this.dbInstance
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
        customerEmail: customers.email,
        customerPhone: customers.phone,
      })
      .from(orders)
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .where(and(eq(orders.organizationId, orgId), eq(orders.id, orderId)))
      .limit(1);
    if (!orderRow) return null;

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
        workflowState: orderLineItems.workflowState,
        lifecycleStatus: orderLineItems.status,
      })
      .from(orderLineItems)
      .innerJoin(products, eq(products.id, orderLineItems.productId))
      .leftJoin(materials, eq(materials.id, orderLineItems.materialId))
      .where(eq(orderLineItems.orderId, orderId));

    const lineItemIds = lineItems.map((item) => item.id);
    const lineEligibilityRows = await this.listLineEligibility(orgId, { lineItemIds });
    const eligibilityByLineItemId = new Map(lineEligibilityRows.map((line) => [line.id, line.projection]));
    const quantitySummary = summarizeFulfillmentOrderQuantities(lineEligibilityRows.map((line) => line.projection));
    const checklistRows = await this.getChecklistItemsForOrder(orgId, orderId);
    const checklistByLineItemId = new Map(checklistRows.map((item) => [item.lineItemId, item]));
    const artworkResolutions = lineItemIds.length > 0
      ? await lineItemArtworkReadResolver.resolveForLineItems({
        organizationId: orgId,
        lineItemIds,
        purpose: 'print_ticket',
      }, this.dbInstance)
      : new Map();

    const activeOwners = lineItemIds.length > 0
      ? await resolveActiveProductionOwners(this.dbInstance, { organizationId: orgId, lineItemIds, debugLabel: 'FulfillmentDashboardRepo.getFulfillmentDetail' })
      : new Map<string, any>();

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
    for (const [lineItemId, resolution] of Array.from(artworkResolutions.entries())) {
      for (const artwork of resolution.artwork) {
        const originalUrl = artwork.file.contentPath;
        pushArtwork(artworkByLineItemId, lineItemId, {
          id: artwork.relationshipId,
          fileRecordId: artwork.fileRecordId,
          fileName: artwork.file.originalFilename ?? artwork.relationshipId,
          fileUrl: originalUrl,
          originalUrl,
          downloadUrl: `${originalUrl}?download=1`,
          previewUrl: `${originalUrl}?variant=preview`,
          thumbUrl: `${originalUrl}?variant=thumbnail`,
          thumbnailUrl: `${originalUrl}?variant=thumbnail`,
          thumbKey: null,
          previewKey: null,
          objectPath: null,
          mimeType: artwork.file.mimeType,
          side: artwork.side,
          role: artwork.role,
          source: 'canonical',
        }, artworkSeen);
      }
    }

    const [pickupTicket] = await this.dbInstance
      .select()
      .from(pickupTickets)
      .where(and(eq(pickupTickets.organizationId, orgId), eq(pickupTickets.orderId, orderId)))
      .limit(1);

    const handoffRows = pickupTicket
      ? await this.dbInstance.select({
        id: pickupHandoffs.id,
        handedOffAt: pickupHandoffs.handedOffAt,
        handedOffByUserId: pickupHandoffs.handedOffByUserId,
        notes: pickupHandoffs.notes,
        actorFirstName: users.firstName,
        actorLastName: users.lastName,
      }).from(pickupHandoffs)
        .leftJoin(users, eq(users.id, pickupHandoffs.handedOffByUserId))
        .where(and(eq(pickupHandoffs.organizationId, orgId), eq(pickupHandoffs.pickupTicketId, pickupTicket.id), eq(pickupHandoffs.orderId, orderId)))
        .orderBy(desc(pickupHandoffs.handedOffAt))
      : [];
    const handoffIds = handoffRows.map((handoff) => handoff.id);
    const handoffItems = handoffIds.length
      ? await this.dbInstance.select({
        pickupHandoffId: pickupHandoffItems.pickupHandoffId,
        orderLineItemId: pickupHandoffItems.orderLineItemId,
        quantity: pickupHandoffItems.quantity,
        productName: products.name,
        description: orderLineItems.description,
      }).from(pickupHandoffItems)
        .innerJoin(orderLineItems, eq(orderLineItems.id, pickupHandoffItems.orderLineItemId))
        .leftJoin(products, eq(products.id, orderLineItems.productId))
        .where(and(eq(pickupHandoffItems.organizationId, orgId), eq(pickupHandoffItems.orderId, orderId), inArray(pickupHandoffItems.pickupHandoffId, handoffIds)))
      : [];
    const handoffItemsByHandoffId = new Map<string, typeof handoffItems>();
    for (const item of handoffItems) {
      const rows = handoffItemsByHandoffId.get(item.pickupHandoffId) ?? [];
      rows.push(item);
      handoffItemsByHandoffId.set(item.pickupHandoffId, rows);
    }

    const shipmentRows = await this.dbInstance
      .select({
        id: shipments.id,
        status: shipments.status,
        scope: shipments.scope,
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

    const uniqueShipmentRows = Array.from(new Map(shipmentRows.map((shipment) => [shipment.id, shipment])).values());
    const shipmentDetails = await Promise.all(uniqueShipmentRows.map((shipment) => new ShipmentRepo(this.dbInstance).getShipmentById(orgId, shipment.id)));

    const baseRow = buildFulfillmentWorkspaceQueueRow({
      order: orderRow,
      orderedQty: quantitySummary.orderedQuantity,
      shippedQty: quantitySummary.shippedQuantity,
      fulfilledQty: quantitySummary.fulfilledQuantity,
      pickedUpQty: quantitySummary.pickedUpQuantity,
      productionCompleteQty: quantitySummary.productionCompleteQuantity,
      eligibleQty: quantitySummary.eligibleQuantity,
      blockedQty: quantitySummary.blockedQuantity,
      readyWaitingQty: quantitySummary.readyWaitingQuantity,
      notReadyQty: quantitySummary.notReadyQuantity,
      physicalLineCount: quantitySummary.physicalLineCount,
      pickupTicket: pickupTicket ? { id: pickupTicket.id, status: pickupTicket.status } : null,
      shipmentId: uniqueShipmentRows[0]?.id ?? null,
      deriveShipStatus: (fulfillmentStatus, ordered, shipped) => this.deriveShipQueueStatus(fulfillmentStatus, ordered, shipped),
    });
    const detailIsPickup = orderRow.shippingMethod === 'pickup';
    const row: QueueRowDto = {
      ...baseRow,
      ...quantitySummary,
      status: detailIsPickup
        ? quantitySummary.remainingQuantity === 0
          ? 'PICKED_UP'
          : quantitySummary.pickedUpQuantity > 0
            ? 'PARTIALLY_PICKED_UP'
            : quantitySummary.status
        : quantitySummary.status,
      itemsRemaining: `${quantitySummary.remainingQuantity} item(s)`,
      readySince: quantitySummary.readyWaitingQuantity > 0 ? toIso(orderRow.updatedAt) : null,
    };

    const eventConditions = [
      and(eq(fulfillmentEvents.entityType, 'ORDER'), eq(fulfillmentEvents.entityId, orderId)),
    ] as any[];
    if (pickupTicket?.id) {
      eventConditions.push(and(eq(fulfillmentEvents.entityType, 'PICKUP_TICKET'), eq(fulfillmentEvents.entityId, pickupTicket.id)));
    }
    if (uniqueShipmentRows.length > 0) {
      eventConditions.push(and(eq(fulfillmentEvents.entityType, 'SHIPMENT'), inArray(fulfillmentEvents.entityId, uniqueShipmentRows.map((s) => s.id))));
    }

    const events = await this.dbInstance
      .select({
        id: fulfillmentEvents.id,
        entityType: fulfillmentEvents.entityType,
        entityId: fulfillmentEvents.entityId,
        eventType: fulfillmentEvents.eventType,
        actorUserId: fulfillmentEvents.actorUserId,
        actorFirstName: users.firstName,
        actorLastName: users.lastName,
        payloadJson: fulfillmentEvents.payloadJson,
        createdAt: fulfillmentEvents.createdAt,
      })
      .from(fulfillmentEvents)
      .leftJoin(users, eq(users.id, fulfillmentEvents.actorUserId))
      .where(and(eq(fulfillmentEvents.organizationId, orgId), or(...eventConditions)))
      .orderBy(desc(fulfillmentEvents.createdAt));

    // A line cannot count toward fulfillment verification merely because an
    // old production job completed. The same active-owner resolver powers
    // both this read model and the write gates.
    const eligibleChecklistSummary = summarizeFulfillmentChecklist(lineItems
      .filter((item) => (eligibilityByLineItemId.get(item.id)?.eligibleQuantity ?? 0) > 0)
      .map((item) => {
        const projection = eligibilityByLineItemId.get(item.id)!;
        return { checked: Number(checklistByLineItemId.get(item.id)?.fulfilledQuantity || 0) >= projection.productionCompleteQuantity };
      }));

    return {
      ...row,
      customer: {
        name: orderRow?.customerName || row.customerName,
        email: orderRow?.customerEmail ?? null,
        phone: orderRow?.customerPhone ?? null,
      },
      lineItems: lineItems.filter((item) => eligibilityByLineItemId.get(item.id)?.requiresFulfillment).map((item) => {
        const activeOwner = activeOwners.get(item.id);
        const readiness = eligibilityByLineItemId.get(item.id)!;
        const checklist = checklistByLineItemId.get(item.id);
        return ({
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
          jobId: activeOwner?.id ?? productionByLineItemId.get(item.id)?.id ?? null,
          stationKey: activeOwner?.stationKey ?? productionByLineItemId.get(item.id)?.stationKey ?? null,
          stationLabel: stationLabel(activeOwner?.stationKey ?? productionByLineItemId.get(item.id)?.stationKey),
          status: readiness.status,
          completedAt: readiness.productionCompleteQuantity >= readiness.orderedQuantity ? toIso(orderRow.productionCompletedAt) : null,
          eligible: readiness.eligibleQuantity > 0,
          label: readiness.label,
          productionRequired: readiness.productionRequired,
          orderedQuantity: readiness.orderedQuantity,
          productionCompleteQuantity: readiness.productionCompleteQuantity,
          fulfilledQuantity: readiness.fulfilledQuantity,
          eligibleQuantity: readiness.eligibleQuantity,
          blockedQuantity: readiness.blockedQuantity,
          shippedQuantity: readiness.shippedQuantity,
          pickedUpQuantity: readiness.pickedUpQuantity,
          readyWaitingQuantity: readiness.readyWaitingQuantity,
          notReadyQuantity: readiness.notReadyQuantity,
          remainingQuantity: readiness.remainingQuantity,
        },
        artwork: artworkByLineItemId.get(item.id) ?? [],
        checklist: {
          id: checklist?.id ?? '',
          checked: Number(checklist?.fulfilledQuantity || 0) >= readiness.productionCompleteQuantity && readiness.eligibleQuantity > 0,
          fulfilledQuantity: Number(checklist?.fulfilledQuantity || 0),
          checkedByUserId: checklist?.checkedByUserId ?? null,
          checkedAt: toIso(checklist?.checkedAt),
          notes: checklist?.notes ?? null,
        },
      }); }),
      checklistComplete: eligibleChecklistSummary.complete,
      checklistSummary: {
        total: eligibleChecklistSummary.total,
        checked: eligibleChecklistSummary.checked,
        unchecked: eligibleChecklistSummary.unchecked,
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
      pickupHandoffs: handoffRows.map((handoff) => ({
        id: handoff.id,
        handedOffAt: toIso(handoff.handedOffAt) || new Date().toISOString(),
        handedOffByUserId: handoff.handedOffByUserId ?? null,
        handedOffByName: [handoff.actorFirstName, handoff.actorLastName].filter(Boolean).join(' ') || null,
        notes: handoff.notes ?? null,
        items: (handoffItemsByHandoffId.get(handoff.id) ?? []).map((item) => ({
          orderLineItemId: item.orderLineItemId,
          quantity: Number(item.quantity),
          productName: item.productName ?? null,
          description: item.description ?? null,
        })),
      })),
      shipments: uniqueShipmentRows.map((shipment, index) => ({
        id: shipment.id,
        shipmentReference: shipmentDetails[index]?.shipmentReference ?? null,
        status: shipment.status,
        scope: shipment.scope as 'SINGLE_ORDER' | 'MULTI_ORDER',
        orderCount: shipmentDetails[index]?.orders.length ?? 1,
        carrier: shipment.carrier ?? null,
        serviceLevel: shipment.serviceLevel ?? null,
        trackingNumber: shipment.trackingNumber ?? null,
        shippedAt: toIso(shipment.shippedAt),
        updatedAt: toIso(shipment.updatedAt),
        packages: (shipmentDetails[index]?.packages ?? []).map((pkg) => ({
          id: pkg.id,
          ordinal: pkg.ordinal,
          packageReference: pkg.packageReference,
        })),
        allocations: (shipmentDetails[index]?.items ?? [])
          .filter((item) => item.orderId === orderId)
          .map((item) => ({ id: item.id, orderLineItemId: item.orderLineItemId, quantity: Number(item.quantity), packageId: item.packageId ?? null })),
      })),
      events: events.map((event) => ({
        id: event.id,
        entityType: event.entityType,
        entityId: event.entityId,
        eventType: event.eventType,
        actorUserId: event.actorUserId ?? null,
        actorName: [event.actorFirstName, event.actorLastName].filter(Boolean).join(' ') || null,
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

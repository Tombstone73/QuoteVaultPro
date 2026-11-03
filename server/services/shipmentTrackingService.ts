import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { shipments, shipmentPackages, shipmentItems, shipmentOrders, orders, upsLabelPurchases, upsPackageLabels,
  upsAccountConnections, shipmentTrackingStates as states, shipmentTrackingEvents as history } from '@shared/schema';
import { carrierTrackingStatuses, carrierTrackingUrl, trackingCarrier, type CarrierTrackingEvent, type ShipmentTrackingPackage, orderShippingProgressLabel, type OrderShipmentTrackingSummary } from '@shared/shipmentTracking';
import { isUpsPlaceholderTracking } from './ups/upsLabelEnvironment';
import { fetchUpsTracking } from './ups/upsTracking';
import { isWorkerEnabled } from '../workers/workerGates';

type Connection = typeof db;
const activeShipment = (status: string) => !['voided', 'cancelled', 'canceled'].includes(status.toLowerCase());
const iso = (value: Date | null) => value?.toISOString() ?? null;
const key = (carrier: string, number: string) => `${trackingCarrier(carrier) ?? carrier}:${number}`;

/** Internal read: callers must first establish tenant/customer access. Never makes carrier requests. */
export async function loadShipmentTrackingSources(organizationId: string, shipmentIds: string[], connection: Connection = db) {
  if (!shipmentIds.length) return [];
  const rows = await connection.select().from(shipments).where(and(eq(shipments.organizationId, organizationId), inArray(shipments.id, shipmentIds)));
  const [purchases, labels, packages, cached] = await Promise.all([
    connection.select({ id: upsLabelPurchases.id, shipmentId: upsLabelPurchases.shipmentId, status: upsLabelPurchases.status, environment: upsLabelPurchases.environment })
      .from(upsLabelPurchases).where(and(eq(upsLabelPurchases.organizationId, organizationId), inArray(upsLabelPurchases.shipmentId, shipmentIds))),
    connection.select({ purchaseId: upsPackageLabels.purchaseId, packageId: upsPackageLabels.packageId, trackingNumber: upsPackageLabels.trackingNumber })
      .from(upsPackageLabels).innerJoin(upsLabelPurchases, and(eq(upsLabelPurchases.id, upsPackageLabels.purchaseId), eq(upsLabelPurchases.organizationId, organizationId)))
      .where(and(eq(upsPackageLabels.organizationId, organizationId), inArray(upsLabelPurchases.shipmentId, shipmentIds))),
    connection.select({ id: shipmentPackages.id, shipmentId: shipmentPackages.shipmentId }).from(shipmentPackages)
      .where(and(eq(shipmentPackages.organizationId, organizationId), inArray(shipmentPackages.shipmentId, shipmentIds))),
    connection.select().from(states).where(and(eq(states.organizationId, organizationId), inArray(states.shipmentId, shipmentIds))),
  ]);
  return rows.map(row => {
    const ownedPurchases = purchases.filter(purchase => purchase.shipmentId === row.id);
    const live = new Set(ownedPurchases.filter(purchase => purchase.status === 'PURCHASED' && purchase.environment === 'live').map(purchase => purchase.id));
    const packageIds = new Set(packages.filter(pkg => pkg.shipmentId === row.id).map(pkg => pkg.id));
    const numbers = labels.filter(label => live.has(label.purchaseId) && label.packageId && packageIds.has(label.packageId) && !isUpsPlaceholderTracking(label.trackingNumber))
      .map(label => ({ packageId: label.packageId, carrier: 'UPS', number: label.trackingNumber }));
    // Never resurrect an old UPS label. A deliberate replacement using another carrier
    // remains usable after all UPS attempts are terminal, with a distinct tracking number.
    const manualReplacement = Boolean(row.carrier?.trim()) && trackingCarrier(row.carrier) !== 'UPS'
      && ownedPurchases.every(purchase => ['VOID_ACCEPTED','EXTERNAL_CANCEL_REPORTED','REJECTED','SAMPLE_RETIRED'].includes(purchase.status))
      && !labels.some(label => ownedPurchases.some(purchase => purchase.id === label.purchaseId) && label.trackingNumber === row.trackingNumber?.trim());
    if ((!ownedPurchases.length || manualReplacement) && row.trackingNumber?.trim()) numbers.push({ packageId: null, carrier: row.carrier ?? '', number: row.trackingNumber.trim() });
    const seen = new Set<string>();
    const trackingPackages: ShipmentTrackingPackage[] = numbers.filter(() => activeShipment(row.status)).filter(number => {
      const identity = key(number.carrier, number.number); if (seen.has(identity)) return false; seen.add(identity); return true;
    }).map(number => {
      const state = cached.find(state => state.shipmentId === row.id && key(state.carrier, state.trackingNumber) === key(number.carrier, number.number));
      return { shipmentId: row.id, packageId: number.packageId, serviceLevel: row.serviceLevel, carrier: trackingCarrier(number.carrier) ?? (number.carrier || null),
        trackingNumber: number.number, trackingUrl: carrierTrackingUrl(number.carrier, number.number), status: state?.status ?? 'unavailable',
        lastCarrierUpdateAt: iso(state?.lastEventAt ?? null), lastCheckedAt: iso(state?.lastCheckedAt ?? null),
        estimatedDeliveryDate: state?.estimatedDeliveryDate ?? null, deliveredAt: iso(state?.deliveredAt ?? null), updatesUnavailable: !state?.lastEventAt || Boolean(state.errorCode) };
    });
    return { ...row, trackingPackages };
  });
}

/** Batched portal projection; order IDs supplied by a client cannot grant access. */
async function loadOrderShipments(organizationId: string, orderIds: string[], connection: Connection, customerId?: string) {
  const result = new Map<string, Awaited<ReturnType<typeof loadShipmentTrackingSources>>>();
  if (!orderIds.length) return result;
  const linked = await connection.select({ shipmentId: shipments.id, orderId: orders.id }).from(shipments)
    .leftJoin(shipmentOrders, and(eq(shipmentOrders.shipmentId, shipments.id), eq(shipmentOrders.organizationId, organizationId)))
    .innerJoin(orders, and(eq(orders.organizationId, organizationId), ...(customerId === undefined ? [] : [eq(orders.customerId, customerId)]), inArray(orders.id, orderIds),
      or(eq(orders.id, shipments.orderId), eq(orders.id, shipments.primaryOrderId), eq(orders.id, shipmentOrders.orderId))))
    .where(eq(shipments.organizationId, organizationId));
  const ids = [...new Set(linked.map(row => row.shipmentId))];
  const source = await loadShipmentTrackingSources(organizationId, ids, connection);
  const items = ids.length ? await connection.select({ packageId: shipmentItems.packageId, orderId: shipmentItems.orderId }).from(shipmentItems)
    .where(and(eq(shipmentItems.organizationId, organizationId), inArray(shipmentItems.shipmentId, ids))) : [];
  for (const link of linked) {
    const shipment = source.find(row => row.id === link.shipmentId); if (!shipment) continue;
    const list = result.get(link.orderId) ?? []; if (list.some(row => row.id === shipment.id)) continue;
    // Combined shipments disclose only this Order's mapped packages.
    const trackingPackages = shipment.trackingPackages.filter(pkg => !pkg.packageId || shipment.scope !== 'MULTI_ORDER' ||
      items.some(item => item.packageId === pkg.packageId && item.orderId === link.orderId));
    list.push({ ...shipment, trackingPackages }); result.set(link.orderId, list);
  }
  return result;
}

/** Portal access always includes the canonical customer scope. */
export async function loadPortalShipments(organizationId: string, customerId: string, orderIds: string[], connection: Connection = db) {
  if (!customerId?.trim()) return new Map<string, Awaited<ReturnType<typeof loadShipmentTrackingSources>>>();
  return loadOrderShipments(organizationId, orderIds, connection, customerId);
}

/** One bounded set of batched reads for the visible page, with no provider calls or writes. */
export async function loadOrderTrackingSummaries(organizationId: string, orderIds: string[], connection: Connection = db): Promise<Map<string, OrderShipmentTrackingSummary>> {
  const result = new Map<string, OrderShipmentTrackingSummary>();
  if (!orderIds.length) return result;
  const owned = await connection.select({ id: orders.id, fulfillmentStatus: orders.fulfillmentStatus, shippingMethod: orders.shippingMethod, trackingNumber: orders.trackingNumber })
    .from(orders).where(and(eq(orders.organizationId, organizationId), inArray(orders.id, [...new Set(orderIds)])));
  const byOrder = await loadOrderShipments(organizationId, owned.map(order => order.id), connection);
  for (const order of owned) {
    const source = byOrder.get(order.id) ?? [];
    const active = source.filter(row => activeShipment(row.status));
    const trackingPackages = active.flatMap(row => row.trackingPackages);
    // Historical Order tracking is a fallback only when no shipment history exists.
    if (!source.length && order.trackingNumber?.trim()) trackingPackages.push({ shipmentId: null, packageId: null, carrier: null,
      trackingNumber: order.trackingNumber.trim(), trackingUrl: null, serviceLevel: null, status: 'unavailable',
      lastCarrierUpdateAt: null, lastCheckedAt: null, estimatedDeliveryDate: null, deliveredAt: null, updatesUnavailable: true });
    const statusLabel = order.shippingMethod === 'pickup'
      ? order.fulfillmentStatus === 'delivered' ? 'Picked up' : order.fulfillmentStatus === 'partially_picked_up' ? 'Partially picked up' : order.fulfillmentStatus === 'packed' ? 'Ready for pickup' : 'Pickup'
      : orderShippingProgressLabel(order.fulfillmentStatus, active.some(row => row.status.toLowerCase() === 'shipped'));
    result.set(order.id, { statusLabel, hasShipments: active.length > 0, trackingPackages });
  }
  return result;
}

export async function projectOrderShipmentTracking<T extends { id: string }>(organizationId: string, rows: T[]): Promise<Array<T & { shipmentTracking: OrderShipmentTrackingSummary | null }>> {
  const summaries = await loadOrderTrackingSummaries(organizationId, rows.map(row => row.id));
  return rows.map(row => ({ ...row, shipmentTracking: summaries.get(row.id) ?? null }));
}

const eventSchema = z.object({ status: z.enum(carrierTrackingStatuses), occurredAt: z.string().datetime({ offset: true }),
  description: z.string().max(500), estimatedDeliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() });
const eventKey = (event: CarrierTrackingEvent) => createHash('sha256').update(JSON.stringify([event.status, event.occurredAt, event.description, event.estimatedDeliveryDate ?? null])).digest('hex');

/** Trusted server adapter boundary only. No unauthenticated event-ingestion route exists. */
export async function recordCarrierEvents(organizationId: string, stateId: string, raw: CarrierTrackingEvent[], claimToken: string, connection: Connection = db) {
  const events = z.array(eventSchema).max(200).parse(raw).map(event => ({ ...event, occurredAt: new Date(event.occurredAt).toISOString() }));
  if (events.some(event => Date.parse(event.occurredAt) > Date.now() + 300_000)) throw new Error('Invalid future carrier event');
  return connection.transaction(async tx => {
    const [current] = await tx.select().from(states).where(and(eq(states.organizationId, organizationId), eq(states.id, stateId))).for('update');
    if (!current || current.claimToken !== claimToken || !current.claimUntil || current.claimUntil.getTime() <= Date.now()) return false;
    const sources = await loadShipmentTrackingSources(organizationId, [current.shipmentId], tx as unknown as Connection);
    if (!sources.some(source => source.trackingPackages.some(pkg => key(pkg.carrier ?? '', pkg.trackingNumber ?? '') === key(current.carrier, current.trackingNumber)))) return false;
    let status = current.status, lastEventAt = current.lastEventAt, deliveredAt = current.deliveredAt, estimatedDeliveryDate = current.estimatedDeliveryDate;
    for (const event of events.sort((a,b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))) {
      await tx.insert(history).values({ organizationId, trackingStateId: stateId, eventKey: eventKey(event), status: event.status,
        occurredAt: new Date(event.occurredAt), description: event.description, estimatedDeliveryDate: event.estimatedDeliveryDate ?? null }).onConflictDoNothing();
      if ((!lastEventAt || Date.parse(event.occurredAt) > lastEventAt.getTime()) && (status !== 'delivered' || event.status === 'delivered')) {
        status = event.status; lastEventAt = new Date(event.occurredAt);
        estimatedDeliveryDate = event.estimatedDeliveryDate ?? null;
        if (event.status === 'delivered') deliveredAt = lastEventAt;
      }
    }
    await tx.update(states).set({ status, lastEventAt, deliveredAt, estimatedDeliveryDate, attempts: 0, errorCode: null,
      lastCheckedAt: new Date(), nextCheckAt: new Date(Date.now() + 30 * 60_000), claimToken: null, claimUntil: null }).where(eq(states.id, stateId));
    return true;
  });
}

export async function seedShipmentTracking(organizationId: string, shipmentIds: string[], connection: Connection = db) {
  const sources = await loadShipmentTrackingSources(organizationId, shipmentIds, connection);
  for (const source of sources.filter(source => source.status.toUpperCase() === 'SHIPPED')) for (const pkg of source.trackingPackages) {
    if (pkg.carrier !== 'UPS' || !pkg.trackingNumber || isUpsPlaceholderTracking(pkg.trackingNumber) || !/^[a-zA-Z0-9]{7,34}$/.test(pkg.trackingNumber)) continue;
    await connection.insert(states).values({ organizationId, shipmentId: source.id, carrier: 'UPS', trackingNumber: pkg.trackingNumber }).onConflictDoNothing();
  }
}

export async function pollShipmentTracking(organizationId: string, stateId: string, fetchEvents = fetchUpsTracking, connection: Connection = db) {
  const claimed = await connection.transaction(async tx => {
    const [row] = await tx.select().from(states).where(and(eq(states.organizationId, organizationId), eq(states.id, stateId),
      sql`${states.nextCheckAt} <= now()`, sql`(${states.claimUntil} is null or ${states.claimUntil} < now())`, sql`${states.status} <> 'delivered'`)).for('update', { skipLocked: true });
    if (!row || row.carrier !== 'UPS') return null;
    const sources = await loadShipmentTrackingSources(organizationId, [row.shipmentId], tx as unknown as Connection);
    if (!sources.some(source => source.status.toUpperCase() === 'SHIPPED' && (source.shippedAt ?? source.createdAt).getTime() > Date.now() - 90 * 24 * 60 * 60_000 && source.trackingPackages.some(pkg => pkg.carrier === row.carrier && pkg.trackingNumber === row.trackingNumber))) {
      await tx.update(states).set({ nextCheckAt: new Date('9999-01-01'), errorCode: 'TRACKING_IDENTITY_CHANGED', claimToken: null, claimUntil: null }).where(eq(states.id, row.id)); return null;
    }
    const claimToken = randomUUID();
    await tx.update(states).set({ claimToken, claimUntil: new Date(Date.now() + 60_000) }).where(eq(states.id, row.id));
    return { ...row, claimToken };
  });
  if (!claimed) return false;
  try {
    const events = await fetchEvents(organizationId, claimed.trackingNumber);
    if (!events.length) throw new Error('No supported dated carrier events');
    return await recordCarrierEvents(organizationId, stateId, events, claimed.claimToken, connection);
  } catch {
    // Retain last confirmed observation; failures never manufacture shipment status or delivery estimates.
    await connection.update(states).set({ attempts: claimed.attempts + 1, errorCode: 'CARRIER_UPDATES_UNAVAILABLE', lastCheckedAt: new Date(),
      nextCheckAt: new Date(Date.now() + Math.min(24 * 60, 30 * 2 ** Math.min(claimed.attempts, 6)) * 60_000), claimToken: null, claimUntil: null })
      .where(and(eq(states.organizationId, organizationId), eq(states.id, stateId), eq(states.claimToken, claimed.claimToken)));
    return false;
  }
}

/** Explicit opt-in + existing global gate. Reads never start workers or carrier API calls. */
export async function runShipmentTrackingTick() {
  if (!isWorkerEnabled('SHIPMENT_TRACKING', false)) return;
  const organizations = [...new Set((process.env.SHIPMENT_TRACKING_ORGANIZATION_IDS ?? '').split(',').map(id => id.trim()).filter(Boolean))].slice(0, 20);
  if (!organizations.length) return;
  const connected = await db.select({ organizationId: upsAccountConnections.organizationId }).from(upsAccountConnections)
    .where(and(inArray(upsAccountConnections.organizationId, organizations), eq(upsAccountConnections.status, 'connected'), eq(upsAccountConnections.mode, 'live')));
  for (const org of connected) {
    const recent = await db.select({ id: shipments.id }).from(shipments).where(and(eq(shipments.organizationId, org.organizationId),
      eq(shipments.status, 'SHIPPED'), eq(shipments.carrier, 'UPS'), sql`coalesce(${shipments.shippedAt},${shipments.createdAt}) > now() - interval '90 days'`))
      .orderBy(sql`not exists (select 1 from shipment_tracking_states tracked where tracked.organization_id = ${org.organizationId} and tracked.shipment_id = ${shipments.id}) desc`, asc(shipments.createdAt)).limit(100);
    await seedShipmentTracking(org.organizationId, recent.map(row => row.id));
    const due = await db.select({ id: states.id }).from(states).where(and(eq(states.organizationId, org.organizationId),
      sql`${states.nextCheckAt} <= now()`, sql`${states.status} <> 'delivered'`, sql`(${states.claimUntil} is null or ${states.claimUntil} < now())`)).orderBy(asc(states.nextCheckAt)).limit(10);
    for (const state of due) {
      if (!isWorkerEnabled('SHIPMENT_TRACKING', false)) return;
      await pollShipmentTracking(org.organizationId, state.id);
    }
  }
}

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db';
import { fulfillmentEvents, shipments, shipmentOrders, shipmentPackages, shipmentItems, shipmentTrackingStates, shipmentTrackingEvents, upsLabelPurchases, upsPackageLabels } from '@shared/schema';
import { trackingCarrier } from '@shared/shipmentTracking';
import { readFulfillmentDelivery } from './deliveryReadModel';
import { FulfillmentHttpError } from './types';

type Reader = Pick<typeof db, 'select'>;
type RepackItem = { orderLineItemId: string; quantity: number };
export type RepackLink = { originalShipmentId: string; replacementShipmentId: string; items: RepackItem[] };

export const repackSourceSql = sql<string | null>`(
  select correction.entity_id from fulfillment_events correction
  where correction.organization_id = shipments.organization_id and correction.entity_type = 'SHIPMENT'
    and correction.event_type = 'SHIPMENT_REVERSED' and correction.payload_json->>'replacementShipmentId' = shipments.id
  limit 1
)`;

export async function hasActiveRepackDraft(runner: Reader, orgId: string, orderId: string) {
  const [draft] = await runner.select({ id: shipments.id }).from(shipmentOrders)
    .innerJoin(shipments, eq(shipments.id, shipmentOrders.shipmentId)).where(and(
      eq(shipmentOrders.organizationId, orgId), eq(shipments.organizationId, orgId), eq(shipmentOrders.orderId, orderId),
      eq(shipments.status, 'DRAFT'), sql`${repackSourceSql} is not null`,
    )).limit(1);
  return Boolean(draft);
}

export async function readRepackLink(runner: Reader, orgId: string, shipmentId: string): Promise<RepackLink | null> {
  const [event] = await runner.select({ payload: fulfillmentEvents.payloadJson }).from(fulfillmentEvents).where(and(
    eq(fulfillmentEvents.organizationId, orgId), eq(fulfillmentEvents.entityType, 'SHIPMENT'),
    eq(fulfillmentEvents.eventType, 'SHIPMENT_REVERSED'),
    sql`${fulfillmentEvents.payloadJson}->>'replacementShipmentId' is not null`,
    sql`(${fulfillmentEvents.entityId} = ${shipmentId} or ${fulfillmentEvents.payloadJson}->>'replacementShipmentId' = ${shipmentId})`,
  )).orderBy(sql`(${fulfillmentEvents.entityId} = ${shipmentId}) desc`).limit(1);
  if (!event) return null;
  return { originalShipmentId: event.payload.sourceId, replacementShipmentId: event.payload.replacementShipmentId, items: event.payload.items };
}

export function sumRepackItems(items: RepackItem[]) {
  const totals = new Map<string, number>();
  for (const item of items) totals.set(item.orderLineItemId, (totals.get(item.orderLineItemId) ?? 0) + item.quantity);
  return totals;
}

export async function assertRepackAllocations(runner: Reader, orgId: string, originalId: string, items: RepackItem[], requireExact: boolean) {
  const original = await runner.select({ orderLineItemId: shipmentItems.orderLineItemId, quantity: shipmentItems.quantity })
    .from(shipmentItems).where(and(eq(shipmentItems.organizationId, orgId), eq(shipmentItems.shipmentId, originalId)));
  const limits = sumRepackItems(original);
  const requested = sumRepackItems(items);
  if (!limits.size || [...requested].some(([id, quantity]) => quantity > (limits.get(id) ?? 0)) ||
    (requireExact && [...limits].some(([id, quantity]) => requested.get(id) !== quantity))) {
    throw new FulfillmentHttpError(409, 'Allocate exactly the quantities from the original shipment across the replacement boxes before buying labels or shipping.', 'REPACK_ALLOCATION_MISMATCH');
  }
}

const reject = (message: string, code: string): never => { throw new FulfillmentHttpError(409, message, code); };
const physicalStatuses = ['in_transit', 'out_for_delivery', 'delivered', 'exception'];

/** Read exact historical label identities even though voided labels no longer
 * appear in the active tracking projection. The write path repeats these reads. */
export async function readRepackEvidence(runner: Reader, orgId: string, shipmentId: string, lockTracking = false) {
  const [shipment] = await runner.select().from(shipments).where(and(eq(shipments.organizationId, orgId), eq(shipments.id, shipmentId))).limit(1);
  if (!shipment) throw new FulfillmentHttpError(404, 'Shipment not found.', 'NOT_FOUND');
  if (shipment.status !== 'SHIPPED') reject('Only a shipped record can be reopened for shipping.', 'INVALID_STATE');
  if (shipment.deliveredAt) reject('This shipment has delivery evidence. Review shipment history.', 'CARRIER_ALREADY_ACCEPTED');
  if (shipment.carrierLastStatus && !['label_created', 'awaiting_package'].includes(shipment.carrierLastStatus.toLowerCase())) {
    reject('Review the recorded carrier status before reopening this shipment.', 'CARRIER_ALREADY_ACCEPTED');
  }
  const oldReversal = await runner.select({ id: fulfillmentEvents.id }).from(fulfillmentEvents).where(and(
    eq(fulfillmentEvents.organizationId, orgId), eq(fulfillmentEvents.entityId, shipmentId),
    eq(fulfillmentEvents.entityType, 'SHIPMENT'), eq(fulfillmentEvents.eventType, 'SHIPMENT_REVERSED'),
  )).limit(1);
  if (oldReversal.length) reject('A quantity reversal already exists for this shipment. Review the original correction in Fulfillment history.', 'REPACK_PRIOR_REVERSAL');
  if (trackingCarrier(shipment.carrier) !== 'UPS') reject('Carrier acceptance and label cancellation cannot be verified for this shipment in Printers Hero.', 'CARRIER_VERIFICATION_UNAVAILABLE');

  const purchases = await runner.select().from(upsLabelPurchases).where(and(eq(upsLabelPurchases.organizationId, orgId), eq(upsLabelPurchases.shipmentId, shipmentId)));
  if (purchases.some(purchase => !['VOID_ACCEPTED', 'EXTERNAL_CANCEL_REPORTED', 'REJECTED', 'SAMPLE_RETIRED'].includes(purchase.status))) {
    reject('Void active UPS labels and resolve pending label operations before reopening for shipping.', 'REPACK_LABELS_ACTIVE');
  }
  const original = purchases.filter(purchase => purchase.providerShipmentId && purchase.providerShipmentId === shipment.carrierShipmentId && purchase.environment === 'live');
  if (original.length !== 1) reject('The original live UPS purchase could not be identified. Review UPS label history before reopening.', 'REPACK_LABEL_EVIDENCE_MISSING');
  const purchase = original[0];
  const [labels, packages, items] = await Promise.all([
    runner.select().from(upsPackageLabels).where(and(eq(upsPackageLabels.organizationId, orgId), eq(upsPackageLabels.purchaseId, purchase.id))),
    runner.select().from(shipmentPackages).where(and(eq(shipmentPackages.organizationId, orgId), eq(shipmentPackages.shipmentId, shipmentId))).orderBy(shipmentPackages.ordinal),
    runner.select().from(shipmentItems).where(and(eq(shipmentItems.organizationId, orgId), eq(shipmentItems.shipmentId, shipmentId))),
  ]);
  const packageIds = new Set(packages.map(pkg => pkg.id));
  const numbers = labels.map(label => label.trackingNumber).sort();
  if (!items.length || !packages.length || items.some(item => !item.packageId || !packageIds.has(item.packageId) || item.quantity <= 0) ||
    labels.length !== packages.length || new Set(labels.map(label => label.packageId)).size !== packages.length ||
    labels.some(label => !label.packageId || !packageIds.has(label.packageId)) || new Set(numbers).size !== numbers.length ||
    !shipment.trackingNumber || !numbers.includes(shipment.trackingNumber)) {
    reject('The original packages, allocations, and tracking numbers do not reconcile. Review the shipment and label history.', 'REPACK_LABEL_EVIDENCE_MISSING');
  }
  if (purchase.status === 'EXTERNAL_CANCEL_REPORTED') {
    const [confirmed] = await runner.select({ payload: fulfillmentEvents.payloadJson }).from(fulfillmentEvents).where(and(
      eq(fulfillmentEvents.organizationId, orgId), eq(fulfillmentEvents.entityId, shipmentId), eq(fulfillmentEvents.entityType, 'SHIPMENT'),
      sql`${fulfillmentEvents.payloadJson}->>'action' = 'ups_external_cancellation_reported'`,
      sql`${fulfillmentEvents.payloadJson}->>'purchaseId' = ${purchase.id}`,
    )).limit(1);
    const confirmedNumbers = confirmed?.payload.confirmedTrackingNumbers;
    if (!purchase.externalCancelReference || !Array.isArray(confirmedNumbers) ||
      confirmedNumbers.length !== numbers.length || !numbers.every(number => confirmedNumbers.includes(number))) {
      reject('A UPS confirmation reference and cancellation for every tracking number are required. Review the external cancellation evidence.', 'REPACK_LABEL_EVIDENCE_MISSING');
    }
  } else if (purchase.status !== 'VOID_ACCEPTED' || !purchase.voidAcceptedAt) {
    reject('UPS cancellation of the original labels must be confirmed first.', 'REPACK_LABELS_ACTIVE');
  }

  const trackingQuery = runner.select().from(shipmentTrackingStates).where(and(
    eq(shipmentTrackingStates.organizationId, orgId), eq(shipmentTrackingStates.shipmentId, shipmentId),
  )).orderBy(shipmentTrackingStates.id);
  const tracking = lockTracking ? await trackingQuery.for('update') : await trackingQuery;
  if (tracking.some(row => row.claimUntil && row.claimUntil.getTime() > Date.now())) {
    reject('A carrier tracking check is in progress. Wait for it to finish, then retry.', 'REPACK_TRACKING_IN_PROGRESS');
  }
  if (tracking.some(row => row.deliveredAt || physicalStatuses.includes(row.status))) {
    reject('Carrier history shows acceptance, delivery, or a carrier exception. Review tracking before reopening.', 'CARRIER_ALREADY_ACCEPTED');
  }
  const stateIds = tracking.map(row => row.id);
  const [history] = stateIds.length ? await runner.select({ id: shipmentTrackingEvents.id }).from(shipmentTrackingEvents).where(and(
    eq(shipmentTrackingEvents.organizationId, orgId), inArray(shipmentTrackingEvents.trackingStateId, stateIds),
    inArray(shipmentTrackingEvents.status, ['in_transit', 'out_for_delivery', 'delivered', 'exception']),
  )).limit(1) : [];
  const delivery = await readFulfillmentDelivery(orgId, [...new Set(items.map(item => item.orderId))], runner);
  if (history || delivery.some(row => row.shipmentId === shipmentId && row.deliveredQuantity > 0)) {
    reject('This shipment has carrier or staff delivery evidence. Review the shipment history.', 'CARRIER_ALREADY_ACCEPTED');
  }
  return { shipment, items, packages, purchaseId: purchase.id, numbers };
}

export async function verifyRepackCarrier(orgId: string, evidence: Awaited<ReturnType<typeof readRepackEvidence>>) {
  const { verifyUpsPackageNotAccepted } = await import('../ups/upsTracking');
  // Bounded concurrency. A provider failure leaves the original record intact.
  for (let index = 0; index < evidence.numbers.length; index += 5) {
    const results = await Promise.all(evidence.numbers.slice(index, index + 5).map(number =>
      verifyUpsPackageNotAccepted(orgId, number).catch(() => 'unverified')));
    if (results.includes('accepted')) reject('UPS shows that at least one package entered the carrier network. The shipment cannot be reopened for repacking.', 'CARRIER_ALREADY_ACCEPTED');
    if (results.some(result => result !== 'not_accepted')) reject('UPS could not verify that every package stayed with the shop. Review the tracking numbers with UPS and retry when verification is available.', 'CARRIER_VERIFICATION_UNAVAILABLE');
  }
  return { purchaseId: evidence.purchaseId, numbers: evidence.numbers, verifiedAt: new Date() };
}

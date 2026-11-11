import { and, eq, inArray, sql } from 'drizzle-orm';
import { fulfillmentEvents, shipmentPackages, upsLabelPurchases, upsPackageLabels } from '@shared/schema';
import { normalizeTrackingNumber, trackingCarriers, validManualTrackingNumber, type ManualPackageTracking } from '@shared/shipmentTracking';
import type { db } from '../../db';
import { FulfillmentHttpError } from './types';

type Executor = Pick<typeof db, 'select' | 'execute' | 'update' | 'insert'>;
type Identity = { carrier: string; trackingNumber: string };
const identityKey = (entry: Identity) => `${entry.carrier}:${normalizeTrackingNumber(entry.trackingNumber)}`;

/** Manual entry and live UPS persistence take the same tenant/number locks. */
export async function assertUnusedPackageTracking(tx: Executor, orgId: string, entries: Identity[], editedPackageIds: string[] = []) {
  if (!entries.length) return;
  const keys = new Set(entries.map(identityKey));
  const duplicate = () => new FulfillmentHttpError(409, 'A tracking number is already assigned to another package or belongs to a recorded UPS label. Use the tracking number for this box.', 'DUPLICATE_PACKAGE_TRACKING');
  if (keys.size !== entries.length) throw duplicate();
  for (const key of [...keys].sort()) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`package-tracking:${orgId}:${key}`}))`);
  const numbers = [...new Set(entries.map(entry => normalizeTrackingNumber(entry.trackingNumber)))];
  const existing = await tx.select({ id: shipmentPackages.id, carrier: shipmentPackages.manualTrackingCarrier, number: shipmentPackages.manualTrackingNumber })
    .from(shipmentPackages).where(and(eq(shipmentPackages.organizationId, orgId), inArray(shipmentPackages.manualTrackingNumber, numbers)));
  if (existing.some(row => !editedPackageIds.includes(row.id) && keys.has(`${row.carrier}:${row.number}`))) throw duplicate();
  const upsNumbers = entries.filter(entry => entry.carrier === 'UPS').map(entry => normalizeTrackingNumber(entry.trackingNumber));
  if (!upsNumbers.length) return;
  const [label] = await tx.select({ id: upsPackageLabels.id }).from(upsPackageLabels).innerJoin(upsLabelPurchases, and(
    eq(upsLabelPurchases.id, upsPackageLabels.purchaseId), eq(upsLabelPurchases.organizationId, orgId),
  )).where(and(eq(upsPackageLabels.organizationId, orgId), eq(upsLabelPurchases.environment, 'live'),
    inArray(sql<string>`upper(${upsPackageLabels.trackingNumber})`, upsNumbers),
  )).limit(1);
  if (label) throw duplicate();
}

/** Called from the existing draft-save transaction with the shipment locked. */
export async function patchPackageTracking(tx: Executor, orgId: string, shipmentId: string, entries: ManualPackageTracking[], actorUserId: string | null) {
  const saved = await tx.select().from(shipmentPackages).where(and(eq(shipmentPackages.organizationId, orgId), eq(shipmentPackages.shipmentId, shipmentId)));
  const byId = new Map(saved.map(pkg => [pkg.id, pkg]));
  if (!entries.length || new Set(entries.map(entry => entry.packageId)).size !== entries.length || entries.some(entry => !byId.has(entry.packageId))) {
    throw new FulfillmentHttpError(409, 'A tracking entry does not belong to a saved box in this shipment. Reload the draft.', 'INVALID_PACKAGE');
  }
  const [purchase] = await tx.select({ id: upsLabelPurchases.id }).from(upsLabelPurchases).where(and(
    eq(upsLabelPurchases.organizationId, orgId), eq(upsLabelPurchases.shipmentId, shipmentId), eq(upsLabelPurchases.status, 'PURCHASED'),
  )).limit(1);
  const updates = entries.map(entry => {
    const pkg = byId.get(entry.packageId)!;
    const number = entry.trackingNumber === null ? null : normalizeTrackingNumber(entry.trackingNumber);
    if ((entry.carrier === null) !== (number === null) || (number !== null && (!validManualTrackingNumber(number) || !trackingCarriers.includes(entry.carrier!)))) {
      throw new FulfillmentHttpError(400, 'Choose a supported carrier and enter a valid tracking number for each box, or clear both fields.', 'INVALID_PACKAGE_TRACKING');
    }
    return { packageId: pkg.id, before: { carrier: pkg.manualTrackingCarrier, trackingNumber: pkg.manualTrackingNumber },
      after: { carrier: entry.carrier, trackingNumber: number } };
  }).filter(row => row.before.carrier !== row.after.carrier || row.before.trackingNumber !== row.after.trackingNumber);
  if (purchase && updates.some(row => !row.before.trackingNumber || !row.after.trackingNumber)) {
    throw new FulfillmentHttpError(409, 'The purchased UPS box set is locked. You can correct an existing external number. Void the purchased labels before changing which boxes need labels.', 'UPS_LABEL_LOCKED');
  }
  if (!updates.length) return;
  await assertUnusedPackageTracking(tx, orgId, updates.flatMap(row => row.after.carrier && row.after.trackingNumber
    ? [{ carrier: row.after.carrier, trackingNumber: row.after.trackingNumber }] : []), updates.map(row => row.packageId));
  const where = (packageId: string) => and(eq(shipmentPackages.organizationId, orgId), eq(shipmentPackages.shipmentId, shipmentId), eq(shipmentPackages.id, packageId));
  // Release edited identities first so two boxes can exchange numbers atomically.
  await tx.update(shipmentPackages).set({ manualTrackingCarrier: null, manualTrackingNumber: null })
    .where(and(eq(shipmentPackages.organizationId, orgId), eq(shipmentPackages.shipmentId, shipmentId), inArray(shipmentPackages.id, updates.map(row => row.packageId))));
  for (const row of updates) await tx.update(shipmentPackages).set({ manualTrackingCarrier: row.after.carrier,
    manualTrackingNumber: row.after.trackingNumber, updatedAt: new Date() }).where(where(row.packageId));
  await tx.insert(fulfillmentEvents).values({ organizationId: orgId, actorUserId, entityType: 'SHIPMENT', entityId: shipmentId,
    eventType: 'SHIPMENT_UPDATED', payloadJson: { action: 'manual_package_tracking_changed', packages: updates } });
}

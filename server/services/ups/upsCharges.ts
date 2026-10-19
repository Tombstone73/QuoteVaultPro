import { and, eq } from 'drizzle-orm';
import { orders, shipmentOrders, upsShipmentRateQuotes } from '@shared/schema';
import { db } from '../../db';
import { canonicalOrderOperations } from '../orders/canonicalOrderOperations';
import { FulfillmentHttpError } from '../fulfillment/types';
import { upsRateCredentials } from './upsConnection';
import { resolveUpsShippingContext, upsShippingFingerprint } from './upsRates';

const rateCents = (amount: string): number | null => {
  const cents = Math.round(Number(amount) * 100);
  return /^\d+(?:\.\d{1,2})?$/.test(amount) && Number.isSafeInteger(cents) && cents <= 2_147_483_647 ? cents : null;
};

export async function getUpsCustomerCharges(organizationId: string, shipmentId: string) {
  return db.select({ orderId: orders.id, orderNumber: orders.displayNumber,
    shippingCents: orders.shippingCents, shippingChargeDecision: orders.shippingChargeDecision,
    shippingChargeRateQuoteId: orders.shippingChargeRateQuoteId,
    shippingChargeRateServiceCode: orders.shippingChargeRateServiceCode, updatedAt: orders.updatedAt })
    .from(shipmentOrders).innerJoin(orders, and(eq(orders.id, shipmentOrders.orderId),
      eq(orders.organizationId, organizationId)))
    .where(and(eq(shipmentOrders.organizationId, organizationId), eq(shipmentOrders.shipmentId, shipmentId)));
}

/** Changes only the single linked Order. Combined shipments require an explicit allocation policy. */
export async function applyUpsRateToCustomerCharge(input: { organizationId: string; shipmentId: string;
  quoteId: string; serviceCode: string; intent: 'default_if_unset' | 'use_ups_rate'; actorUserId: string; actorOrgRole?: string | null }) {
  const charges = await getUpsCustomerCharges(input.organizationId, input.shipmentId);
  if (charges.length !== 1) throw new FulfillmentHttpError(409,
    'This combined shipment has multiple Orders. Set each customer shipping charge through its Order; the full UPS rate cannot be applied to every Order.', 'UPS_COMBINED_CHARGE_ALLOCATION_REQUIRED');
  const order = charges[0];
  if (input.intent === 'default_if_unset' && order.shippingChargeDecision !== 'unset')
    return { applied: false, reason: 'An existing customer shipping decision was preserved.', order };
  const details = await resolveUpsShippingContext(input.organizationId, input.shipmentId);
  const credentials = await upsRateCredentials(input.organizationId);
  const fingerprint = upsShippingFingerprint({ origin: details.origin, sender: details.sender,
    destination: details.destination, accountNumber: credentials.accountNumber, packages: details.packages });
  const [quote] = await db.select().from(upsShipmentRateQuotes).where(and(eq(upsShipmentRateQuotes.organizationId, input.organizationId),
    eq(upsShipmentRateQuotes.shipmentId, input.shipmentId), eq(upsShipmentRateQuotes.id, input.quoteId))).limit(1);
  const rate = quote?.rates.find(item => item.serviceCode === input.serviceCode);
  if (!quote || quote.environment !== credentials.row.mode || !rate || quote.expiresAt.getTime() <= Date.now() || quote.requestFingerprint !== fingerprint)
    throw new FulfillmentHttpError(409, 'UPS rate is stale. Get fresh rates before changing the customer charge.', 'UPS_RATE_STALE');
  const cents = rateCents(rate.total);
  if (cents == null || rate.currency !== 'USD') throw new FulfillmentHttpError(409,
    'The selected UPS rate cannot be applied to the USD Order charge. Review it manually.', 'UPS_CHARGE_CURRENCY_REVIEW');
  if (order.shippingCents === cents && order.shippingChargeDecision === 'ups_rate' &&
    order.shippingChargeRateQuoteId === input.quoteId && order.shippingChargeRateServiceCode === input.serviceCode)
    return { applied: false, reason: 'This UPS rate is already the customer shipping charge.', order };
  const updated = await canonicalOrderOperations.updateEditableHeader({ organizationId: input.organizationId,
    actorUserId: input.actorUserId, actorOrgRole: input.actorOrgRole, orderId: order.orderId,
    expectedUpdatedAt: order.updatedAt, allowNonNew: true, requireInvoiceParity: true,
    changes: { shippingCents: cents, shippingChargeDecision: 'ups_rate',
      shippingChargeRateQuoteId: input.quoteId, shippingChargeRateServiceCode: input.serviceCode },
    auditDescription: `Set customer shipping charge from selected UPS ${rate.serviceName} rate.` });
  return { applied: true, reason: 'Customer shipping charge and linked Invoice synchronized.', order: updated };
}

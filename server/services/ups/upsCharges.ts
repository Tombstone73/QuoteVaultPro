import { and, eq, inArray } from 'drizzle-orm';
import { auditLogs, companySettings, invoices, orders, shipmentOrders, shipments, upsShipmentRateQuotes } from '@shared/schema';
import { ORDER_SHIPPING_INVOICE_MILESTONE } from '@shared/billingInvoicePolicy';
import { effectiveOrderFulfillmentMethod } from '@shared/orderFulfillmentMethod';
import { isCanceledOrder } from '@shared/operationalState';
import { upsCustomerChargeCents } from '@shared/upsCustomerCharge';
import { db } from '../../db';
import { createInvoiceFromOrderInTransaction, lockInvoiceOrderCreation } from '../../invoicesService';
import { OrdersRepository } from '../../storage/orders.repo';
import { recalculateEditableOrderFinancialsInTransaction } from '../orders/orderTaxCalculationService';
import { readRepackLink } from '../fulfillment/shipmentRepackEvidence';
import { FulfillmentHttpError } from '../fulfillment/types';
import { upsRateCredentials } from './upsConnection';
import { resolveUpsShippingContext, selectedUpsQuoteRate, upsShippingFingerprint } from './upsRates';

export async function getUpsCustomerCharges(organizationId: string, shipmentId: string) {
  const charges = await db.select({ orderId: orders.id, orderNumber: orders.displayNumber,
    shippingCents: orders.shippingCents, shippingChargeDecision: orders.shippingChargeDecision,
    shippingChargeRateQuoteId: orders.shippingChargeRateQuoteId,
    shippingChargeRateServiceCode: orders.shippingChargeRateServiceCode,
    shippingChargeRateOptionId: orders.shippingChargeRateOptionId, updatedAt: orders.updatedAt })
    .from(shipmentOrders).innerJoin(orders, and(eq(orders.id, shipmentOrders.orderId),
      eq(orders.organizationId, organizationId)))
    .where(and(eq(shipmentOrders.organizationId, organizationId), eq(shipmentOrders.shipmentId, shipmentId)));
  if (!charges.length) return [];
  const linked = await db.select({ id: invoices.id, orderId: invoices.orderId, invoiceNumber: invoices.invoiceNumber,
    displayNumber: invoices.displayNumber, status: invoices.status, billingMilestone: invoices.billingMilestone,
    shippingCents: invoices.shippingCents }).from(invoices).where(and(eq(invoices.organizationId, organizationId),
    inArray(invoices.orderId, charges.map(row => row.orderId))));
  return charges.map(order => {
    const orderInvoices = linked.filter(invoice => invoice.orderId === order.orderId);
    const active = orderInvoices.filter(invoice => invoice.status !== 'void');
    const charged = active.filter(invoice => invoice.shippingCents > 0);
    const billedInvoice = charged.length === 1 ? charged[0] : null;
    const billingStatus = charged.length > 1 || (billedInvoice && billedInvoice.shippingCents !== order.shippingCents) ||
      (!billedInvoice && (active.length > 1 || orderInvoices.some(invoice => invoice.billingMilestone === ORDER_SHIPPING_INVOICE_MILESTONE)))
      ? 'review' : billedInvoice ? 'invoiced' : order.shippingChargeDecision === 'free' && order.shippingCents === 0
        ? 'no_charge' : 'pending';
    return { ...order, billingStatus, billedInvoice };
  });
}

type CustomerCharge = {
  shippingCents: number;
  shippingChargeDecision: 'manual' | 'free' | 'ups_rate';
  shippingChargeRateQuoteId: string | null;
  shippingChargeRateServiceCode: string | null;
  shippingChargeRateOptionId: string | null;
};

export function manualCustomerShippingCharge(shippingCents: number): CustomerCharge {
  return { shippingCents, shippingChargeDecision: shippingCents === 0 ? 'free' : 'manual',
    shippingChargeRateQuoteId: null, shippingChargeRateServiceCode: null, shippingChargeRateOptionId: null };
}

export function customerShippingChargeFromUpsRate(quoteId: string, rate: {
  currency: string; total: string; serviceCode: string; optionId: string;
}, handlingFeeCents = 0): CustomerCharge {
  const cents = upsCustomerChargeCents(rate, handlingFeeCents);
  if (cents == null) throw new FulfillmentHttpError(409,
    'The selected UPS rate and handling fee do not produce a valid USD Order charge. Review the charge manually.', 'UPS_CHARGE_CURRENCY_REVIEW');
  return { shippingCents: cents, shippingChargeDecision: cents ? 'ups_rate' : 'free',
    shippingChargeRateQuoteId: quoteId, shippingChargeRateServiceCode: rate.serviceCode, shippingChargeRateOptionId: rate.optionId };
}

export function assertExpectedUpsCustomerCharge(expectedCents: number | undefined, chargeCents: number, handlingFeeCents: number) {
  if (expectedCents === undefined ? handlingFeeCents !== 0 : chargeCents !== expectedCents) {
    throw new FulfillmentHttpError(409,
      'The automatic customer shipping charge changed or needs review. Get fresh UPS rates before continuing.',
      'UPS_CUSTOMER_CHARGE_STALE');
  }
}

type BillingTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function readUpsShippingHandlingFeeCents(tx: BillingTransaction, organizationId: string) {
  const [settings] = await tx.select({ cents: companySettings.upsShippingHandlingFeeCents }).from(companySettings)
    .where(eq(companySettings.organizationId, organizationId)).for('share').limit(1);
  return settings?.cents ?? 0;
}

/** The linked Order owns the decision. Commit it with the amended invoice or
 * the separately approved shipping invoice in the same transaction. */
export async function billShipmentCustomerCharge(input: {
  organizationId: string; shipmentId: string; actorUserId: string; charge: CustomerCharge;
  expectedOrderUpdatedAt?: string | Date;
  expectedShipmentUpdatedAt?: string | Date;
}, transaction?: BillingTransaction) {
  const { organizationId, shipmentId, actorUserId, charge } = input;
  const bill = async (tx: BillingTransaction) => {
    const [shipment] = await tx.select().from(shipments).where(and(eq(shipments.organizationId, organizationId),
      eq(shipments.id, shipmentId))).for('update').limit(1);
    if (!shipment) throw new FulfillmentHttpError(404, 'Shipment not found.', 'NOT_FOUND');
    if (!['DRAFT', 'SHIPPED'].includes(shipment.status) || (await readRepackLink(tx, organizationId, shipmentId))?.replacementShipmentId === shipmentId)
      throw new FulfillmentHttpError(409, 'Use the original shipment or review the charge in Invoices. A voided or replacement shipment cannot set a new customer charge.', 'SHIPPING_BILLING_REVIEW');
    const linkedOrders = await tx.select({ order: orders }).from(shipmentOrders).innerJoin(orders,
      and(eq(orders.organizationId, organizationId), eq(orders.id, shipmentOrders.orderId)))
      .where(and(eq(shipmentOrders.organizationId, organizationId), eq(shipmentOrders.shipmentId, shipmentId)))
      .for('update', { of: orders });
    if (linkedOrders.length !== 1) throw new FulfillmentHttpError(409,
      'Set each customer charge through its Order. Combined shipments require a reviewed allocation.', 'UPS_COMBINED_CHARGE_ALLOCATION_REQUIRED');
    const order = linkedOrders[0].order;
    if (effectiveOrderFulfillmentMethod(order.shippingMethod) === 'pickup' || isCanceledOrder(order)) throw new FulfillmentHttpError(409,
      'An active Shipping or Delivery Order is required to bill shipping.', 'ORDER_NOT_SHIP_ELIGIBLE');
    await lockInvoiceOrderCreation(tx, organizationId, order.id);
    const linked = await tx.select().from(invoices).where(and(eq(invoices.organizationId, organizationId), eq(invoices.orderId, order.id)));
    const active = linked.filter(invoice => invoice.status !== 'void');
    const charged = active.filter(invoice => invoice.shippingCents > 0);
    if (charged.length === 1 && charged[0].shippingCents === charge.shippingCents && order.shippingCents === charge.shippingCents)
      return { applied: false, reason: 'This shipping charge is already invoiced.', invoiceId: charged[0].id };
    if (charged.length || active.length > 1 || linked.some(invoice => invoice.billingMilestone === ORDER_SHIPPING_INVOICE_MILESTONE))
      throw new FulfillmentHttpError(409, 'This Order has an existing shipping charge or multiple invoices. Review the existing invoice in Accounting before changing the charge.', 'SHIPPING_BILLING_REVIEW');
    if ((input.expectedOrderUpdatedAt && new Date(order.updatedAt).getTime() !== new Date(input.expectedOrderUpdatedAt).getTime()) ||
      (input.expectedShipmentUpdatedAt && new Date(shipment.updatedAt).getTime() !== new Date(input.expectedShipmentUpdatedAt).getTime()))
      throw new FulfillmentHttpError(409, 'The Order or shipment changed. Refresh before billing the shipping charge.', 'ORDER_STALE');
    const base = active[0];
    if (base && (base.currency !== 'USD' || base.customerId !== order.customerId ||
      (!base.customerId && (!base.contactId || base.contactId !== order.contactId)))) throw new FulfillmentHttpError(409,
      'The Order and Invoice billing owner or currency needs review before adding shipping.', 'SHIPPING_BILLING_REVIEW');
    if (order.redoDisposition === 'no_customer_charge' && charge.shippingCents > 0) throw new FulfillmentHttpError(409,
      'This replacement is set to no customer charge. Review its billing before charging shipping.', 'SHIPPING_BILLING_REVIEW');

    let invoiceId = base?.id ?? null;
    let supplemental = false;
    const applyCharge = async (runner: typeof tx, requireParity: boolean) => {
      await new OrdersRepository(runner).updateOrder(organizationId, order.id, charge);
      if (order.shippingCents !== charge.shippingCents || requireParity)
        await recalculateEditableOrderFinancialsInTransaction(runner, { organizationId, orderId: order.id, actorUserId,
          requireInvoiceParity: requireParity, requireShippingOnlyParity: requireParity });
    };
    if (charge.shippingCents > 0 && base) {
      try {
        await tx.transaction(savepoint => applyCharge(savepoint, true));
      } catch (error) {
        if (typeof error !== 'object' || !error || !('code' in error) || error.code !== 'ORDER_INVOICE_SYNC_BLOCKED') throw error;
        const terms = base.terms === 'custom' ? 'due_on_receipt' : base.terms || 'due_on_receipt';
        const shippingInvoice = await createInvoiceFromOrderInTransaction(tx, organizationId, order.id, actorUserId, {
          terms, supplementalShipping: { cents: charge.shippingCents, baseInvoiceId: base.id },
        });
        invoiceId = shippingInvoice.id;
        supplemental = true;
        await applyCharge(tx, false);
      }
    } else if (charge.shippingCents !== order.shippingCents || order.shippingChargeDecision !== charge.shippingChargeDecision) {
      await applyCharge(tx, Boolean(base && charge.shippingCents !== order.shippingCents));
    } else {
      return { applied: false, reason: 'The existing customer shipping decision was preserved.', invoiceId };
    }
    await tx.insert(auditLogs).values({
      organizationId, userId: actorUserId,
      actionType: charge.shippingCents > 0 && invoiceId ? 'invoice_shipping_charge_billed' : 'order_shipping_decision_saved',
      entityType: invoiceId ? 'invoice' : 'order', entityId: invoiceId ?? order.id,
      description: supplemental ? 'Created a separate shipping invoice through Fulfillment.' : 'Saved the customer shipping decision through Fulfillment.',
      oldValues: { shippingCents: order.shippingCents, shippingChargeDecision: order.shippingChargeDecision },
      newValues: { orderId: order.id, shipmentId, invoiceId, baseInvoiceId: base?.id, supplemental, ...charge },
    });
    return { applied: true, invoiceId, reason: charge.shippingCents === 0 ? 'Free shipping saved.' : supplemental
      ? 'Shipping invoice created. Open it for accounting approval and sending.'
      : base ? 'Shipping added to the existing Invoice. Review accounting approval before sending the updated Invoice.'
      : 'Customer shipping charge saved. It will be included when the Order is invoiced.' };
  };
  return transaction ? bill(transaction) : db.transaction(bill);
}

/** Changes only the single linked Order. Combined shipments require an explicit allocation policy. */
export async function applyUpsRateToCustomerCharge(input: { organizationId: string; shipmentId: string;
  quoteId: string; optionId: string; intent: 'default_if_unset' | 'use_ups_rate'; actorUserId: string; expectedShippingCents?: number }) {
  const charges = await getUpsCustomerCharges(input.organizationId, input.shipmentId);
  if (charges.length !== 1) throw new FulfillmentHttpError(409,
    'This combined shipment has multiple Orders. Set each customer shipping charge through its Order; the full UPS rate cannot be applied to every Order.', 'UPS_COMBINED_CHARGE_ALLOCATION_REQUIRED');
  const order = charges[0];
  if (input.intent === 'default_if_unset' && order.shippingChargeDecision !== 'unset')
    return { applied: false, reason: 'An existing customer shipping decision was preserved.', order };
  const details = await resolveUpsShippingContext(input.organizationId, input.shipmentId);
  if (details.shipment.packages.some(pkg => pkg.manualTrackingNumber)) {
    throw new FulfillmentHttpError(409, 'Set the customer shipping charge on the Order. This UPS quote covers only the boxes without external tracking.', 'UPS_PARTIAL_BOX_QUOTE');
  }
  if (details.shipment.repackSourceId) {
    throw new FulfillmentHttpError(409, 'Replacement label costs are separate from the existing customer charge.', 'REPACK_CUSTOMER_CHARGE_PRESERVED');
  }
  const credentials = await upsRateCredentials(input.organizationId);
  const fingerprint = upsShippingFingerprint({ origin: details.origin, sender: details.sender,
    destination: details.destination, accountNumber: credentials.accountNumber, packages: details.packages,
    shipDate: details.shipment.shipDate ? new Date(details.shipment.shipDate).toISOString().slice(0, 10) : null });
  const [quote] = await db.select().from(upsShipmentRateQuotes).where(and(eq(upsShipmentRateQuotes.organizationId, input.organizationId),
    eq(upsShipmentRateQuotes.shipmentId, input.shipmentId), eq(upsShipmentRateQuotes.id, input.quoteId))).limit(1);
  const rate = quote ? selectedUpsQuoteRate(quote.rates, input.optionId) : null;
  if (!quote || quote.environment !== credentials.row.mode || !rate || quote.expiresAt.getTime() <= Date.now() || quote.requestFingerprint !== fingerprint)
    throw new FulfillmentHttpError(409, 'UPS rate is stale. Get fresh rates before changing the customer charge.', 'UPS_RATE_STALE');
  return db.transaction(async tx => {
    const handlingFeeCents = await readUpsShippingHandlingFeeCents(tx, input.organizationId);
    if (quote.expiresAt.getTime() <= Date.now()) throw new FulfillmentHttpError(409,
      'UPS rate expired. Get fresh rates before changing the customer charge.', 'UPS_RATE_STALE');
    const charge = customerShippingChargeFromUpsRate(input.quoteId, rate, handlingFeeCents);
    assertExpectedUpsCustomerCharge(input.expectedShippingCents, charge.shippingCents, handlingFeeCents);
    return billShipmentCustomerCharge({ organizationId: input.organizationId, shipmentId: input.shipmentId,
      actorUserId: input.actorUserId, expectedOrderUpdatedAt: order.updatedAt, expectedShipmentUpdatedAt: details.shipment.updatedAt,
      charge }, tx);
  });
}

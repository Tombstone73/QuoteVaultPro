import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { customers, fulfillmentEvents, invoices, orders, shipments, upsCarrierAdjustments, upsLabelPurchaseOrders,
  upsLabelPurchases, upsPackageLabels } from '@shared/schema';
import { db } from '../../db';
import { FulfillmentHttpError } from '../fulfillment/types';

export type UpsPurchaseForReport = Pick<typeof upsLabelPurchases.$inferSelect,
  'id' | 'shipmentId' | 'createdAt' | 'purchasedAt' | 'status' | 'serviceName' | 'providerShipmentId' |
  'estimateCents' | 'estimateCurrency' | 'carrierCostCents' | 'carrierCurrency' | 'voidAcceptedAt' | 'externalCanceledAt'>;
export type UpsOrderForReport = Pick<typeof upsLabelPurchaseOrders.$inferSelect,
  'purchaseId' | 'orderId' | 'invoiceId' | 'customerShippingChargeCents' | 'customerChargeDecision' | 'invoiceShippingCents' | 'invoiceStatus'>;
export type UpsAdjustmentForReport = Pick<typeof upsCarrierAdjustments.$inferSelect,
  'purchaseId' | 'kind' | 'amountCents' | 'currency' | 'providerReference'>;

/** Monetary collections are not allocated to shipping on an Invoice. This is agreement/invoice data, not cash receipts. */
export function projectUpsProfitability(input: { purchases: UpsPurchaseForReport[]; orderLinks: UpsOrderForReport[];
  adjustments: UpsAdjustmentForReport[]; orderNames: Map<string, { orderNumber: string; customerName: string; shippingCents: number }>;
  invoiceState: Map<string, { status: string; shippingCents: number }>;
  currentInvoiceByOrder?: Map<string, { id: string | null; status: string; shippingCents: number }>;
  shipmentDetails?: Map<string, { reference: string | null; shipDate: Date | null; shippedAt: Date | null }>;
  trackingByPurchase?: Map<string, string[]> }) {
  const linksByPurchase = new Map<string, UpsOrderForReport[]>();
  for (const link of input.orderLinks) linksByPurchase.set(link.purchaseId,
    [...(linksByPurchase.get(link.purchaseId) ?? []), link]);
  const purchaseById = new Map(input.purchases.map(row => [row.id, row]));
  const chargeOwner = new Map<string, string>();
  for (const link of input.orderLinks) {
    const candidate = purchaseById.get(link.purchaseId);
    if (!candidate || candidate.carrierCostCents == null) continue;
    const previous = purchaseById.get(chargeOwner.get(link.orderId) ?? '');
    const preferred = (row: UpsPurchaseForReport) => row.status === 'PURCHASED' ? 1 : 0;
    if (!previous || preferred(candidate) > preferred(previous) ||
      (preferred(candidate) === preferred(previous) && (candidate.purchasedAt?.getTime() ?? 0) > (previous.purchasedAt?.getTime() ?? 0)))
      chargeOwner.set(link.orderId, candidate.id);
  }
  const adjustmentsByPurchase = new Map<string, UpsAdjustmentForReport[]>();
  for (const row of input.adjustments) adjustmentsByPurchase.set(row.purchaseId,
    [...(adjustmentsByPurchase.get(row.purchaseId) ?? []), row]);
  return input.purchases.filter((purchase): purchase is UpsPurchaseForReport & { purchasedAt: Date; carrierCostCents: number } =>
    purchase.purchasedAt != null && purchase.carrierCostCents != null).map(purchase => {
    const links = linksByPurchase.get(purchase.id) ?? [];
    const credited = (adjustmentsByPurchase.get(purchase.id) ?? []).filter(row => row.kind === 'CONFIRMED_CREDIT')
      .reduce((sum, row) => sum + row.amountCents, 0);
    const adjusted = (adjustmentsByPurchase.get(purchase.id) ?? []).filter(row => row.kind === 'CARRIER_ADJUSTMENT')
      .reduce((sum, row) => sum + row.amountCents, 0);
    const attributed = links.filter(link => chargeOwner.get(link.orderId) === purchase.id);
    const customerShippingChargeAtPurchaseCents = attributed.reduce((sum, link) => sum + link.customerShippingChargeCents, 0);
    const customerShippingChargeCents = attributed.reduce((sum, link) =>
      sum + (input.orderNames.get(link.orderId)?.shippingCents ?? link.customerShippingChargeCents), 0);
    const issuedInvoiceShippingCents = attributed.reduce((sum, link) => {
      const invoice = input.currentInvoiceByOrder?.get(link.orderId) ??
        (link.invoiceId ? input.invoiceState.get(link.invoiceId) : null);
      return sum + (invoice && !['draft', 'void'].includes(invoice.status) ? invoice.shippingCents : 0);
    }, 0);
    const netCarrierCostCents = purchase.carrierCostCents + adjusted - credited;
    const shipment = input.shipmentDetails?.get(purchase.shipmentId);
    return { purchaseId: purchase.id, shipmentId: purchase.shipmentId,
      shipmentReference: shipment?.reference ?? purchase.shipmentId,
      shipDate: shipment?.shipDate?.toISOString().slice(0, 10) ?? null,
      shippedAt: shipment?.shippedAt?.toISOString() ?? null,
      trackingNumbers: input.trackingByPurchase?.get(purchase.id) ?? [], purchasedAt: purchase.purchasedAt.toISOString(),
      providerShipmentId: purchase.providerShipmentId, serviceName: purchase.serviceName, status: purchase.status,
      estimateCents: purchase.estimateCents, carrierCostCents: purchase.carrierCostCents,
      currency: purchase.carrierCurrency ?? purchase.estimateCurrency, confirmedCreditsCents: credited,
      adjustmentsCents: adjusted, netCarrierCostCents, customerShippingChargeCents, customerShippingChargeAtPurchaseCents,
      issuedInvoiceShippingCents, differenceCents: purchase.carrierCurrency === 'USD'
        ? customerShippingChargeCents - netCarrierCostCents : null,
      voidAcceptedAt: purchase.voidAcceptedAt?.toISOString() ?? null,
      externalCanceledAt: purchase.externalCanceledAt?.toISOString() ?? null,
      adjustments: adjustmentsByPurchase.get(purchase.id) ?? [],
      orders: links.map(link => ({ orderId: link.orderId,
        orderNumber: input.orderNames.get(link.orderId)?.orderNumber ?? link.orderId,
        customerName: input.orderNames.get(link.orderId)?.customerName ?? '',
        customerChargeAtPurchaseCents: link.customerShippingChargeCents,
        currentCustomerChargeCents: input.orderNames.get(link.orderId)?.shippingCents ?? link.customerShippingChargeCents,
        attributedHere: chargeOwner.get(link.orderId) === purchase.id,
        invoiceId: input.currentInvoiceByOrder?.has(link.orderId)
          ? input.currentInvoiceByOrder.get(link.orderId)!.id : link.invoiceId,
        invoiceStatus: input.currentInvoiceByOrder?.get(link.orderId)?.status ??
          (link.invoiceId ? input.invoiceState.get(link.invoiceId)?.status ?? link.invoiceStatus : null) })) };
  });
}

export async function getUpsProfitabilityReport(organizationId: string, from: Date, toExclusive: Date) {
  if (toExclusive.getTime() <= from.getTime() || toExclusive.getTime() - from.getTime() > 367 * 86_400_000)
    throw new FulfillmentHttpError(400, 'Choose a date range of no more than one year.', 'UPS_REPORT_DATE_RANGE');
  // Read each relationship independently. Joining packages, Orders, Invoices,
  // and adjustments in one SQL rowset would multiply both expense and charges.
  const purchases = await db.select().from(upsLabelPurchases).where(and(eq(upsLabelPurchases.organizationId, organizationId),
    isNotNull(upsLabelPurchases.purchasedAt)));
  const ids = purchases.map(row => row.id);
  if (!ids.length) return { rows: [], totals: { customerShippingChargeCents: 0,
    issuedInvoiceShippingCents: 0, carrierByCurrency: [] as Array<{ currency: string; carrierCostCents: number;
      confirmedCreditsCents: number; adjustmentsCents: number; netCarrierCostCents: number; differenceCents: number | null }> } };
  const allLinks = await db.select().from(upsLabelPurchaseOrders).where(and(eq(upsLabelPurchaseOrders.organizationId, organizationId),
    inArray(upsLabelPurchaseOrders.purchaseId, ids)));
  const reportPurchases = purchases.filter(row => row.purchasedAt && row.purchasedAt >= from && row.purchasedAt < toExclusive);
  const reportIds = reportPurchases.map(row => row.id);
  const reportLinks = allLinks.filter(link => reportIds.includes(link.purchaseId));
  const orderIds = Array.from(new Set(reportLinks.map(link => link.orderId)));
  const [adjustments, namedOrders, currentInvoices, shipmentRows, trackingRows] = await Promise.all([
    reportIds.length ? db.select().from(upsCarrierAdjustments).where(and(eq(upsCarrierAdjustments.organizationId, organizationId),
      inArray(upsCarrierAdjustments.purchaseId, reportIds))) : [],
    orderIds.length ? db.select({ id: orders.id, displayNumber: orders.displayNumber, shippingCents: orders.shippingCents,
      companyName: customers.companyName }).from(orders).leftJoin(customers, and(eq(customers.id, orders.customerId),
        eq(customers.organizationId, organizationId))).where(and(eq(orders.organizationId, organizationId), inArray(orders.id, orderIds))) : [],
    orderIds.length ? db.select({ id: invoices.id, orderId: invoices.orderId,
      status: invoices.status, shippingCents: invoices.shippingCents })
      .from(invoices).where(and(eq(invoices.organizationId, organizationId), inArray(invoices.orderId, orderIds))) : [],
    reportPurchases.length ? db.select({ id: shipments.id, reference: shipments.shipmentReference,
      shipDate: shipments.shipDate, shippedAt: shipments.shippedAt }).from(shipments).where(and(
      eq(shipments.organizationId, organizationId), inArray(shipments.id,
        Array.from(new Set(reportPurchases.map(purchase => purchase.shipmentId)))))) : [],
    reportIds.length ? db.select({ purchaseId: upsPackageLabels.purchaseId, trackingNumber: upsPackageLabels.trackingNumber })
      .from(upsPackageLabels).where(and(eq(upsPackageLabels.organizationId, organizationId),
        inArray(upsPackageLabels.purchaseId, reportIds))) : [],
  ]);
  const trackingByPurchase = new Map<string, string[]>();
  for (const label of trackingRows) trackingByPurchase.set(label.purchaseId,
    [...(trackingByPurchase.get(label.purchaseId) ?? []), label.trackingNumber]);
  const invoiceCandidatesByOrder = new Map<string, typeof currentInvoices>();
  for (const invoice of currentInvoices) if (invoice.orderId && invoice.status !== 'void')
    invoiceCandidatesByOrder.set(invoice.orderId, [...(invoiceCandidatesByOrder.get(invoice.orderId) ?? []), invoice]);
  const currentInvoiceByOrder = new Map<string, { id: string | null; status: string; shippingCents: number }>(
    Array.from(invoiceCandidatesByOrder).map(([orderId, candidates]) => [orderId, candidates.length === 1
      ? { id: candidates[0].id, status: candidates[0].status, shippingCents: candidates[0].shippingCents }
      : { id: null, status: 'multiple_live_invoices', shippingCents: 0 }]));
  const rows = projectUpsProfitability({ purchases, orderLinks: allLinks, adjustments,
    orderNames: new Map(namedOrders.map(order => [order.id, { orderNumber: order.displayNumber ?? order.id,
      customerName: order.companyName ?? '', shippingCents: order.shippingCents }])),
    invoiceState: new Map(currentInvoices.map(invoice => [invoice.id, invoice])), currentInvoiceByOrder,
    shipmentDetails: new Map(shipmentRows.map(shipment => [shipment.id, shipment])), trackingByPurchase })
    .filter(row => reportIds.includes(row.purchaseId));
  const carrierByCurrency = new Map<string, { currency: string; carrierCostCents: number;
    confirmedCreditsCents: number; adjustmentsCents: number; netCarrierCostCents: number; differenceCents: number | null }>();
  for (const row of rows) {
    const current = carrierByCurrency.get(row.currency) ?? { currency: row.currency, carrierCostCents: 0,
      confirmedCreditsCents: 0, adjustmentsCents: 0, netCarrierCostCents: 0, differenceCents: row.currency === 'USD' ? 0 : null };
    current.carrierCostCents += row.carrierCostCents;
    current.confirmedCreditsCents += row.confirmedCreditsCents;
    current.adjustmentsCents += row.adjustmentsCents;
    current.netCarrierCostCents += row.netCarrierCostCents;
    if (current.differenceCents !== null && row.differenceCents !== null) current.differenceCents += row.differenceCents;
    carrierByCurrency.set(row.currency, current);
  }
  const totals = { customerShippingChargeCents: rows.reduce((sum, row) => sum + row.customerShippingChargeCents, 0),
    issuedInvoiceShippingCents: rows.reduce((sum, row) => sum + row.issuedInvoiceShippingCents, 0),
    carrierByCurrency: Array.from(carrierByCurrency.values()).sort((a, b) => a.currency.localeCompare(b.currency)) };
  return { rows, totals };
}

export function upsProfitabilityCsv(rows: Awaited<ReturnType<typeof getUpsProfitabilityReport>>['rows']) {
  const csv = (value: unknown) => { const text = String(value ?? '');
    const safe = /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`; };
  const header = ['Label purchase date', 'Shipment date', 'Shipment reference', 'Shipment ID', 'UPS reference',
    'Tracking numbers', 'Carrier', 'Service', 'Status', 'Customers', 'Orders',
    'Carrier cost', 'Confirmed credits', 'Carrier adjustments', 'Net carrier cost', 'Current customer shipping charge (agreed)',
    'Customer shipping charge at purchase',
    'Issued invoice shipping amount', 'Charge minus net carrier cost', 'Currency', 'Void accepted', 'External cancellation'];
  const data = rows.map(row => [row.purchasedAt, row.shipDate ?? row.shippedAt ?? '', row.shipmentReference,
    row.shipmentId, row.providerShipmentId, row.trackingNumbers.join('; '), 'UPS', row.serviceName, row.status,
    Array.from(new Set(row.orders.map(order => order.customerName))).join('; '), row.orders.map(order => order.orderNumber).join('; '),
    row.carrierCostCents / 100, row.confirmedCreditsCents / 100, row.adjustmentsCents / 100, row.netCarrierCostCents / 100,
    row.customerShippingChargeCents / 100, row.customerShippingChargeAtPurchaseCents / 100,
    row.issuedInvoiceShippingCents / 100,
    row.differenceCents === null ? '' : row.differenceCents / 100,
    row.currency, row.voidAcceptedAt, row.externalCanceledAt]);
  return [header, ...data].map(row => row.map(csv).join(',')).join('\r\n') + '\r\n';
}

/** Records later carrier billing evidence. A void request alone never creates a credit. */
export async function recordUpsCarrierAdjustment(input: { organizationId: string; purchaseId: string; actorUserId: string;
  kind: 'CONFIRMED_CREDIT' | 'CARRIER_ADJUSTMENT'; amountCents: number; currency: string;
  providerReference: string; note?: string | null }) {
  return db.transaction(async tx => {
    const [purchase] = await tx.select().from(upsLabelPurchases).where(and(eq(upsLabelPurchases.organizationId, input.organizationId),
      eq(upsLabelPurchases.id, input.purchaseId))).for('update').limit(1);
    if (!purchase?.purchasedAt || purchase.carrierCostCents == null) throw new FulfillmentHttpError(409,
      'A confirmed purchase is required before recording a carrier credit or adjustment.', 'UPS_ADJUSTMENT_UNAVAILABLE');
    if (purchase.carrierCurrency !== input.currency) throw new FulfillmentHttpError(409,
      'The carrier adjustment currency must match the purchased label.', 'UPS_ADJUSTMENT_CURRENCY');
    const [existing] = await tx.select().from(upsCarrierAdjustments).where(and(eq(upsCarrierAdjustments.organizationId, input.organizationId),
      eq(upsCarrierAdjustments.purchaseId, input.purchaseId), eq(upsCarrierAdjustments.providerReference, input.providerReference))).limit(1);
    if (existing) {
      if (existing.kind === input.kind && existing.amountCents === input.amountCents && existing.currency === input.currency)
        return { adjustment: existing, replayed: true };
      throw new FulfillmentHttpError(409, 'This carrier reference was already recorded with different details.', 'UPS_ADJUSTMENT_CONFLICT');
    }
    const [adjustment] = await tx.insert(upsCarrierAdjustments).values({ organizationId: input.organizationId,
      purchaseId: input.purchaseId, kind: input.kind, amountCents: input.amountCents, currency: input.currency,
      providerReference: input.providerReference, note: input.note || null, recordedByUserId: input.actorUserId }).returning();
    await tx.insert(fulfillmentEvents).values({ organizationId: input.organizationId, actorUserId: input.actorUserId,
      entityType: 'SHIPMENT', entityId: purchase.shipmentId, eventType: 'SHIPMENT_UPDATED',
      payloadJson: { action: 'ups_carrier_adjustment_recorded', purchaseId: purchase.id, adjustmentId: adjustment.id,
        kind: input.kind, amountCents: input.amountCents, providerReference: input.providerReference } });
    return { adjustment, replayed: false };
  });
}

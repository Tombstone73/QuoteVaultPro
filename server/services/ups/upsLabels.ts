import { createHash, randomUUID } from 'node:crypto';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { companySettings, fulfillmentEvents, invoices, orderLineItems, orders, shipmentItems, shipmentOrders, shipmentPackages, shipments,
  upsCarrierAdjustments, upsLabelPurchases, upsLabelPurchaseOrders, upsPackageLabels, upsShipmentRateQuotes } from '@shared/schema';
import type { ShippingParty } from '@shared/shippingDocuments';
import { db } from '../../db';
import { isFulfillmentQueueEligibleOrder } from '../fulfillment/eligibility';
import { FulfillmentDashboardRepo, ShipmentRepo } from '../fulfillment/repository';
import { FulfillmentHttpError } from '../fulfillment/types';
import { upsRateCredentials } from './upsConnection';
import { isOriginalUpsEnvironment, isRetirableUpsSample, isUpsPlaceholderTracking } from './upsLabelEnvironment';
import { countryCode, resolveUpsShippingContext, upsShippingFingerprint, type UpsRatePackage } from './upsRates';

type UpsPurchaseResult = { providerShipmentId: string; carrierCostCents: number; carrierCurrency: string;
  labels: Array<{ trackingNumber: string; format: 'GIF'; base64: string; sha256: string }> };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : value == null ? [] : [value];
const cents = (value: string): number | null => {
  const amount = Math.round(Number(value) * 100);
  return /^\d+(?:\.\d{1,2})?$/.test(value) && Number.isSafeInteger(amount) && amount <= 2_147_483_647 ? amount : null;
};
const upsAddress = (party: ShippingParty) => ({ AddressLine: [party.address1, party.address2].filter(Boolean),
  City: party.city, StateProvinceCode: party.state, PostalCode: party.postalCode,
  CountryCode: countryCode(party.country) });
const upsParty = (party: ShippingParty) => ({ Name: (party.company || party.name || '').slice(0, 35),
  AttentionName: (party.name || party.company || '').slice(0, 35),
  ...(party.phone ? { Phone: { Number: party.phone.replace(/[^\d]/g, '').slice(0, 15) } } : {}),
  Address: upsAddress(party) });

export function supportsUpsPackageReference(originCountry: string | null, destinationCountry: string | null) {
  const origin = countryCode(originCountry);
  const destination = countryCode(destinationCountry);
  return (origin === 'US' && destination === 'US') || (origin === 'PR' && destination === 'PR');
}

/** Official UPS Shipping API v2409 uses one ShipmentRequest for the entire package set. */
export function buildUpsLabelRequest(input: { origin: ShippingParty; sender: ShippingParty; destination: ShippingParty;
  accountNumber: string; serviceCode: string; packages: Array<UpsRatePackage & { packageReference?: string }> }) {
  return { ShipmentRequest: { Request: { RequestOption: 'nonvalidate', SubVersion: '1601' },
    Shipment: { Shipper: { ...upsParty(input.origin), ShipperNumber: input.accountNumber },
      ShipFrom: upsParty(input.sender), ShipTo: upsParty(input.destination),
      PaymentInformation: { ShipmentCharge: { Type: '01', BillShipper: { AccountNumber: input.accountNumber } } },
      Service: { Code: input.serviceCode }, ShipmentRatingOptions: { NegotiatedRatesIndicator: 'Y' },
      Package: input.packages.map(pkg => ({ Packaging: { Code: pkg.packagingType },
        ...(pkg.packageReference && supportsUpsPackageReference(input.origin.country, input.destination.country)
          ? { ReferenceNumber: [{ Value: pkg.packageReference.slice(-35) }] } : {}),
        Dimensions: { UnitOfMeasurement: { Code: 'IN' }, Length: String(pkg.lengthIn), Width: String(pkg.widthIn), Height: String(pkg.heightIn) },
        PackageWeight: { UnitOfMeasurement: { Code: 'LBS' }, Weight: String(pkg.weightLbs) } })) },
    LabelSpecification: { LabelImageFormat: { Code: 'GIF' }, LabelStockSize: { Height: '6', Width: '4' } } } };
}

export function normalizeUpsPurchase(payload: unknown, expectedPackages: number): UpsPurchaseResult | null {
  const results = object(object(payload).ShipmentResponse).ShipmentResults;
  const row = object(results);
  const providerShipmentId = str(row.ShipmentIdentificationNumber);
  const negotiated = object(object(row.NegotiatedRateCharges).TotalCharge);
  const published = object(object(row.ShipmentCharges).TotalCharges);
  const charge = str(negotiated.MonetaryValue) ? negotiated : published;
  const carrierCostCents = cents(str(charge.MonetaryValue));
  const carrierCurrency = str(charge.CurrencyCode).toUpperCase();
  const labels = array(row.PackageResults).map(raw => {
    const pkg = object(raw);
    const label = object(pkg.ShippingLabel);
    const base64 = str(label.GraphicImage);
    const format = str(object(label.ImageFormat).Code).toUpperCase();
    const trackingNumber = str(pkg.TrackingNumber);
    if (format !== 'GIF' || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) ||
      !/^[A-Za-z0-9]{8,80}$/.test(trackingNumber)) return null;
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length < 20 || !['GIF89a', 'GIF87a'].includes(bytes.subarray(0, 6).toString('ascii')) ||
      bytes.readUInt16LE(6) === 0 || bytes.readUInt16LE(8) === 0 || bytes.at(-1) !== 0x3b) return null;
    return { trackingNumber, format: 'GIF' as const, base64, sha256: createHash('sha256').update(bytes).digest('hex') };
  });
  if (!/^[A-Za-z0-9]{8,80}$/.test(providerShipmentId) || carrierCostCents == null || !/^[A-Z]{3}$/.test(carrierCurrency)
    || labels.length !== expectedPackages || labels.some(label => !label)
    || new Set(labels.map(label => label?.trackingNumber)).size !== labels.length) return null;
  return { providerShipmentId, carrierCostCents, carrierCurrency, labels: labels as UpsPurchaseResult['labels'] };
}

export function classifyUpsVoidResponse(httpStatus: number, payload: unknown): 'ACCEPTED' | 'REJECTED' | 'UNCERTAIN' {
  const details = object(object(payload).VoidShipmentResponse);
  const accepted = str(object(object(details.Response).ResponseStatus).Code) === '1'
    && str(object(object(details.SummaryResult).Status).Code) === '1';
  if (httpStatus >= 200 && httpStatus < 300) return accepted ? 'ACCEPTED' : 'UNCERTAIN';
  return httpStatus >= 500 || httpStatus === 429 ? 'UNCERTAIN' : 'REJECTED';
}

async function purchaseHistory(orgId: string, shipmentId: string) {
  const rows = await db.select().from(upsLabelPurchases).where(and(eq(upsLabelPurchases.organizationId, orgId),
    eq(upsLabelPurchases.shipmentId, shipmentId))).orderBy(upsLabelPurchases.createdAt);
  const labels = rows.length ? await db.select({ id: upsPackageLabels.id, purchaseId: upsPackageLabels.purchaseId,
    packageId: upsPackageLabels.packageId, providerResultOrdinal: upsPackageLabels.providerResultOrdinal,
    trackingNumber: upsPackageLabels.trackingNumber,
    labelFormat: upsPackageLabels.labelFormat }).from(upsPackageLabels).where(and(eq(upsPackageLabels.organizationId, orgId),
      inArray(upsPackageLabels.purchaseId, rows.map(row => row.id)))) : [];
  const adjustments = rows.length ? await db.select({ id: upsCarrierAdjustments.id, purchaseId: upsCarrierAdjustments.purchaseId,
    kind: upsCarrierAdjustments.kind, amountCents: upsCarrierAdjustments.amountCents,
    currency: upsCarrierAdjustments.currency, providerReference: upsCarrierAdjustments.providerReference,
    createdAt: upsCarrierAdjustments.createdAt }).from(upsCarrierAdjustments).where(and(
      eq(upsCarrierAdjustments.organizationId, orgId), inArray(upsCarrierAdjustments.purchaseId, rows.map(row => row.id)))) : [];
  return rows.map(({ providerEvidence, providerTransactionId, requestFingerprint, ...row }) => ({ ...row,
    voidProviderCode: str(object(providerEvidence).voidProviderCode) || null,
    labels: labels.filter(label => label.purchaseId === row.id)
      .sort((a, b) => (a.providerResultOrdinal ?? 0) - (b.providerResultOrdinal ?? 0)),
    adjustments: adjustments.filter(adjustment => adjustment.purchaseId === row.id) }));
}
export { purchaseHistory as getUpsLabelHistory };

/** Retires only a proven sample placeholder; no UPS request, void, or carrier credit is implied. */
export async function retireUpsSampleLabel(orgId: string, shipmentId: string, purchaseId: string,
  actorUserId: string, input: { reason: string; evidenceReference?: string }) {
  return db.transaction(async tx => {
    const [shipment] = await tx.select().from(shipments).where(and(eq(shipments.organizationId, orgId),
      eq(shipments.id, shipmentId))).for('update').limit(1);
    if (!shipment || shipment.status !== 'DRAFT') throw new FulfillmentHttpError(409,
      'Only a DRAFT shipment can retire a sample label.', 'UPS_SAMPLE_RETIRE_UNAVAILABLE');
    const [purchase] = await tx.select().from(upsLabelPurchases).where(and(eq(upsLabelPurchases.organizationId, orgId),
      eq(upsLabelPurchases.shipmentId, shipmentId), eq(upsLabelPurchases.id, purchaseId))).for('update').limit(1);
    if (!purchase) throw new FulfillmentHttpError(404, 'UPS purchase not found.', 'NOT_FOUND');
    const labels = await tx.select({ trackingNumber: upsPackageLabels.trackingNumber }).from(upsPackageLabels)
      .where(and(eq(upsPackageLabels.organizationId, orgId), eq(upsPackageLabels.purchaseId, purchaseId)));
    if (!isRetirableUpsSample({ status: purchase.status, environment: purchase.environment,
      providerShipmentId: purchase.providerShipmentId, trackingNumbers: labels.map(label => label.trackingNumber) }))
      throw new FulfillmentHttpError(409, 'Only a saved sandbox sample with placeholder tracking can be retired here. Investigate any real or uncertain UPS purchase before retrying.', 'UPS_SAMPLE_RETIRE_UNAVAILABLE');
    if (purchase.environment === 'unknown' && !input.evidenceReference?.trim()) throw new FulfillmentHttpError(409,
      'Record evidence that this historical sample was created in UPS test mode before retiring it.', 'UPS_SAMPLE_EVIDENCE_REQUIRED');
    if (shipment.carrierShipmentId !== purchase.providerShipmentId || !isUpsPlaceholderTracking(shipment.trackingNumber))
      throw new FulfillmentHttpError(409, 'Shipment tracking changed. Reload and investigate before retiring this sample.', 'UPS_SAMPLE_RETIRE_STALE');
    await tx.update(upsLabelPurchases).set({ status: 'SAMPLE_RETIRED', updatedAt: new Date() })
      .where(and(eq(upsLabelPurchases.organizationId, orgId), eq(upsLabelPurchases.id, purchaseId)));
    await tx.update(shipments).set({ carrier: null, serviceLevel: null, trackingNumber: null,
      carrierShipmentId: null, updatedAt: new Date() }).where(and(eq(shipments.organizationId, orgId), eq(shipments.id, shipmentId)));
    await tx.insert(fulfillmentEvents).values({ organizationId: orgId, actorUserId, entityType: 'SHIPMENT',
      entityId: shipmentId, eventType: 'SHIPMENT_UPDATED', payloadJson: { action: 'ups_sample_label_retired', purchaseId,
        recordedEnvironment: purchase.environment, reason: input.reason.trim(),
        evidenceReference: input.evidenceReference?.trim() || null, providerVoidConfirmed: false,
        carrierCreditConfirmed: false } });
    return { status: 'SAMPLE_RETIRED' as const, environment: purchase.environment };
  });
}

async function markUncertain(orgId: string, purchaseId: string, errorCode: string, evidence?: Record<string, unknown>) {
  await db.update(upsLabelPurchases).set({ status: 'UNCERTAIN', errorCode,
    ...(evidence ? { providerEvidence: evidence } : {}), updatedAt: new Date() })
    .where(and(eq(upsLabelPurchases.organizationId, orgId), eq(upsLabelPurchases.id, purchaseId),
      eq(upsLabelPurchases.status, 'REQUESTING')));
}

async function persistUpsPurchase(orgId: string, attempt: typeof upsLabelPurchases.$inferSelect,
  normalized: UpsPurchaseResult, packageIds: string[], actorUserId?: string | null) {
  await db.transaction(async tx => {
    const [locked] = await tx.select({ id: shipments.id, status: shipments.status }).from(shipments).where(and(
      eq(shipments.organizationId, orgId), eq(shipments.id, attempt.shipmentId))).for('update').limit(1);
    if (!locked || locked.status !== 'DRAFT') throw new Error('Shipment changed after UPS purchase');
    const [current] = await tx.select({ status: upsLabelPurchases.status }).from(upsLabelPurchases).where(and(
      eq(upsLabelPurchases.organizationId, orgId), eq(upsLabelPurchases.id, attempt.id))).for('update').limit(1);
    if (!current || !['REQUESTING', 'UNCERTAIN'].includes(current.status)) throw new Error('Purchase attempt changed');
    if (packageIds.length !== normalized.labels.length) throw new Error('Package count changed');
    const savedPackages = await tx.select({ id: shipmentPackages.id }).from(shipmentPackages).where(and(
      eq(shipmentPackages.organizationId, orgId), eq(shipmentPackages.shipmentId, attempt.shipmentId))).orderBy(shipmentPackages.ordinal);
    if (savedPackages.length !== packageIds.length || savedPackages.some((pkg, i) => pkg.id !== packageIds[i])) throw new Error('Packages changed');
    const linkedOrders = await tx.select({ orderId: orders.id, shippingCents: orders.shippingCents,
      chargeDecision: orders.shippingChargeDecision }).from(shipmentOrders)
      .innerJoin(orders, and(eq(orders.id, shipmentOrders.orderId), eq(orders.organizationId, orgId)))
      .where(and(eq(shipmentOrders.organizationId, orgId), eq(shipmentOrders.shipmentId, attempt.shipmentId)));
    if (!linkedOrders.length) throw new Error('Shipment Order links changed');
    const linkedInvoices = await tx.select({ id: invoices.id, orderId: invoices.orderId, shippingCents: invoices.shippingCents,
      status: invoices.status }).from(invoices).where(and(eq(invoices.organizationId, orgId),
        inArray(invoices.orderId, linkedOrders.map(order => order.orderId)), ne(invoices.status, 'void')));
    await tx.insert(upsLabelPurchaseOrders).values(linkedOrders.map(order => {
      const matching = linkedInvoices.filter(invoice => invoice.orderId === order.orderId);
      return { organizationId: orgId, purchaseId: attempt.id, orderId: order.orderId,
        customerShippingChargeCents: order.shippingCents, customerChargeDecision: order.chargeDecision,
        invoiceId: matching.length === 1 ? matching[0].id : null,
        invoiceShippingCents: matching.length === 1 ? matching[0].shippingCents : null,
        invoiceStatus: matching.length === 1 ? matching[0].status : matching.length > 1 ? 'multiple_live_invoices' : null };
    }));
    const mappingRequired = packageIds.length > 1;
    await tx.insert(upsPackageLabels).values(normalized.labels.map((label, i) => ({ organizationId: orgId,
      purchaseId: attempt.id, packageId: mappingRequired ? null : packageIds[i], providerResultOrdinal: i + 1,
      trackingNumber: label.trackingNumber,
      labelFormat: label.format, labelBytes: Buffer.from(label.base64, 'base64'), labelSha256: label.sha256 })));
    await tx.update(upsLabelPurchases).set({ status: mappingRequired ? 'MAPPING_REQUIRED' : 'PURCHASED',
      carrierCostCents: normalized.carrierCostCents,
      carrierCurrency: normalized.carrierCurrency, providerShipmentId: normalized.providerShipmentId,
      errorCode: null,
      providerEvidence: { providerShipmentId: normalized.providerShipmentId, trackingNumbers: normalized.labels.map(label => label.trackingNumber) },
      purchasedAt: new Date(), updatedAt: new Date() }).where(and(eq(upsLabelPurchases.organizationId, orgId), eq(upsLabelPurchases.id, attempt.id)));
    await tx.update(shipments).set({ carrier: 'UPS', serviceLevel: attempt.serviceName,
      trackingNumber: mappingRequired ? null : normalized.labels[0].trackingNumber,
      carrierShipmentId: normalized.providerShipmentId,
      updatedAt: new Date() }).where(and(eq(shipments.organizationId, orgId), eq(shipments.id, attempt.shipmentId), eq(shipments.status, 'DRAFT')));
    await tx.insert(fulfillmentEvents).values({ organizationId: orgId, actorUserId: actorUserId ?? null,
      entityType: 'SHIPMENT', entityId: attempt.shipmentId, eventType: 'SHIPMENT_UPDATED',
      payloadJson: { action: 'ups_label_purchased', purchaseId: attempt.id,
        providerShipmentId: normalized.providerShipmentId, boxMappingRequired: mappingRequired } });
  });
}

export async function buyUpsLabel(orgId: string, shipmentId: string, input: { quoteId: string; serviceCode: string }, actorUserId?: string | null) {
  const credentials = await upsRateCredentials(orgId);
  const details = await resolveUpsShippingContext(orgId, shipmentId);
  if (details.packages.length > 1 && !supportsUpsPackageReference(details.origin.country, details.destination.country))
    throw new FulfillmentHttpError(409,
      'UPS does not support the box references needed to verify labels for this route. Use separate one-box shipments.',
      'UPS_MULTI_BOX_ROUTE_UNSUPPORTED');
  const fingerprint = upsShippingFingerprint({ origin: details.origin, sender: details.sender,
    destination: details.destination, accountNumber: credentials.accountNumber, packages: details.packages });
  const attempt = await db.transaction(async tx => {
    const [shipment] = await tx.select().from(shipments).where(and(eq(shipments.organizationId, orgId), eq(shipments.id, shipmentId))).for('update').limit(1);
    if (!shipment || shipment.status !== 'DRAFT') throw new FulfillmentHttpError(409, 'Only a saved DRAFT shipment can purchase a label.', 'UPS_INVALID_SHIPMENT');
    if (shipment.updatedAt.getTime() !== details.shipment.updatedAt.getTime()) throw new FulfillmentHttpError(409,
      'Shipment changed. Get fresh UPS rates before purchasing.', 'UPS_RATE_STALE');
    const [active] = await tx.select({ id: upsLabelPurchases.id, status: upsLabelPurchases.status }).from(upsLabelPurchases)
      .where(and(eq(upsLabelPurchases.organizationId, orgId), eq(upsLabelPurchases.shipmentId, shipmentId),
        inArray(upsLabelPurchases.status, ['REQUESTING', 'UNCERTAIN', 'PURCHASED', 'MAPPING_REQUIRED', 'VOID_REQUESTING', 'VOID_UNCERTAIN']))).limit(1);
    if (active) throw new FulfillmentHttpError(409, 'A UPS label exists or its outcome needs investigation. Review the purchase history before another purchase.', 'UPS_PURCHASE_EXISTS');
    const [quote] = await tx.select().from(upsShipmentRateQuotes).where(and(eq(upsShipmentRateQuotes.id, input.quoteId),
      eq(upsShipmentRateQuotes.organizationId, orgId), eq(upsShipmentRateQuotes.shipmentId, shipmentId))).limit(1);
    const rate = quote?.rates.find(item => item.serviceCode === input.serviceCode);
    if (!quote || quote.environment !== credentials.row.mode || !rate || quote.expiresAt.getTime() <= Date.now() || quote.requestFingerprint !== fingerprint) throw new FulfillmentHttpError(409,
        'UPS rates expired or shipment details changed. Get fresh rates before buying.', 'UPS_RATE_STALE');
    const [packages, links, items] = await Promise.all([
      tx.select().from(shipmentPackages).where(and(eq(shipmentPackages.organizationId, orgId), eq(shipmentPackages.shipmentId, shipmentId))).orderBy(shipmentPackages.ordinal),
      tx.select({ id: orders.id, state: orders.state, status: orders.status, canceledAt: orders.canceledAt,
        fulfillmentStatus: orders.fulfillmentStatus, shippingMethod: orders.shippingMethod,
        shippingChargeDecision: orders.shippingChargeDecision }).from(shipmentOrders)
        .innerJoin(orders, eq(orders.id, shipmentOrders.orderId)).where(and(eq(shipmentOrders.organizationId, orgId),
          eq(shipmentOrders.shipmentId, shipmentId), eq(orders.organizationId, orgId))),
      tx.select().from(shipmentItems).where(and(eq(shipmentItems.organizationId, orgId), eq(shipmentItems.shipmentId, shipmentId))),
    ]);
    if (packages.length !== details.packages.length || packages.some((pkg, i) => pkg.id !== details.packages[i].id ||
      Number(pkg.weightLbs) !== details.packages[i].weightLbs || Number(pkg.dimLengthIn) !== details.packages[i].lengthIn ||
      Number(pkg.dimWidthIn) !== details.packages[i].widthIn || Number(pkg.dimHeightIn) !== details.packages[i].heightIn ||
      pkg.upsPackagingType !== details.packages[i].packagingType)) throw new FulfillmentHttpError(409,
        'Saved packages changed. Get fresh UPS rates.', 'UPS_RATE_STALE');
    if (!links.length || links.some(link => !isFulfillmentQueueEligibleOrder(link) || link.shippingMethod === 'pickup'))
      throw new FulfillmentHttpError(409, 'An associated Order is not eligible for shipping.', 'UPS_ORDER_INELIGIBLE');
    if (links.some(link => link.shippingChargeDecision === 'unset')) throw new FulfillmentHttpError(409,
      'Set the customer shipping charge on each Order, or apply this UPS rate to an eligible single Order, before buying a label.',
      'UPS_CUSTOMER_CHARGE_UNSET');
    const packageIds = new Set(packages.map(pkg => pkg.id));
    if (!items.length || items.some(item => !item.packageId || !packageIds.has(item.packageId) || item.quantity <= 0 ||
      !links.some(link => link.id === item.orderId))) throw new FulfillmentHttpError(409,
        'Allocate shipment quantities to saved packages before buying a label.', 'UPS_ALLOCATION_INCOMPLETE');
    const lineItemIds = Array.from(new Set(items.map(item => item.orderLineItemId))).sort();
    await tx.execute(sql`SELECT ${orderLineItems.id} FROM ${orderLineItems}
      WHERE ${inArray(orderLineItems.id, lineItemIds)} ORDER BY ${orderLineItems.id} FOR UPDATE`);
    const dashboard = new FulfillmentDashboardRepo(tx as any);
    const eligibility = await dashboard.listLineEligibility(orgId, { lineItemIds });
    const otherDrafts = await new ShipmentRepo(tx as any).listDraftReservationQuantities(orgId, lineItemIds, shipmentId, tx as any);
    const byLine = new Map(eligibility.map(line => [line.id, line]));
    const totals = new Map<string, number>();
    for (const item of items) {
      const line = byLine.get(item.orderLineItemId);
      if (!line || line.orderId !== item.orderId || !line.projection.requiresFulfillment) throw new FulfillmentHttpError(409,
        'Shipment contains an ineligible Order line.', 'UPS_ALLOCATION_INCOMPLETE');
      totals.set(item.orderLineItemId, (totals.get(item.orderLineItemId) ?? 0) + item.quantity);
    }
    if (Array.from(totals).some(([id, qty]) => {
      const projection = byLine.get(id)?.projection;
      return !projection || qty + (otherDrafts.get(id) ?? 0) > Math.min(projection.remainingQuantity, projection.readyWaitingQuantity);
    })) throw new FulfillmentHttpError(409,
      'Shipment quantities are no longer ready and unreserved. Review the draft before buying labels.', 'UPS_ALLOCATION_INCOMPLETE');
    const estimateCents = cents(rate.total);
    if (estimateCents == null) throw new FulfillmentHttpError(409, 'UPS rate amount is invalid. Get fresh rates.', 'UPS_RATE_STALE');
    const [created] = await tx.insert(upsLabelPurchases).values({ organizationId: orgId, shipmentId, quoteId: quote.id,
      environment: credentials.row.mode,
      serviceCode: rate.serviceCode, serviceName: rate.serviceName, estimateCents, estimateCurrency: rate.currency,
      providerTransactionId: randomUUID().replace(/-/g, ''), requestFingerprint: fingerprint,
      createdByUserId: actorUserId ?? null }).returning();
    return created;
  });
  // No automatic retry after this point. UPS does not document a create-shipment idempotency guarantee for transId.
  let response: Response;
  try {
    response = await fetch(`${credentials.baseUrl}/api/shipments/v2409/ship`, { method: 'POST', signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${credentials.token}`, 'Content-Type': 'application/json', Accept: 'application/json',
        transId: attempt.providerTransactionId, transactionSrc: 'PrintersHero' },
      body: JSON.stringify(buildUpsLabelRequest({ origin: details.origin, sender: details.sender, destination: details.destination,
        accountNumber: credentials.accountNumber, serviceCode: input.serviceCode,
        packages: details.packages.map(pkg => ({ ...pkg,
          packageReference: details.shipment.packages.find(saved => saved.id === pkg.id)?.packageReference })) })) });
  } catch {
    await markUncertain(orgId, attempt.id, 'UPS_NETWORK_UNCERTAIN').catch(() => undefined);
    throw new FulfillmentHttpError(409, 'UPS purchase outcome is unknown. Do not buy again; inspect UPS account activity and this attempt.', 'UPS_PURCHASE_UNCERTAIN');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    // Even a provider error is retained; only explicit validation/auth rejection is safe to retry after a fresh quote.
    if ([400, 401, 403, 422].includes(response.status)) {
      await db.update(upsLabelPurchases).set({ status: 'REJECTED', errorCode: `UPS_HTTP_${response.status}`, updatedAt: new Date() })
        .where(and(eq(upsLabelPurchases.organizationId, orgId), eq(upsLabelPurchases.id, attempt.id)));
      throw new FulfillmentHttpError(response.status === 401 || response.status === 403 ? 409 : 422,
        response.status === 401 || response.status === 403 ? 'UPS authorization failed. Reconnect in Shipping Settings before requesting fresh rates.'
          : 'UPS rejected the label request. Check the addresses, package details, and account permissions; request fresh rates.', 'UPS_PURCHASE_REJECTED');
    }
    await markUncertain(orgId, attempt.id, `UPS_HTTP_${response.status}`).catch(() => undefined);
    throw new FulfillmentHttpError(409, 'UPS purchase response is uncertain. Do not buy again; inspect the UPS account.', 'UPS_PURCHASE_UNCERTAIN');
  }
  const normalized = normalizeUpsPurchase(body, details.packages.length);
  if (!normalized) {
    const results = object(object(body).ShipmentResponse).ShipmentResults;
    await markUncertain(orgId, attempt.id, 'UPS_RESPONSE_INCOMPLETE', { providerShipmentId: str(object(results).ShipmentIdentificationNumber),
      response: object(body) }).catch(() => undefined);
    throw new FulfillmentHttpError(409, 'UPS accepted the request but tracking, cost, or labels were incomplete. Do not buy again; investigate this attempt.', 'UPS_PURCHASE_UNCERTAIN');
  }
  if (attempt.environment === 'live' && (isUpsPlaceholderTracking(normalized.providerShipmentId) ||
    normalized.labels.some(label => isUpsPlaceholderTracking(label.trackingNumber)))) {
    await markUncertain(orgId, attempt.id, 'UPS_LIVE_PLACEHOLDER_TRACKING', {
      providerShipmentId: normalized.providerShipmentId, trackingNumbers: normalized.labels.map(label => label.trackingNumber),
      response: object(body) }).catch(() => undefined);
    throw new FulfillmentHttpError(409, 'UPS returned sample tracking from the live endpoint. Do not buy again; investigate this attempt with UPS.', 'UPS_PURCHASE_UNCERTAIN');
  }
  try {
    await persistUpsPurchase(orgId, attempt, normalized, details.packages.map(pkg => pkg.id), actorUserId);
  } catch {
    await markUncertain(orgId, attempt.id, 'LOCAL_PERSISTENCE_UNCERTAIN', { providerShipmentId: normalized.providerShipmentId,
      trackingNumbers: normalized.labels.map(label => label.trackingNumber), response: object(body) }).catch(() => undefined);
    throw new FulfillmentHttpError(409, 'UPS returned a purchased label, but local recording needs recovery. Do not buy again; contact support with the shown attempt ID.', 'UPS_LOCAL_RECOVERY_REQUIRED');
  }
  return { attemptId: attempt.id, environment: attempt.environment, providerShipmentId: normalized.providerShipmentId,
    carrierCostCents: normalized.carrierCostCents, carrierCurrency: normalized.carrierCurrency,
    mappingRequired: details.packages.length > 1,
    labels: normalized.labels.map((label, i) => ({ packageId: details.packages.length === 1 ? details.packages[i].id : null,
      trackingNumber: label.trackingNumber })) };
}

/** Replays a previously captured provider response only; never calls UPS shipment creation again. */
export async function recoverRecordedUpsPurchase(orgId: string, shipmentId: string, purchaseId: string, actorUserId?: string | null) {
  const [attempt] = await db.select().from(upsLabelPurchases).where(and(eq(upsLabelPurchases.organizationId, orgId),
    eq(upsLabelPurchases.shipmentId, shipmentId), eq(upsLabelPurchases.id, purchaseId))).limit(1);
  if (!attempt) throw new FulfillmentHttpError(404, 'UPS attempt not found.', 'NOT_FOUND');
  if (attempt.status !== 'UNCERTAIN') throw new FulfillmentHttpError(409, 'Only an uncertain attempt can be recovered.', 'UPS_RECOVERY_UNAVAILABLE');
  const response = object(attempt.providerEvidence).response;
  const packages = await db.select({ id: shipmentPackages.id }).from(shipmentPackages).where(and(
    eq(shipmentPackages.organizationId, orgId), eq(shipmentPackages.shipmentId, shipmentId))).orderBy(shipmentPackages.ordinal);
  const normalized = normalizeUpsPurchase(response, packages.length);
  if (!normalized) throw new FulfillmentHttpError(409,
    'No complete UPS purchase response is saved. Verify this attempt in the UPS account before any replacement.', 'UPS_MANUAL_RECOVERY_REQUIRED');
  if (attempt.environment === 'live' && (isUpsPlaceholderTracking(normalized.providerShipmentId) ||
    normalized.labels.some(label => isUpsPlaceholderTracking(label.trackingNumber))))
    throw new FulfillmentHttpError(409, 'A live UPS attempt returned sample tracking. Investigate with UPS before recovery.', 'UPS_MANUAL_RECOVERY_REQUIRED');
  await persistUpsPurchase(orgId, attempt, normalized, packages.map(pkg => pkg.id), actorUserId);
  return { attemptId: attempt.id, status: packages.length > 1 ? 'MAPPING_REQUIRED' as const : 'PURCHASED' as const };
}

export async function readUpsPackageLabel(orgId: string, shipmentId: string, purchaseId: string, packageId: string) {
  const [row] = await db.select({ labelBytes: upsPackageLabels.labelBytes, labelFormat: upsPackageLabels.labelFormat,
    trackingNumber: upsPackageLabels.trackingNumber }).from(upsPackageLabels)
    .innerJoin(upsLabelPurchases, eq(upsPackageLabels.purchaseId, upsLabelPurchases.id))
    .where(and(eq(upsPackageLabels.organizationId, orgId), eq(upsLabelPurchases.organizationId, orgId),
      eq(upsLabelPurchases.id, purchaseId), eq(upsLabelPurchases.shipmentId, shipmentId), eq(upsPackageLabels.packageId, packageId))).limit(1);
  if (!row) throw new FulfillmentHttpError(404, 'UPS label not found.', 'NOT_FOUND');
  return { bytes: Buffer.from(row.labelBytes), mimeType: 'image/gif' as const, trackingNumber: row.trackingNumber };
}

/** Read an unassigned provider label without assuming UPS preserved request order. */
export async function readUpsLabelEvidence(orgId: string, shipmentId: string, purchaseId: string, labelId: string) {
  const [row] = await db.select({ labelBytes: upsPackageLabels.labelBytes,
    trackingNumber: upsPackageLabels.trackingNumber }).from(upsPackageLabels)
    .innerJoin(upsLabelPurchases, eq(upsPackageLabels.purchaseId, upsLabelPurchases.id))
    .where(and(eq(upsPackageLabels.organizationId, orgId), eq(upsLabelPurchases.organizationId, orgId),
      eq(upsLabelPurchases.id, purchaseId), eq(upsLabelPurchases.shipmentId, shipmentId),
      eq(upsPackageLabels.id, labelId))).limit(1);
  if (!row) throw new FulfillmentHttpError(404, 'UPS label not found.', 'NOT_FOUND');
  return { bytes: Buffer.from(row.labelBytes), mimeType: 'image/gif' as const, trackingNumber: row.trackingNumber };
}

export async function readUpsLabelArchive(orgId: string, shipmentId: string, purchaseId: string) {
  const [purchase] = await db.select({ status: upsLabelPurchases.status,
    environment: upsLabelPurchases.environment }).from(upsLabelPurchases).where(and(
    eq(upsLabelPurchases.organizationId, orgId), eq(upsLabelPurchases.shipmentId, shipmentId),
    eq(upsLabelPurchases.id, purchaseId))).limit(1);
  if (!purchase || purchase.status !== 'PURCHASED' || purchase.environment !== 'live')
    throw new FulfillmentHttpError(409, 'Only verified live, active UPS labels can be downloaded as a shipping set.', 'UPS_LABEL_NOT_PRINTABLE');
  const [labels, packages] = await Promise.all([
    db.select({ packageId: upsPackageLabels.packageId, trackingNumber: upsPackageLabels.trackingNumber,
      bytes: upsPackageLabels.labelBytes }).from(upsPackageLabels).where(and(
      eq(upsPackageLabels.organizationId, orgId), eq(upsPackageLabels.purchaseId, purchaseId))),
    db.select({ id: shipmentPackages.id, ordinal: shipmentPackages.ordinal,
      reference: shipmentPackages.packageReference }).from(shipmentPackages).where(and(
      eq(shipmentPackages.organizationId, orgId), eq(shipmentPackages.shipmentId, shipmentId))),
  ]);
  const byId = new Map(packages.map(pkg => [pkg.id, pkg]));
  if (!labels.length || labels.length !== packages.length ||
    labels.some(label => !label.packageId || !byId.has(label.packageId) || isUpsPlaceholderTracking(label.trackingNumber)) ||
    new Set(labels.map(label => label.packageId)).size !== labels.length)
    throw new FulfillmentHttpError(409, 'Box labels are incomplete. Verify the mapping before downloading.', 'UPS_MAPPING_INCOMPLETE');
  return labels.map(label => ({ ...label, package: byId.get(label.packageId!)! }))
    .sort((a, b) => a.package.ordinal - b.package.ordinal);
}

export function hasCompleteUpsBoxMapping(labels: Array<{ id: string; packageId: string | null }>,
  packages: Array<{ id: string }>, assignments: Array<{ labelId: string; packageId: string }>) {
  if (labels.length < 2 || labels.length !== packages.length || assignments.length !== labels.length ||
    labels.some(label => label.packageId)) return false;
  const savedLabelIds = new Set(labels.map(label => label.id));
  const savedPackageIds = new Set(packages.map(pkg => pkg.id));
  return new Set(assignments.map(item => item.labelId)).size === labels.length &&
    new Set(assignments.map(item => item.packageId)).size === packages.length &&
    assignments.every(item => savedLabelIds.has(item.labelId) && savedPackageIds.has(item.packageId));
}

/** A completed provider purchase stays locked until every distinct label is
 * matched to one saved physical box. This operation never calls UPS. */
export async function verifyUpsPackageLabelMapping(orgId: string, shipmentId: string, purchaseId: string,
  actorUserId: string, assignments: Array<{ labelId: string; packageId: string }>) {
  return db.transaction(async tx => {
    const [shipment] = await tx.select({ status: shipments.status }).from(shipments).where(and(
      eq(shipments.organizationId, orgId), eq(shipments.id, shipmentId))).for('update').limit(1);
    if (shipment?.status !== 'DRAFT') throw new FulfillmentHttpError(409,
      'Only a DRAFT shipment can verify box labels.', 'UPS_MAPPING_UNAVAILABLE');
    const [purchase] = await tx.select({ status: upsLabelPurchases.status,
      providerShipmentId: upsLabelPurchases.providerShipmentId }).from(upsLabelPurchases).where(and(
      eq(upsLabelPurchases.organizationId, orgId), eq(upsLabelPurchases.shipmentId, shipmentId),
      eq(upsLabelPurchases.id, purchaseId))).for('update').limit(1);
    if (purchase?.status !== 'MAPPING_REQUIRED' || !purchase.providerShipmentId)
      throw new FulfillmentHttpError(409, 'This purchase is not awaiting box mapping.', 'UPS_MAPPING_UNAVAILABLE');
    const [labels, packages] = await Promise.all([
      tx.select({ id: upsPackageLabels.id, packageId: upsPackageLabels.packageId,
        trackingNumber: upsPackageLabels.trackingNumber }).from(upsPackageLabels).where(and(
        eq(upsPackageLabels.organizationId, orgId), eq(upsPackageLabels.purchaseId, purchaseId))),
      tx.select({ id: shipmentPackages.id, ordinal: shipmentPackages.ordinal }).from(shipmentPackages).where(and(
        eq(shipmentPackages.organizationId, orgId), eq(shipmentPackages.shipmentId, shipmentId))),
    ]);
    if (!hasCompleteUpsBoxMapping(labels, packages, assignments))
      throw new FulfillmentHttpError(409,
        'Match every saved UPS label to one distinct box, then reload if the package set changed.', 'UPS_MAPPING_INCOMPLETE');
    for (const assignment of assignments) await tx.update(upsPackageLabels)
      .set({ packageId: assignment.packageId }).where(and(eq(upsPackageLabels.organizationId, orgId),
        eq(upsPackageLabels.purchaseId, purchaseId), eq(upsPackageLabels.id, assignment.labelId)));
    const firstPackage = [...packages].sort((a, b) => a.ordinal - b.ordinal)[0];
    const firstLabelId = assignments.find(item => item.packageId === firstPackage.id)!.labelId;
    const trackingNumber = labels.find(label => label.id === firstLabelId)!.trackingNumber;
    await tx.update(upsLabelPurchases).set({ status: 'PURCHASED', updatedAt: new Date() }).where(and(
      eq(upsLabelPurchases.organizationId, orgId), eq(upsLabelPurchases.id, purchaseId)));
    await tx.update(shipments).set({ trackingNumber, updatedAt: new Date() }).where(and(
      eq(shipments.organizationId, orgId), eq(shipments.id, shipmentId), eq(shipments.status, 'DRAFT')));
    await tx.insert(fulfillmentEvents).values({ organizationId: orgId, actorUserId,
      entityType: 'SHIPMENT', entityId: shipmentId, eventType: 'SHIPMENT_UPDATED',
      payloadJson: { action: 'ups_package_labels_mapped', purchaseId, assignments,
        providerShipmentId: purchase.providerShipmentId } });
    return { status: 'PURCHASED' as const, trackingNumber };
  });
}

export async function voidUpsLabel(orgId: string, purchaseId: string, actorUserId?: string | null) {
  // Authentication failure must leave the purchased label eligible for a later void attempt.
  const credentials = await upsRateCredentials(orgId);
  const [candidate] = await db.select({ shipmentId: upsLabelPurchases.shipmentId,
    environment: upsLabelPurchases.environment }).from(upsLabelPurchases).where(and(
    eq(upsLabelPurchases.organizationId, orgId), eq(upsLabelPurchases.id, purchaseId))).limit(1);
  if (!candidate) throw new FulfillmentHttpError(404, 'UPS purchase not found.', 'NOT_FOUND');
  if (!isOriginalUpsEnvironment(candidate.environment, credentials.row.mode)) throw new FulfillmentHttpError(409,
    'This label belongs to a different or unverified UPS environment. Reconnect to its original environment or investigate it with UPS.', 'UPS_VOID_ENVIRONMENT_MISMATCH');
  const attempt = await db.transaction(async tx => {
    // Match Mark as Shipped's shipment-first lock order. A simultaneous
    // dispatch cannot pass the purchased-label check while voiding begins.
    const [shipment] = await tx.select({ status: shipments.status }).from(shipments).where(and(
      eq(shipments.organizationId, orgId), eq(shipments.id, candidate.shipmentId))).for('update').limit(1);
    if (shipment?.status !== 'DRAFT') throw new FulfillmentHttpError(409,
      'A shipped label cannot be voided from this workflow. Use carrier support and the authorized reversal process.', 'UPS_VOID_UNAVAILABLE');
    const [row] = await tx.select().from(upsLabelPurchases).where(and(eq(upsLabelPurchases.organizationId, orgId),
      eq(upsLabelPurchases.id, purchaseId))).for('update').limit(1);
    if (!row || row.shipmentId !== candidate.shipmentId) throw new FulfillmentHttpError(404, 'UPS purchase not found.', 'NOT_FOUND');
    if (!isOriginalUpsEnvironment(row.environment, credentials.row.mode)) throw new FulfillmentHttpError(409,
      'UPS environment changed. Reconnect to the label’s original environment before voiding.', 'UPS_VOID_ENVIRONMENT_MISMATCH');
    if (!['PURCHASED', 'MAPPING_REQUIRED'].includes(row.status) || !row.providerShipmentId) throw new FulfillmentHttpError(409,
      'Only a confirmed, unused UPS label can be voided. Investigate uncertain attempts separately.', 'UPS_VOID_UNAVAILABLE');
    await tx.update(upsLabelPurchases).set({ status: 'VOID_REQUESTING', voidRequestedAt: new Date(),
      errorCode: null, updatedAt: new Date() })
      .where(eq(upsLabelPurchases.id, row.id));
    await tx.insert(fulfillmentEvents).values({ organizationId: orgId, actorUserId: actorUserId ?? null,
      entityType: 'SHIPMENT', entityId: row.shipmentId, eventType: 'SHIPMENT_UPDATED',
      payloadJson: { action: 'ups_label_void_requested', purchaseId, providerShipmentId: row.providerShipmentId } });
    return row;
  });
  let response: Response;
  try {
    response = await fetch(`${credentials.baseUrl}/api/shipments/v2409/void/cancel/${encodeURIComponent(attempt.providerShipmentId!)}`,
      { method: 'DELETE', signal: AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${credentials.token}`,
        Accept: 'application/json', transId: randomUUID().replace(/-/g, ''), transactionSrc: 'PrintersHero' } });
  } catch {
    await db.transaction(async tx => {
      await tx.update(upsLabelPurchases).set({ status: 'VOID_UNCERTAIN', errorCode: 'UPS_VOID_NETWORK_UNCERTAIN', updatedAt: new Date() })
        .where(and(eq(upsLabelPurchases.organizationId, orgId), eq(upsLabelPurchases.id, purchaseId)));
      await tx.insert(fulfillmentEvents).values({ organizationId: orgId, actorUserId: actorUserId ?? null,
        entityType: 'SHIPMENT', entityId: attempt.shipmentId, eventType: 'SHIPMENT_UPDATED',
        payloadJson: { action: 'ups_label_void_outcome_uncertain', purchaseId, reason: 'network' } });
    }).catch(() => undefined);
    throw new FulfillmentHttpError(409, 'UPS void outcome is unknown. Do not buy a replacement until carrier status is verified.', 'UPS_VOID_UNCERTAIN');
  }
  const voidBody = await response.json().catch(() => null);
  const outcome = classifyUpsVoidResponse(response.status, voidBody);
  if (outcome !== 'ACCEPTED') {
    const uncertain = outcome === 'UNCERTAIN';
    const providerErrors = array(object(object(voidBody).response).errors);
    const voidProviderCode = str(object(providerErrors[0]).code).slice(0, 80) || null;
    await db.transaction(async tx => {
      await tx.update(upsLabelPurchases).set({ status: uncertain ? 'VOID_UNCERTAIN' : attempt.status,
        errorCode: `UPS_VOID_HTTP_${response.status}`,
        providerEvidence: { ...object(attempt.providerEvidence), voidHttpStatus: response.status, voidProviderCode },
        updatedAt: new Date() })
        .where(and(eq(upsLabelPurchases.organizationId, orgId), eq(upsLabelPurchases.id, purchaseId)));
      await tx.insert(fulfillmentEvents).values({ organizationId: orgId, actorUserId: actorUserId ?? null,
        entityType: 'SHIPMENT', entityId: attempt.shipmentId, eventType: 'SHIPMENT_UPDATED',
        payloadJson: { action: uncertain ? 'ups_label_void_outcome_uncertain' : 'ups_label_void_rejected',
          purchaseId, providerShipmentId: attempt.providerShipmentId, httpStatus: response.status } });
    }).catch(() => undefined);
    throw new FulfillmentHttpError(409, uncertain
      ? 'UPS void outcome is unknown. Inspect the carrier account before replacement.'
      : 'UPS rejected the void. The labels remain active; review eligibility and retry or record an external cancellation.',
      uncertain ? 'UPS_VOID_UNCERTAIN' : 'UPS_VOID_REJECTED');
  }
  try {
    await db.transaction(async tx => {
      const [updated] = await tx.update(upsLabelPurchases).set({ status: 'VOID_ACCEPTED', voidAcceptedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(upsLabelPurchases.organizationId, orgId), eq(upsLabelPurchases.id, purchaseId),
          eq(upsLabelPurchases.status, 'VOID_REQUESTING'))).returning({ id: upsLabelPurchases.id });
      if (!updated) throw new Error('UPS void attempt changed during recording');
      await tx.insert(fulfillmentEvents).values({ organizationId: orgId, actorUserId: actorUserId ?? null,
        entityType: 'SHIPMENT', entityId: attempt.shipmentId, eventType: 'SHIPMENT_UPDATED',
        payloadJson: { action: 'ups_label_void_accepted', purchaseId, providerShipmentId: attempt.providerShipmentId,
          carrierCreditConfirmed: false } });
    });
  } catch {
    await db.update(upsLabelPurchases).set({ status: 'VOID_UNCERTAIN', errorCode: 'UPS_VOID_LOCAL_RECORDING_FAILED', updatedAt: new Date() })
      .where(and(eq(upsLabelPurchases.organizationId, orgId), eq(upsLabelPurchases.id, purchaseId),
        eq(upsLabelPurchases.status, 'VOID_REQUESTING'))).catch(() => undefined);
    throw new FulfillmentHttpError(409, 'UPS accepted the void, but local recording needs review. Do not buy a replacement yet.', 'UPS_VOID_UNCERTAIN');
  }
  return { status: 'VOID_ACCEPTED', carrierCreditConfirmed: false };
}

/** Operator evidence only. Does not call UPS, refund carrier cost, or reverse fulfilled quantities. */
export async function reportExternalUpsCancellation(orgId: string, shipmentId: string, purchaseId: string,
  actorUserId: string, input: { reason: string; reference?: string | null }) {
  return db.transaction(async tx => {
    await tx.select({ id: shipments.id }).from(shipments).where(and(eq(shipments.organizationId, orgId),
      eq(shipments.id, shipmentId))).for('update').limit(1);
    const [row] = await tx.select().from(upsLabelPurchases).where(and(eq(upsLabelPurchases.organizationId, orgId),
      eq(upsLabelPurchases.shipmentId, shipmentId), eq(upsLabelPurchases.id, purchaseId))).for('update').limit(1);
    if (!row) throw new FulfillmentHttpError(404, 'UPS purchase not found.', 'NOT_FOUND');
    if (!['PURCHASED', 'MAPPING_REQUIRED', 'VOID_UNCERTAIN'].includes(row.status)) throw new FulfillmentHttpError(409,
      'Only an active or unresolved purchased label can be reported canceled externally.', 'UPS_EXTERNAL_CANCEL_UNAVAILABLE');
    if (row.carrierCostCents == null || !row.providerShipmentId) throw new FulfillmentHttpError(409,
      'The original purchase needs carrier investigation before reporting external cancellation.', 'UPS_EXTERNAL_CANCEL_UNAVAILABLE');
    const now = new Date();
    const [updated] = await tx.update(upsLabelPurchases).set({ status: 'EXTERNAL_CANCEL_REPORTED',
      externalCanceledAt: now, externalCanceledByUserId: actorUserId,
      externalCancelReason: input.reason.trim(), externalCancelReference: input.reference?.trim() || null,
      updatedAt: now }).where(and(eq(upsLabelPurchases.organizationId, orgId), eq(upsLabelPurchases.id, purchaseId)))
      .returning({ id: upsLabelPurchases.id, status: upsLabelPurchases.status });
    await tx.insert(fulfillmentEvents).values({ organizationId: orgId, actorUserId,
      entityType: 'SHIPMENT', entityId: shipmentId, eventType: 'SHIPMENT_UPDATED',
      payloadJson: { action: 'ups_external_cancellation_reported', purchaseId,
        reason: input.reason.trim(), reference: input.reference?.trim() || null, carrierCreditConfirmed: false } });
    return updated;
  });
}

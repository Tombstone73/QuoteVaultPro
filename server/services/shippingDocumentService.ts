import { and, asc, eq, inArray } from "drizzle-orm";
import { companySettings, customers, materials, orderLineItems, orders, organizations, shipmentItems, shipmentOrders, shipmentPackages, shipments } from "@shared/schema";
import { shipmentDateValue } from "@shared/fulfillmentVerification";
import { shipmentShippingContextSchema, shippingDocumentSourceSchema, shippingPartyValidationErrors, type ShippingDocumentLine, type ShippingDocumentSource, type ShippingParty } from "@shared/shippingDocuments";
import { db } from "../db";
import { collectLineItemProductionMaterialIds, resolveLineItemMaterialDisplayLabel } from "../routes/flatStockNesting.shared";
import { resolveShipmentShippingContext } from "./fulfillment/shippingContext";
import { FulfillmentHttpError } from "./fulfillment/types";

function sourceError(status: number, code: string, message: string): FulfillmentHttpError {
  return new FulfillmentHttpError(status, message, code);
}

const clean = (value: unknown): string | null => value == null ? null : String(value).trim() || null;

/** Read-only source. Shipping calls this with its locked transaction before saving the snapshot. */
export async function getShippingDocumentSource(
  orgId: string,
  shipmentId: string,
  executor: typeof db = db,
  options?: { captureForShipping?: boolean },
): Promise<ShippingDocumentSource> {
  if (executor === db && !options?.captureForShipping) {
    // Preview and enqueue must observe one saved revision across all source reads.
    return db.transaction(
      (tx) => getShippingDocumentSource(orgId, shipmentId, tx as unknown as typeof db, options),
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  }
  const [shipment] = await executor.select().from(shipments)
    .where(and(eq(shipments.organizationId, orgId), eq(shipments.id, shipmentId))).limit(1);
  if (!shipment) throw sourceError(404, "SHIPMENT_NOT_FOUND", "Shipment not found.");

  // Never reconstruct historical facts from mutable Orders, Customers or catalog data.
  if (shipment.status === "SHIPPED") {
    const saved = shippingDocumentSourceSchema.safeParse(shipment.documentSnapshot);
    if (!saved.success || saved.data.basis !== "shipped" || saved.data.organizationId !== orgId || saved.data.shipmentId !== shipmentId
      || (saved.data.blindShipping && shippingPartyValidationErrors(saved.data.sender).length)) {
      throw sourceError(409, "HISTORICAL_SNAPSHOT_UNAVAILABLE", "Historical shipping document snapshot unavailable.");
    }
    return saved.data;
  }
  if (shipment.status !== "DRAFT") throw sourceError(409, "INVALID_SHIPMENT_STATE", "Documents are unavailable for a voided shipment.");

  const links = await executor.select({ orderId: shipmentOrders.orderId }).from(shipmentOrders)
    .where(and(eq(shipmentOrders.organizationId, orgId), eq(shipmentOrders.shipmentId, shipmentId)));
  const orderIds = Array.from(new Set(links.map((link) => link.orderId)));
  if (!orderIds.length) throw sourceError(409, "SHIPPING_SOURCE_INVALID", "Shipment has no linked Orders.");
  const orderRows = await executor.select({
    id: orders.id, orderNumber: orders.orderNumber, displayNumber: orders.displayNumber,
    customerId: orders.customerId, customerName: customers.companyName, poNumber: orders.poNumber,
  }).from(orders)
    .leftJoin(customers, and(eq(customers.id, orders.customerId), eq(customers.organizationId, orgId)))
    .where(and(eq(orders.organizationId, orgId), inArray(orders.id, orderIds))).orderBy(asc(orders.orderNumber));
  if (orderRows.length !== orderIds.length) throw sourceError(409, "SHIPPING_SOURCE_INVALID", "A linked Order is unavailable in this organization.");

  const context = shipment.shippingContext == null
    ? await resolveShipmentShippingContext(orgId, orderIds, executor)
    : shipmentShippingContextSchema.parse(shipment.shippingContext);
  if (context.sourceOrderId && !orderIds.includes(context.sourceOrderId)) {
    throw sourceError(409, "SHIPPING_SOURCE_INVALID", "Shipping context must belong to a linked Order.");
  }
  if (options?.captureForShipping) {
    const missing = shippingPartyValidationErrors(context.destination);
    if (missing.length) throw sourceError(409, "SHIPPING_DESTINATION_REQUIRED", `Ship To is missing ${missing.join(", ")}.`);
  }

  let sender: ShippingParty;
  if (context.blindShipping) {
    if (!context.blindSender || shippingPartyValidationErrors(context.blindSender).length) {
      throw sourceError(409, "BLIND_SENDER_REQUIRED", "Blind shipping requires a confirmed alternate sender identity and address.");
    }
    sender = context.blindSender;
  } else {
    const [settings] = await executor.select().from(companySettings).where(eq(companySettings.organizationId, orgId)).limit(1);
    const [organization] = await executor.select({ name: organizations.name, settings: organizations.settings }).from(organizations)
      .where(eq(organizations.id, orgId)).limit(1);
    if (!organization) throw sourceError(404, "ORGANIZATION_NOT_FOUND", "Organization not found.");
    const address = settings?.physicalAddress;
    const structured = address && Object.values(address).some((value) => Boolean(clean(value)));
    sender = {
      name: null, company: clean(settings?.companyDisplayName) ?? clean(settings?.companyName) ?? clean(organization.settings?.branding?.companyName) ?? organization.name,
      address1: structured ? clean(address.line1) : clean(settings?.address), address2: structured ? clean(address.line2) : null,
      city: clean(address?.city), state: clean(address?.state), postalCode: clean(address?.postalCode), country: clean(address?.country),
      phone: clean(settings?.phone), email: clean(settings?.email),
    };
  }

  const allocations = await executor.select().from(shipmentItems)
    .where(and(eq(shipmentItems.organizationId, orgId), eq(shipmentItems.shipmentId, shipmentId))).orderBy(asc(shipmentItems.createdAt), asc(shipmentItems.id));
  const packageRows = await executor.select().from(shipmentPackages)
    .where(and(eq(shipmentPackages.organizationId, orgId), eq(shipmentPackages.shipmentId, shipmentId))).orderBy(asc(shipmentPackages.ordinal));
  const lineIds = Array.from(new Set(allocations.map((item) => item.orderLineItemId)));
  const lineRows = lineIds.length ? await executor.select({
    id: orderLineItems.id, orderId: orderLineItems.orderId, description: orderLineItems.description,
    width: orderLineItems.width, height: orderLineItems.height, materialId: orderLineItems.materialId,
    pbv2SnapshotJson: orderLineItems.pbv2SnapshotJson, materialUsageJson: orderLineItems.materialUsageJson,
    materialUsages: orderLineItems.materialUsages, specsJson: orderLineItems.specsJson,
    optionSelectionsJson: orderLineItems.optionSelectionsJson, selectedOptions: orderLineItems.selectedOptions,
  }).from(orderLineItems).innerJoin(orders, and(eq(orders.id, orderLineItems.orderId), eq(orders.organizationId, orgId)))
    .where(and(inArray(orderLineItems.id, lineIds), inArray(orderLineItems.orderId, orderIds))) : [];
  const materialIds = Array.from(new Set(lineRows.flatMap((line) => collectLineItemProductionMaterialIds({ lineItem: line }))));
  const materialRows = materialIds.length ? await executor.select({ id: materials.id, name: materials.name }).from(materials)
    .where(and(eq(materials.organizationId, orgId), inArray(materials.id, materialIds))) : [];
  const materialById = new Map(materialRows.map((material) => [material.id, material.name]));
  const lineById = new Map(lineRows.map((line) => [line.id, line]));
  const packageIds = new Set(packageRows.map((pkg) => pkg.id));
  const allocatedLines = allocations.map((allocation) => {
    const line = lineById.get(allocation.orderLineItemId);
    if (!line || line.orderId !== allocation.orderId || !orderIds.includes(allocation.orderId)
      || (allocation.packageId && !packageIds.has(allocation.packageId)) || !Number.isInteger(allocation.quantity) || allocation.quantity <= 0) {
      throw sourceError(409, "SHIPPING_SOURCE_INVALID", "A saved allocation does not belong to this shipment's Orders and packages.");
    }
    const documentLine: ShippingDocumentLine = {
      orderId: line.orderId, orderLineItemId: line.id, description: line.description,
      quantity: allocation.quantity,
      size: clean(line.width) && clean(line.height) ? `${line.width}" x ${line.height}"` : null,
      material: resolveLineItemMaterialDisplayLabel({ lineItem: line })
        ?? resolveLineItemMaterialDisplayLabel({ lineItem: line, materialName: line.materialId ? materialById.get(line.materialId) : null, materialById }),
    };
    return { packageId: allocation.packageId, line: documentLine };
  });
  const totals = new Map<string, ShippingDocumentLine>();
  for (const { line } of allocatedLines) {
    const previous = totals.get(line.orderLineItemId);
    if (previous) previous.quantity += line.quantity;
    else totals.set(line.orderLineItemId, { ...line });
  }
  const now = new Date();
  const shipDate = shipmentDateValue(shipment.shipDate ?? (options?.captureForShipping ? now : null));
  const source: ShippingDocumentSource = {
    version: 1, basis: options?.captureForShipping ? "shipped" : "draft", capturedAt: now.toISOString(),
    organizationId: orgId, shipmentId, shipmentReference: shipment.shipmentReference ?? shipmentId,
    shipDate: shipDate?.toISOString().slice(0, 10) ?? null,
    carrier: shipment.carrier, serviceLevel: shipment.serviceLevel, trackingNumber: shipment.trackingNumber,
    destination: context.destination, blindShipping: context.blindShipping, sender,
    orders: orderRows.map((order) => ({
      id: order.id, orderNumber: order.displayNumber ?? order.orderNumber, customerId: order.customerId,
      customerName: order.customerName, poNumber: order.poNumber,
    })),
    lines: Array.from(totals.values()),
    packages: packageRows.map((pkg) => ({
      id: pkg.id, ordinal: pkg.ordinal, packageReference: pkg.packageReference,
      weightLbs: pkg.weightLbs, dimLengthIn: pkg.dimLengthIn, dimWidthIn: pkg.dimWidthIn, dimHeightIn: pkg.dimHeightIn,
      internalNotes: pkg.notes, lines: allocatedLines.filter((item) => item.packageId === pkg.id).map((item) => item.line),
    })),
    internalNotes: shipment.internalNotes,
  };
  const parsed = shippingDocumentSourceSchema.safeParse(source);
  if (!parsed.success) throw sourceError(409, "SHIPPING_SOURCE_INVALID", "Saved shipping details cannot form a valid document snapshot.");
  return parsed.data;
}

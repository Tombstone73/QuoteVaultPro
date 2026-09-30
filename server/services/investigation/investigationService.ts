import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  customers,
  customerContactLinks,
  customerContacts,
  fileRecords,
  fulfillmentEvents,
  invoices,
  invoiceEmailDeliveryJobs,
  invoiceEmailLogs,
  lineItemArtwork,
  orderAuditLog,
  orderAttachments,
  orderLineItems,
  orders,
  productionEvents,
  productionJobs,
  quotes,
  shipments,
} from "@shared/schema";
import type {
  InvestigationResourceInput,
  InvestigationResourceReference,
  InvestigationResourceType,
  InvestigationSnapshot,
} from "@shared/investigationContracts";
import { investigationResourceTypeValues } from "@shared/investigationContracts";
import { canonicalOrderNumberLookup } from "@shared/documentNumbering";
import { fulfillmentShipmentDetailHref, fulfillmentWorkspaceHref } from "@shared/fulfillmentNavigation";
import type { FulfillmentDetailDto } from "../fulfillment/types";
import { db } from "../../db";

export type InvestigationScope = { organizationId: string; permissions: readonly string[] };
export type InvestigationRelationship = "belongs_to_customer" | "contains_line" | "has_production_job" | "has_fulfillment_workspace" | "fulfills_order" | "invoices_order" | "has_contact" | "originated_from_quote" | "has_artwork" | "supersedes_artwork";
export type InvestigationEdge = { from: InvestigationResourceReference; to: InvestigationResourceReference; relationship: InvestigationRelationship };
export type InvestigationHistoryEvent = {
  eventId: string;
  occurredAt: string;
  kind: "recorded_event";
  summary: string;
  resource: InvestigationResourceReference;
  provenance: { source: "order_audit_log" | "production_events" | "shipments" | "fulfillment_events" | "invoices" | "invoice_email_logs" | "invoice_email_delivery_jobs" | "line_item_artwork"; recorded: true };
};
export type InvestigationSearchCandidate = { resource: InvestigationResourceReference; summary: string; match: "exact" | "partial" };

/** Explicit, directed graph policy. A future V2 authority resolver can replace
 * the service's grant check without changing descriptors, callers, or SQL. */
export const investigationResourceDescriptors: Readonly<Record<InvestigationResourceType, { relations: readonly InvestigationRelationship[] }>> = Object.freeze({
  order: { relations: ["belongs_to_customer", "contains_line", "has_production_job", "has_fulfillment_workspace", "fulfills_order", "invoices_order", "originated_from_quote", "has_artwork"] },
  customer: { relations: ["belongs_to_customer", "has_contact"] },
  order_line: { relations: ["contains_line", "has_production_job"] },
  production_job: { relations: ["has_production_job", "contains_line"] },
  fulfillment: { relations: ["has_fulfillment_workspace", "fulfills_order"] },
  shipment: { relations: ["fulfills_order"] },
  invoice: { relations: ["invoices_order", "belongs_to_customer"] },
  contact: { relations: ["belongs_to_customer"] },
  quote: { relations: ["belongs_to_customer", "originated_from_quote"] },
  artwork: { relations: ["contains_line", "has_artwork", "supersedes_artwork"] },
});

export interface InvestigationRepository {
  search(organizationId: string, query: string, types: readonly InvestigationResourceType[], limit: number): Promise<InvestigationSearchCandidate[]>;
  get(organizationId: string, resource: InvestigationResourceInput): Promise<InvestigationSnapshot | null>;
  related(organizationId: string, resource: InvestigationResourceInput, relationships?: readonly InvestigationRelationship[]): Promise<InvestigationEdge[]>;
  history(organizationId: string, resource: InvestigationResourceInput, limit: number): Promise<InvestigationHistoryEvent[]>;
}

export class InvestigationAccessError extends Error {
  constructor() { super("permission_denied"); }
}

const iso = (value: Date | string | null | undefined): string | undefined => {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};
const number = (value: string | number | null | undefined) => Number(value ?? 0);
const ref = (type: InvestigationResourceType, id: string, label: string, href: string): InvestigationResourceReference => ({ type, id, label, href });
const orderRef = (id: string, displayNumber: string | number | null, orderNumber?: string | number | null) => ref("order", id, String(displayNumber ?? orderNumber ?? id), `/orders/${id}`);
const customerRef = (id: string, name: string) => ref("customer", id, name, `/customers/${id}`);
const lineRef = (id: string, description: string, orderId: string) => ref("order_line", id, description, `/orders/${orderId}`);
const jobRef = (id: string, orderId: string) => ref("production_job", id, `Production job ${id.slice(0, 8)}`, `/production?jobId=${id}`);
const fulfillmentRef = (orderId: string, orderNumber: string) => ref("fulfillment", orderId, `Fulfillment for ${orderNumber}`, fulfillmentWorkspaceHref(orderId));
const shipmentRef = (id: string, orderId: string, label: string | null) => ref("shipment", id, label || `Shipment ${id.slice(0, 8)}`, fulfillmentShipmentDetailHref(id));
const invoiceRef = (id: string, displayNumber: string | number | null, invoiceNumber: number) => ref("invoice", id, String(displayNumber ?? `Invoice #${invoiceNumber}`), `/invoices/${id}`);
const contactRef = (id: string, fullName: string) => ref("contact", id, fullName, `/customers/contacts/${id}`);
const quoteRef = (id: string, displayNumber: string | number | null, quoteNumber: number | null) => ref("quote", id, String(displayNumber ?? (quoteNumber ? `Quote #${quoteNumber}` : id)), `/quotes/${id}`);
const artworkRef = (id: string, orderId: string, filename: string) => ref("artwork", id, filename, `/orders/${orderId}`);
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

export function toFulfillmentInvestigationSnapshot(detail: FulfillmentDetailDto): InvestigationSnapshot {
  const order = orderRef(detail.orderId, detail.orderNumber, detail.orderNumber);
  return {
    type: "fulfillment",
    resource: fulfillmentRef(detail.orderId, detail.orderNumber),
    current: { status: detail.status },
    order,
    status: detail.status,
    fulfillmentType: detail.fulfillmentType,
    quantities: {
      physicalLineCount: detail.physicalLineCount,
      orderedQuantity: detail.orderedQuantity,
      fulfilledQuantity: detail.fulfilledQuantity,
      shippedQuantity: detail.shippedQuantity,
      pickedUpQuantity: detail.pickedUpQuantity,
      readyWaitingQuantity: detail.readyWaitingQuantity,
      notReadyQuantity: detail.notReadyQuantity,
      remainingQuantity: detail.remainingQuantity,
    },
    pickup: detail.pickupTicket ? {
      status: detail.pickupTicket.status,
      readyAt: detail.pickupTicket.readyAt,
      pickedUpAt: detail.pickupTicket.pickedUpAt,
      handoffCount: detail.pickupHandoffs.length,
    } : null,
    shipments: detail.shipments.slice(0, 20).map((shipment) => shipmentRef(shipment.id, detail.orderId, shipment.shipmentReference)),
  };
}

// Keep the fulfillment read boundary lazy. Investigation's lightweight
// contracts remain usable without eagerly constructing the full fulfillment
// mutation service, while real requests still use that canonical facade.
async function getCanonicalFulfillmentDetail(organizationId: string, orderId: string): Promise<FulfillmentDetailDto | null> {
  const { canonicalFulfillmentOperations } = await import("../fulfillment/canonicalFulfillmentOperations");
  return canonicalFulfillmentOperations.getOrderDetail(organizationId, orderId);
}

export class DrizzleInvestigationRepository implements InvestigationRepository {
  async search(organizationId: string, query: string, types: readonly InvestigationResourceType[], limit: number): Promise<InvestigationSearchCandidate[]> {
    const pattern = `%${escapeLike(query)}%`;
    const canonicalOrder = canonicalOrderNumberLookup(query);
    const requested = new Set(types);
    const rows: InvestigationSearchCandidate[] = [];
    const add = (resource: InvestigationResourceReference, summary: string, values: Array<string | number | null | undefined>) => {
      if (rows.length >= limit) return;
      const normalized = query.trim().toLowerCase();
      rows.push({ resource, summary, match: values.some((value) => String(value ?? "").trim().toLowerCase() === normalized) ? "exact" : "partial" });
    };
    if (requested.has("order")) {
      const records = await db.select({ id: orders.id, orderNumber: orders.orderNumber, displayNumber: orders.displayNumber, status: orders.status, customerName: customers.companyName })
        .from(orders).leftJoin(customers, and(eq(customers.id, orders.customerId), eq(customers.organizationId, organizationId)))
        .where(and(eq(orders.organizationId, organizationId), or(ilike(orders.orderNumber, pattern), ilike(orders.displayNumber, pattern), ilike(customers.companyName, pattern), ...(canonicalOrder ? [eq(orders.orderNumber, canonicalOrder.databaseValue)] : [])))).orderBy(desc(orders.updatedAt)).limit(limit);
      records.forEach((record) => add(orderRef(record.id, record.displayNumber, record.orderNumber), `${record.customerName ?? "Unassigned customer"} · ${record.status}`, [record.orderNumber, record.displayNumber, record.customerName]));
    }
    if (requested.has("customer") && rows.length < limit) {
      const records = await db.select({ id: customers.id, companyName: customers.companyName, status: customers.status }).from(customers)
        .where(and(eq(customers.organizationId, organizationId), ilike(customers.companyName, pattern))).orderBy(asc(customers.companyName)).limit(limit - rows.length);
      records.forEach((record) => add(customerRef(record.id, record.companyName), record.status ?? "customer", [record.companyName]));
    }
    if (requested.has("production_job") && rows.length < limit) {
      const records = await db.select({ id: productionJobs.id, orderId: productionJobs.orderId, status: productionJobs.status, orderNumber: orders.displayNumber })
        .from(productionJobs).innerJoin(orders, and(eq(orders.id, productionJobs.orderId), eq(orders.organizationId, organizationId)))
        .where(and(eq(productionJobs.organizationId, organizationId), or(ilike(productionJobs.id, pattern), ilike(orders.orderNumber, pattern), ilike(orders.displayNumber, pattern)))).orderBy(desc(productionJobs.updatedAt)).limit(limit - rows.length);
      records.forEach((record) => add(jobRef(record.id, record.orderId), `Order ${record.orderNumber ?? record.orderId} · ${record.status}`, [record.id, record.orderNumber]));
    }
    if (requested.has("shipment") && rows.length < limit) {
      const records = await db.select({ id: shipments.id, orderId: shipments.orderId, primaryOrderId: shipments.primaryOrderId, shipmentReference: shipments.shipmentReference, trackingNumber: shipments.trackingNumber, status: shipments.status })
        .from(shipments).where(and(eq(shipments.organizationId, organizationId), or(ilike(shipments.id, pattern), ilike(shipments.shipmentReference, pattern), ilike(shipments.trackingNumber, pattern)))).orderBy(desc(shipments.updatedAt)).limit(limit - rows.length);
      records.filter((record) => record.orderId || record.primaryOrderId).forEach((record) => add(shipmentRef(record.id, record.orderId ?? record.primaryOrderId!, record.shipmentReference), `${record.status}${record.trackingNumber ? ` · ${record.trackingNumber}` : ""}`, [record.id, record.shipmentReference, record.trackingNumber]));
    }
    if (requested.has("invoice") && rows.length < limit) {
      const records = await db.select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber, displayNumber: invoices.displayNumber, status: invoices.status })
        .from(invoices).where(and(eq(invoices.organizationId, organizationId), or(ilike(invoices.id, pattern), ilike(invoices.displayNumber, pattern), sql`cast(${invoices.invoiceNumber} as text) ilike ${pattern}`))).orderBy(desc(invoices.updatedAt)).limit(limit - rows.length);
      records.forEach((record) => add(invoiceRef(record.id, record.displayNumber, record.invoiceNumber), record.status, [record.id, record.displayNumber, record.invoiceNumber]));
    }
    if (requested.has("order_line") && rows.length < limit) {
      const records = await db.select({ id: orderLineItems.id, orderId: orderLineItems.orderId, description: orderLineItems.description, status: orderLineItems.status })
        .from(orderLineItems).innerJoin(orders, and(eq(orders.id, orderLineItems.orderId), eq(orders.organizationId, organizationId)))
        .where(and(eq(orders.organizationId, organizationId), or(ilike(orderLineItems.id, pattern), ilike(orderLineItems.description, pattern)))).orderBy(asc(orderLineItems.sortOrder)).limit(limit - rows.length);
      records.forEach((record) => add(lineRef(record.id, record.description, record.orderId), record.status, [record.id, record.description]));
    }
    if (requested.has("contact") && rows.length < limit) {
      const records = await db.select({ id: customerContacts.id, firstName: customerContacts.firstName, lastName: customerContacts.lastName, title: customerContacts.title, status: customerContacts.status })
        .from(customerContacts).where(and(eq(customerContacts.organizationId, organizationId), or(ilike(customerContacts.firstName, pattern), ilike(customerContacts.lastName, pattern))))
        .orderBy(asc(customerContacts.lastName), asc(customerContacts.firstName)).limit(limit - rows.length);
      records.forEach((record) => { const fullName = `${record.firstName} ${record.lastName}`.trim(); add(contactRef(record.id, fullName), `${record.status}${record.title ? ` · ${record.title}` : ""}`, [record.id, fullName]); });
    }
    if (requested.has("quote") && rows.length < limit) {
      const records = await db.select({ id: quotes.id, quoteNumber: quotes.quoteNumber, displayNumber: quotes.displayNumber, status: quotes.status, customerName: quotes.customerName })
        .from(quotes).where(and(eq(quotes.organizationId, organizationId), or(ilike(quotes.id, pattern), ilike(quotes.displayNumber, pattern), ilike(quotes.customerName, pattern), sql`cast(${quotes.quoteNumber} as text) ilike ${pattern}`)))
        .orderBy(desc(quotes.updatedAt)).limit(limit - rows.length);
      records.forEach((record) => add(quoteRef(record.id, record.displayNumber, record.quoteNumber), `${record.status}${record.customerName ? ` · ${record.customerName}` : ""}`, [record.id, record.quoteNumber, record.displayNumber, record.customerName]));
    }
    if (requested.has("artwork") && rows.length < limit) {
      const records = await db.select({ id: lineItemArtwork.id, orderId: lineItemArtwork.orderId, filename: fileRecords.originalFilename, role: lineItemArtwork.role, status: lineItemArtwork.status })
        .from(lineItemArtwork).innerJoin(fileRecords, and(eq(fileRecords.id, lineItemArtwork.fileRecordId), eq(fileRecords.organizationId, organizationId)))
        .where(and(eq(lineItemArtwork.organizationId, organizationId), or(ilike(lineItemArtwork.id, pattern), ilike(fileRecords.originalFilename, pattern))))
        .orderBy(desc(lineItemArtwork.createdAt)).limit(limit - rows.length);
      records.forEach((record) => add(artworkRef(record.id, record.orderId, record.filename), `${record.role} · ${record.status}`, [record.id, record.filename]));
    }
    return rows;
  }

  async get(organizationId: string, resource: InvestigationResourceInput): Promise<InvestigationSnapshot | null> {
    if (resource.type === "order") {
      const [record] = await db.select({ id: orders.id, orderNumber: orders.orderNumber, displayNumber: orders.displayNumber, status: orders.status, state: orders.state, fulfillmentStatus: orders.fulfillmentStatus, dueDate: orders.dueDate, updatedAt: orders.updatedAt, customerId: customers.id, customerName: customers.companyName }).from(orders).leftJoin(customers, and(eq(customers.id, orders.customerId), eq(customers.organizationId, organizationId))).where(and(eq(orders.organizationId, organizationId), eq(orders.id, resource.id))).limit(1);
      return record ? { type: "order", resource: orderRef(record.id, record.displayNumber, record.orderNumber), current: { status: record.status, ...(iso(record.updatedAt) ? { updatedAt: iso(record.updatedAt)! } : {}) }, orderNumber: String(record.displayNumber ?? record.orderNumber), ...(record.customerId && record.customerName ? { customer: customerRef(record.customerId, record.customerName) } : {}), state: record.state, fulfillmentStatus: record.fulfillmentStatus, ...(iso(record.dueDate) ? { dueDate: iso(record.dueDate)! } : {}) } : null;
    }
    if (resource.type === "customer") {
      const [record] = await db.select({ id: customers.id, companyName: customers.companyName, isActive: customers.isActive, status: customers.status, updatedAt: customers.updatedAt }).from(customers).where(and(eq(customers.organizationId, organizationId), eq(customers.id, resource.id))).limit(1);
      return record ? { type: "customer", resource: customerRef(record.id, record.companyName), current: { ...(record.status ? { status: record.status } : {}), ...(iso(record.updatedAt) ? { updatedAt: iso(record.updatedAt)! } : {}) }, companyName: record.companyName, active: record.isActive } : null;
    }
    if (resource.type === "order_line") {
      const [record] = await db.select({ id: orderLineItems.id, orderId: orderLineItems.orderId, description: orderLineItems.description, quantity: orderLineItems.quantity, status: orderLineItems.status, workflowState: orderLineItems.workflowState, updatedAt: orderLineItems.updatedAt, orderNumber: orders.orderNumber, displayNumber: orders.displayNumber }).from(orderLineItems).innerJoin(orders, and(eq(orders.id, orderLineItems.orderId), eq(orders.organizationId, organizationId))).where(and(eq(orders.organizationId, organizationId), eq(orderLineItems.id, resource.id))).limit(1);
      return record ? { type: "order_line", resource: lineRef(record.id, record.description, record.orderId), current: { status: record.status, ...(iso(record.updatedAt) ? { updatedAt: iso(record.updatedAt)! } : {}) }, description: record.description, quantity: record.quantity, order: orderRef(record.orderId, record.displayNumber, record.orderNumber), workflowState: record.workflowState } : null;
    }
    if (resource.type === "production_job") {
      const [record] = await db.select({ id: productionJobs.id, orderId: productionJobs.orderId, lineItemId: productionJobs.lineItemId, stationKey: productionJobs.stationKey, stepKey: productionJobs.stepKey, status: productionJobs.status, updatedAt: productionJobs.updatedAt, orderNumber: orders.orderNumber, displayNumber: orders.displayNumber, lineDescription: orderLineItems.description }).from(productionJobs).innerJoin(orders, and(eq(orders.id, productionJobs.orderId), eq(orders.organizationId, organizationId))).leftJoin(orderLineItems, eq(orderLineItems.id, productionJobs.lineItemId)).where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, resource.id))).limit(1);
      return record ? { type: "production_job", resource: jobRef(record.id, record.orderId), current: { status: record.status, ...(iso(record.updatedAt) ? { updatedAt: iso(record.updatedAt)! } : {}) }, order: orderRef(record.orderId, record.displayNumber, record.orderNumber), line: record.lineItemId && record.lineDescription ? lineRef(record.lineItemId, record.lineDescription, record.orderId) : null, station: record.stationKey, step: record.stepKey, status: record.status } : null;
    }
    if (resource.type === "fulfillment") {
      const detail = await getCanonicalFulfillmentDetail(organizationId, resource.id);
      return detail ? toFulfillmentInvestigationSnapshot(detail) : null;
    }
    if (resource.type === "shipment") {
      const [record] = await db.select({ id: shipments.id, orderId: shipments.orderId, primaryOrderId: shipments.primaryOrderId, shipmentReference: shipments.shipmentReference, status: shipments.status, carrier: shipments.carrier, trackingNumber: shipments.trackingNumber, updatedAt: shipments.updatedAt, orderNumber: orders.orderNumber, displayNumber: orders.displayNumber }).from(shipments).innerJoin(orders, and(eq(orders.id, sql`coalesce(${shipments.orderId}, ${shipments.primaryOrderId})`), eq(orders.organizationId, organizationId))).where(and(eq(shipments.organizationId, organizationId), eq(shipments.id, resource.id))).limit(1);
      const orderId = record?.orderId ?? record?.primaryOrderId;
      return record && orderId ? { type: "shipment", resource: shipmentRef(record.id, orderId, record.shipmentReference), current: { status: record.status, ...(iso(record.updatedAt) ? { updatedAt: iso(record.updatedAt)! } : {}) }, order: orderRef(orderId, record.displayNumber, record.orderNumber), status: record.status, trackingNumber: record.trackingNumber, carrier: record.carrier } : null;
    }
    if (resource.type === "contact") {
      const [record] = await db.select({ id: customerContacts.id, firstName: customerContacts.firstName, lastName: customerContacts.lastName, title: customerContacts.title, status: customerContacts.status, updatedAt: customerContacts.updatedAt })
        .from(customerContacts)
        .where(and(eq(customerContacts.organizationId, organizationId), eq(customerContacts.id, resource.id))).limit(1);
      const fullName = record ? `${record.firstName} ${record.lastName}`.trim() : "";
      return record ? { type: "contact", resource: contactRef(record.id, fullName), current: { status: record.status, ...(iso(record.updatedAt) ? { updatedAt: iso(record.updatedAt)! } : {}) }, fullName, title: record.title, customer: null } : null;
    }
    if (resource.type === "quote") {
      const [record] = await db.select({ id: quotes.id, quoteNumber: quotes.quoteNumber, displayNumber: quotes.displayNumber, status: quotes.status, customerId: quotes.customerId, customerName: customers.companyName, updatedAt: quotes.updatedAt, orderId: orders.id, orderNumber: orders.orderNumber, orderDisplayNumber: orders.displayNumber })
        .from(quotes).leftJoin(customers, and(eq(customers.id, quotes.customerId), eq(customers.organizationId, organizationId)))
        .leftJoin(orders, and(eq(orders.quoteId, quotes.id), eq(orders.organizationId, organizationId)))
        .where(and(eq(quotes.organizationId, organizationId), eq(quotes.id, resource.id))).limit(1);
      return record ? { type: "quote", resource: quoteRef(record.id, record.displayNumber, record.quoteNumber), current: { status: record.status, ...(iso(record.updatedAt) ? { updatedAt: iso(record.updatedAt)! } : {}) }, quoteNumber: String(record.displayNumber ?? (record.quoteNumber ? `Quote #${record.quoteNumber}` : record.id)), customer: record.customerId && record.customerName ? customerRef(record.customerId, record.customerName) : null, relatedOrder: record.orderId ? orderRef(record.orderId, record.orderDisplayNumber, record.orderNumber) : null, status: record.status } : null;
    }
    if (resource.type === "artwork") {
      const [record] = await db.select({ id: lineItemArtwork.id, orderId: lineItemArtwork.orderId, lineItemId: lineItemArtwork.lineItemId, fileRecordId: lineItemArtwork.fileRecordId, role: lineItemArtwork.role, status: lineItemArtwork.status, side: lineItemArtwork.side, supersedesArtworkId: lineItemArtwork.supersedesArtworkId, createdAt: lineItemArtwork.createdAt, filename: fileRecords.originalFilename, mimeType: fileRecords.mimeType, lifecycleState: fileRecords.lifecycleState, orderNumber: orders.orderNumber, orderDisplayNumber: orders.displayNumber, lineDescription: orderLineItems.description, thumbStatus: orderAttachments.thumbStatus })
        .from(lineItemArtwork).innerJoin(fileRecords, and(eq(fileRecords.id, lineItemArtwork.fileRecordId), eq(fileRecords.organizationId, organizationId)))
        .innerJoin(orders, and(eq(orders.id, lineItemArtwork.orderId), eq(orders.organizationId, organizationId)))
        .innerJoin(orderLineItems, and(eq(orderLineItems.id, lineItemArtwork.lineItemId), eq(orderLineItems.orderId, lineItemArtwork.orderId)))
        .leftJoin(orderAttachments, and(eq(orderAttachments.fileRecordId, lineItemArtwork.fileRecordId), eq(orderAttachments.orderId, lineItemArtwork.orderId), eq(orderAttachments.orderLineItemId, lineItemArtwork.lineItemId)))
        .where(and(eq(lineItemArtwork.organizationId, organizationId), eq(lineItemArtwork.id, resource.id))).limit(1);
      return record ? { type: "artwork", resource: artworkRef(record.id, record.orderId, record.filename), current: { status: record.status, ...(iso(record.createdAt) ? { updatedAt: iso(record.createdAt)! } : {}) }, order: orderRef(record.orderId, record.orderDisplayNumber, record.orderNumber), line: lineRef(record.lineItemId, record.lineDescription, record.orderId), fileRecordId: record.fileRecordId, filename: record.filename, mimeType: record.mimeType, storageState: record.lifecycleState, originalAvailable: ["stored_hot", "stored_warm", "stored_cold"].includes(record.lifecycleState), previewAvailable: record.thumbStatus === "thumb_ready", role: record.role, artworkStatus: record.status, side: record.side, supersedesArtwork: record.supersedesArtworkId ? artworkRef(record.supersedesArtworkId, record.orderId, "Superseded artwork") : null } : null;
    }
    const [record] = await db.select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber, displayNumber: invoices.displayNumber, status: invoices.status, total: invoices.total, updatedAt: invoices.updatedAt, orderId: invoices.orderId, customerId: invoices.customerId, customerName: customers.companyName, orderNumber: orders.orderNumber, orderDisplayNumber: orders.displayNumber, qbSyncStatus: invoices.qbSyncStatus, lastSentAt: invoices.lastSentAt }).from(invoices).leftJoin(customers, and(eq(customers.id, invoices.customerId), eq(customers.organizationId, organizationId))).leftJoin(orders, and(eq(orders.id, invoices.orderId), eq(orders.organizationId, organizationId))).where(and(eq(invoices.organizationId, organizationId), eq(invoices.id, resource.id))).limit(1);
    return record ? { type: "invoice", resource: invoiceRef(record.id, record.displayNumber, record.invoiceNumber), current: { status: record.status, ...(iso(record.updatedAt) ? { updatedAt: iso(record.updatedAt)! } : {}) }, order: record.orderId ? orderRef(record.orderId, record.orderDisplayNumber, record.orderNumber) : null, customer: record.customerId && record.customerName ? customerRef(record.customerId, record.customerName) : null, invoiceNumber: String(record.displayNumber ?? `Invoice #${record.invoiceNumber}`), status: record.status, total: number(record.total), quickbooksSyncStatus: record.qbSyncStatus ?? null, emailStatus: record.lastSentAt ? "sent" : null } : null;
  }

  async related(organizationId: string, resource: InvestigationResourceInput, selected?: readonly InvestigationRelationship[]): Promise<InvestigationEdge[]> {
    const allow = (relationship: InvestigationRelationship) => !selected?.length || selected.includes(relationship);
    const edges: InvestigationEdge[] = [];
    const add = (from: InvestigationResourceReference, to: InvestigationResourceReference, relationship: InvestigationRelationship) => { if (allow(relationship)) edges.push({ from, to, relationship }); };
    const snapshot = await this.get(organizationId, resource); if (!snapshot) return [];
    const root = snapshot.resource;
    if (resource.type === "order") {
      const [lines, jobs, shipmentRows, invoiceRows, artworkRows, quoteRows] = await Promise.all([
        db.select({ id: orderLineItems.id, description: orderLineItems.description }).from(orderLineItems).where(eq(orderLineItems.orderId, resource.id)).orderBy(asc(orderLineItems.sortOrder)).limit(20),
        db.select({ id: productionJobs.id }).from(productionJobs).where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.orderId, resource.id))).limit(20),
        db.select({ id: shipments.id, shipmentReference: shipments.shipmentReference }).from(shipments).where(and(eq(shipments.organizationId, organizationId), or(eq(shipments.orderId, resource.id), eq(shipments.primaryOrderId, resource.id)))).limit(20),
        db.select({ id: invoices.id, displayNumber: invoices.displayNumber, invoiceNumber: invoices.invoiceNumber }).from(invoices).where(and(eq(invoices.organizationId, organizationId), eq(invoices.orderId, resource.id))).limit(20),
        db.select({ id: lineItemArtwork.id, filename: fileRecords.originalFilename }).from(lineItemArtwork).innerJoin(fileRecords, and(eq(fileRecords.id, lineItemArtwork.fileRecordId), eq(fileRecords.organizationId, organizationId))).where(and(eq(lineItemArtwork.organizationId, organizationId), eq(lineItemArtwork.orderId, resource.id))).limit(20),
        db.select({ id: quotes.id, displayNumber: quotes.displayNumber, quoteNumber: quotes.quoteNumber }).from(quotes).innerJoin(orders, and(eq(orders.quoteId, quotes.id), eq(orders.organizationId, organizationId))).where(and(eq(quotes.organizationId, organizationId), eq(orders.id, resource.id))).limit(1),
      ]);
      if (snapshot.type === "order" && snapshot.customer) add(root, snapshot.customer, "belongs_to_customer");
      if (snapshot.type === "order") add(root, fulfillmentRef(resource.id, snapshot.orderNumber), "has_fulfillment_workspace");
      lines.forEach((line) => add(root, lineRef(line.id, line.description, resource.id), "contains_line"));
      jobs.forEach((job) => add(root, jobRef(job.id, resource.id), "has_production_job"));
      shipmentRows.forEach((shipment) => add(root, shipmentRef(shipment.id, resource.id, shipment.shipmentReference), "fulfills_order"));
      invoiceRows.forEach((invoice) => add(root, invoiceRef(invoice.id, invoice.displayNumber, invoice.invoiceNumber), "invoices_order"));
      artworkRows.forEach((artwork) => add(root, artworkRef(artwork.id, resource.id, artwork.filename), "has_artwork"));
      quoteRows.forEach((quote) => add(root, quoteRef(quote.id, quote.displayNumber, quote.quoteNumber), "originated_from_quote"));
    } else if (resource.type === "customer") {
      const [records, contacts] = await Promise.all([
        db.select({ id: orders.id, displayNumber: orders.displayNumber, orderNumber: orders.orderNumber }).from(orders).where(and(eq(orders.organizationId, organizationId), eq(orders.customerId, resource.id))).orderBy(desc(orders.updatedAt)).limit(20),
        db.select({ id: customerContacts.id, firstName: customerContacts.firstName, lastName: customerContacts.lastName }).from(customerContactLinks).innerJoin(customerContacts, and(eq(customerContacts.id, customerContactLinks.contactId), eq(customerContacts.organizationId, organizationId))).where(and(eq(customerContactLinks.organizationId, organizationId), eq(customerContactLinks.customerId, resource.id), eq(customerContactLinks.status, "active"))).limit(20),
      ]);
      records.forEach((order) => add(root, orderRef(order.id, order.displayNumber, order.orderNumber), "belongs_to_customer"));
      contacts.forEach((contact) => add(root, contactRef(contact.id, `${contact.firstName} ${contact.lastName}`.trim()), "has_contact"));
    } else if (resource.type === "order_line" && snapshot.type === "order_line") {
      add(root, snapshot.order, "contains_line");
      const [records, artworkRows] = await Promise.all([
        db.select({ id: productionJobs.id, orderId: productionJobs.orderId }).from(productionJobs).where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.lineItemId, resource.id))).limit(20),
        db.select({ id: lineItemArtwork.id, filename: fileRecords.originalFilename }).from(lineItemArtwork).innerJoin(fileRecords, and(eq(fileRecords.id, lineItemArtwork.fileRecordId), eq(fileRecords.organizationId, organizationId))).where(and(eq(lineItemArtwork.organizationId, organizationId), eq(lineItemArtwork.lineItemId, resource.id))).limit(20),
      ]);
      records.forEach((job) => add(root, jobRef(job.id, job.orderId), "has_production_job"));
      artworkRows.forEach((artwork) => add(root, artworkRef(artwork.id, snapshot.order.id, artwork.filename), "has_artwork"));
    } else if (resource.type === "production_job" && snapshot.type === "production_job") {
      add(root, snapshot.order, "has_production_job"); if (snapshot.line) add(root, snapshot.line, "contains_line");
    } else if (resource.type === "fulfillment" && snapshot.type === "fulfillment") {
      add(root, snapshot.order, "has_fulfillment_workspace");
      snapshot.shipments.forEach((shipment) => add(root, shipment, "fulfills_order"));
    } else if (resource.type === "shipment" && snapshot.type === "shipment") add(root, snapshot.order, "fulfills_order");
    else if (resource.type === "invoice" && snapshot.type === "invoice") { if (snapshot.order) add(root, snapshot.order, "invoices_order"); if (snapshot.customer) add(root, snapshot.customer, "belongs_to_customer"); }
    else if (resource.type === "contact" && snapshot.type === "contact") {
      const records = await db.select({ id: customers.id, companyName: customers.companyName }).from(customerContactLinks).innerJoin(customers, and(eq(customers.id, customerContactLinks.customerId), eq(customers.organizationId, organizationId))).where(and(eq(customerContactLinks.organizationId, organizationId), eq(customerContactLinks.contactId, resource.id), eq(customerContactLinks.status, "active"))).limit(20);
      records.forEach((customer) => add(root, customerRef(customer.id, customer.companyName), "belongs_to_customer"));
    }
    else if (resource.type === "quote" && snapshot.type === "quote") { if (snapshot.customer) add(root, snapshot.customer, "belongs_to_customer"); if (snapshot.relatedOrder) add(root, snapshot.relatedOrder, "originated_from_quote"); }
    else if (resource.type === "artwork" && snapshot.type === "artwork") {
      add(root, snapshot.line, "contains_line");
      if (snapshot.supersedesArtwork) add(root, snapshot.supersedesArtwork, "supersedes_artwork");
    }
    return edges;
  }

  async history(organizationId: string, resource: InvestigationResourceInput, limit: number): Promise<InvestigationHistoryEvent[]> {
    if (resource.type === "fulfillment") {
      const detail = await getCanonicalFulfillmentDetail(organizationId, resource.id);
      if (!detail) return [];
      const snapshot = toFulfillmentInvestigationSnapshot(detail);
      return (detail?.events ?? []).slice(0, limit).map((event) => ({
        eventId: `fulfillment_event:${event.id}`,
        occurredAt: event.createdAt,
        kind: "recorded_event" as const,
        summary: `Fulfillment ${event.entityType.toLowerCase()}: ${event.eventType}`,
        resource: snapshot.resource,
        provenance: { source: "fulfillment_events" as const, recorded: true },
      }));
    }
    const snapshot = await this.get(organizationId, resource); if (!snapshot) return [];
    const output: InvestigationHistoryEvent[] = [];
    const add = (event: InvestigationHistoryEvent) => { if (output.length < limit) output.push(event); };
    const orderId = snapshot.type === "order" ? resource.id : snapshot.type === "order_line" || snapshot.type === "production_job" || snapshot.type === "shipment" || snapshot.type === "artwork" ? snapshot.order.id : snapshot.type === "invoice" ? snapshot.order?.id : snapshot.type === "quote" ? snapshot.relatedOrder?.id : undefined;
    if (orderId) {
      const auditRows = await db.select({ id: orderAuditLog.id, createdAt: orderAuditLog.createdAt, actionType: orderAuditLog.actionType, note: orderAuditLog.note, toStatus: orderAuditLog.toStatus }).from(orderAuditLog).where(eq(orderAuditLog.orderId, orderId)).orderBy(desc(orderAuditLog.createdAt)).limit(limit);
      auditRows.forEach((row) => add({ eventId: `order_audit:${row.id}`, occurredAt: iso(row.createdAt)!, kind: "recorded_event", summary: row.note || (row.toStatus ? `${row.actionType}: ${row.toStatus}` : row.actionType), resource: snapshot.resource, provenance: { source: "order_audit_log", recorded: true } }));
      const productionRows = await db.select({ id: productionEvents.id, createdAt: productionEvents.createdAt, type: productionEvents.type }).from(productionEvents).where(and(eq(productionEvents.organizationId, organizationId), eq(productionEvents.orderId, orderId))).orderBy(desc(productionEvents.createdAt)).limit(limit);
      productionRows.forEach((row) => add({ eventId: `production_event:${row.id}`, occurredAt: iso(row.createdAt)!, kind: "recorded_event", summary: `Production event: ${row.type}`, resource: snapshot.resource, provenance: { source: "production_events", recorded: true } }));
      const shipmentRows = await db.select({ id: shipments.id, updatedAt: shipments.updatedAt, status: shipments.status }).from(shipments).where(and(eq(shipments.organizationId, organizationId), or(eq(shipments.orderId, orderId), eq(shipments.primaryOrderId, orderId)))).orderBy(desc(shipments.updatedAt)).limit(limit);
      shipmentRows.forEach((row) => add({ eventId: `shipment:${row.id}`, occurredAt: iso(row.updatedAt)!, kind: "recorded_event", summary: `Shipment recorded: ${row.status}`, resource: snapshot.resource, provenance: { source: "shipments", recorded: true } }));
      const invoiceRows = await db.select({ id: invoices.id, updatedAt: invoices.updatedAt, status: invoices.status }).from(invoices).where(and(eq(invoices.organizationId, organizationId), eq(invoices.orderId, orderId))).orderBy(desc(invoices.updatedAt)).limit(limit);
      invoiceRows.forEach((row) => add({ eventId: `invoice:${row.id}`, occurredAt: iso(row.updatedAt)!, kind: "recorded_event", summary: `Invoice recorded: ${row.status}`, resource: snapshot.resource, provenance: { source: "invoices", recorded: true } }));
      const fulfillmentRows = await db.select({ id: fulfillmentEvents.id, createdAt: fulfillmentEvents.createdAt, eventType: fulfillmentEvents.eventType }).from(fulfillmentEvents).where(and(eq(fulfillmentEvents.organizationId, organizationId), eq(fulfillmentEvents.entityId, orderId))).orderBy(desc(fulfillmentEvents.createdAt)).limit(limit);
      fulfillmentRows.forEach((row) => add({ eventId: `fulfillment_event:${row.id}`, occurredAt: iso(row.createdAt)!, kind: "recorded_event", summary: `Fulfillment event: ${row.eventType}`, resource: snapshot.resource, provenance: { source: "fulfillment_events", recorded: true } }));
      const emailRows = await db.select({ id: invoiceEmailLogs.id, sentAt: invoiceEmailLogs.sentAt, status: invoiceEmailLogs.status, type: invoiceEmailLogs.type }).from(invoiceEmailLogs).innerJoin(invoices, and(eq(invoices.id, invoiceEmailLogs.invoiceId), eq(invoices.organizationId, organizationId))).where(and(eq(invoiceEmailLogs.organizationId, organizationId), eq(invoices.orderId, orderId))).orderBy(desc(invoiceEmailLogs.sentAt)).limit(limit);
      emailRows.forEach((row) => add({ eventId: `invoice_email:${row.id}`, occurredAt: iso(row.sentAt)!, kind: "recorded_event", summary: `Invoice email ${row.type}: ${row.status}`, resource: snapshot.resource, provenance: { source: "invoice_email_logs", recorded: true } }));
      const deliveryRows = await db.select({ id: invoiceEmailDeliveryJobs.id, updatedAt: invoiceEmailDeliveryJobs.updatedAt, status: invoiceEmailDeliveryJobs.status, deliveryType: invoiceEmailDeliveryJobs.deliveryType }).from(invoiceEmailDeliveryJobs).innerJoin(invoices, and(eq(invoices.id, invoiceEmailDeliveryJobs.invoiceId), eq(invoices.organizationId, organizationId))).where(and(eq(invoiceEmailDeliveryJobs.organizationId, organizationId), eq(invoices.orderId, orderId))).orderBy(desc(invoiceEmailDeliveryJobs.updatedAt)).limit(limit);
      deliveryRows.forEach((row) => add({ eventId: `invoice_delivery:${row.id}`, occurredAt: iso(row.updatedAt)!, kind: "recorded_event", summary: `Document delivery ${row.deliveryType}: ${row.status}`, resource: snapshot.resource, provenance: { source: "invoice_email_delivery_jobs", recorded: true } }));
    }
    if (snapshot.type === "artwork") {
      const rows = await db.select({ id: lineItemArtwork.id, createdAt: lineItemArtwork.createdAt, supersededAt: lineItemArtwork.supersededAt, status: lineItemArtwork.status, role: lineItemArtwork.role }).from(lineItemArtwork).where(and(eq(lineItemArtwork.organizationId, organizationId), eq(lineItemArtwork.id, resource.id))).limit(1);
      rows.forEach((row) => {
        add({ eventId: `artwork_created:${row.id}`, occurredAt: iso(row.createdAt)!, kind: "recorded_event", summary: `Artwork recorded: ${row.role}`, resource: snapshot.resource, provenance: { source: "line_item_artwork", recorded: true } });
        if (row.supersededAt) add({ eventId: `artwork_superseded:${row.id}`, occurredAt: iso(row.supersededAt)!, kind: "recorded_event", summary: `Artwork marked ${row.status}`, resource: snapshot.resource, provenance: { source: "line_item_artwork", recorded: true } });
      });
    }
    return output.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, limit);
  }
}

export class InvestigationService {
  constructor(private readonly repository: InvestigationRepository = new DrizzleInvestigationRepository()) {}
  private authorize(scope: InvestigationScope) { if (!scope.permissions.includes("assistant.internal_staff")) throw new InvestigationAccessError(); }
  async search(scope: InvestigationScope, input: { query: string; resourceTypes?: readonly InvestigationResourceType[]; limit: number }) {
    this.authorize(scope); const matches = await this.repository.search(scope.organizationId, input.query, input.resourceTypes ?? investigationResourceTypeValues, input.limit);
    return matches.length ? { status: "succeeded" as const, data: { resolution: matches.length === 1 ? "resolved" as const : "ambiguous" as const, matches, limit: input.limit } } : { status: "not_found" as const, data: null };
  }
  async get(scope: InvestigationScope, resource: InvestigationResourceInput) {
    this.authorize(scope); const snapshot = await this.repository.get(scope.organizationId, resource); return snapshot ? { status: "succeeded" as const, data: { snapshot } } : { status: "not_found" as const, data: null };
  }
  async related(scope: InvestigationScope, input: { resource: InvestigationResourceInput; relationships?: readonly InvestigationRelationship[]; depth: number; limit: number }) {
    this.authorize(scope); const root = await this.repository.get(scope.organizationId, input.resource); if (!root) return { status: "not_found" as const, data: null };
    const queue = [{ resource: input.resource, depth: 0 }]; const visited = new Set([`${input.resource.type}:${input.resource.id}`]); const edges: Array<InvestigationEdge & { depth: number }> = []; let truncated = false;
    while (queue.length && edges.length < input.limit) {
      const current = queue.shift()!; if (current.depth >= input.depth) continue;
      const next = await this.repository.related(scope.organizationId, current.resource, input.relationships);
      for (const edge of next) { if (edges.length >= input.limit) { truncated = true; break; } const key = `${edge.to.type}:${edge.to.id}`; if (visited.has(key)) continue; visited.add(key); edges.push({ ...edge, depth: current.depth + 1 }); queue.push({ resource: { type: edge.to.type, id: edge.to.id }, depth: current.depth + 1 }); }
    }
    truncated ||= edges.length >= input.limit && queue.some((item) => item.depth < input.depth);
    return { status: truncated ? "partial" as const : "succeeded" as const, data: { root: root.resource, edges, returnedDepth: input.depth, truncated } };
  }
  async history(scope: InvestigationScope, input: { resource: InvestigationResourceInput; limit: number }) {
    this.authorize(scope); const snapshot = await this.repository.get(scope.organizationId, input.resource); if (!snapshot) return { status: "not_found" as const, data: null };
    const recorded = await this.repository.history(scope.organizationId, input.resource, input.limit);
    const currentAt = snapshot.current.updatedAt;
    const current = currentAt ? [{ eventId: `current:${snapshot.resource.type}:${snapshot.resource.id}`, occurredAt: currentAt, kind: "current_snapshot" as const, summary: `Current ${snapshot.resource.type.replace("_", " ")} snapshot`, resource: snapshot.resource, provenance: { source: "current_record" as const, recorded: false } }] : [];
    return { status: "succeeded" as const, data: { resource: snapshot.resource, events: [...recorded, ...current].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, input.limit), limit: input.limit } };
  }
}

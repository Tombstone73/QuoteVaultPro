import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import type { Request } from "express";

import { db } from "../db";
import {
  customerContacts,
  customers,
  invoices,
  lineItemProofVersions,
  orderLineItems,
  orders,
  payments,
  quoteLineItems,
  quotes,
  shipmentOrders,
  shipments,
} from "@shared/schema";
import {
  computeInvoicePaymentRollup,
  getInvoicePaymentStatusLabel,
} from "@shared/rollups/invoicePaymentRollup";

export type PortalSessionDto = {
  userId: string;
  customerId: string;
  customerName: string;
  portalContactName: string | null;
  portalEmail: string | null;
  permissions: {
    canViewInvoices: boolean;
    canPayInvoices: boolean;
    canViewOrders: boolean;
    canViewQuotes: boolean;
  };
};

export type InvoicePortalDto = {
  id: string;
  invoiceNumber: number;
  status: string;
  issueDate: string | null;
  dueDate: string | null;
  subtotal: number;
  tax: number;
  total: number;
  amountPaid: number;
  amountDue: number;
  currency: string;
  pdfAvailable: boolean;
  paymentStatusLabel: string;
};

export type OrderPortalLineItemDto = {
  id: string;
  itemName: string;
  quantity: number;
  dimensions: {
    width: number | null;
    height: number | null;
  };
  status: string;
};

export type OrderPortalDto = {
  id: string;
  orderNumber: string;
  customerPoNumber: string | null;
  createdAt: string | null;
  status: string;
  displayStatus: string;
  lineItems: OrderPortalLineItemDto[];
  shipmentSummary: {
    fulfillmentStatus: string | null;
    shippingMethod: string | null;
    shippedAt: string | null;
    trackingNumbers: string[];
  };
  proofStatusSummary: {
    status: "not_required" | "pending" | "approved" | "revision_requested";
    requiredCount: number;
    approvedCount: number;
    pendingCount: number;
    revisionRequestedCount: number;
  };
};

export type QuotePortalLineItemDto = {
  id: string;
  itemName: string;
  quantity: number;
  dimensions: {
    width: number | null;
    height: number | null;
  };
  total: number;
};

export type QuotePortalDto = {
  id: string;
  quoteNumber: number | null;
  createdAt: string | null;
  validUntil: string | null;
  status: string;
  subtotal: number;
  tax: number;
  total: number;
  lineItems: QuotePortalLineItemDto[];
  customerVisibleActions: {
    canView: boolean;
    canApprove: boolean;
    canRequestRevision: boolean;
  };
};

type PortalScope = {
  userId: string;
  organizationId: string;
  customerId: string;
  customer: typeof customers.$inferSelect;
};

type InvoicePortalRow = Pick<
  typeof invoices.$inferSelect,
  | "id"
  | "invoiceNumber"
  | "status"
  | "issueDate"
  | "dueDate"
  | "subtotal"
  | "tax"
  | "total"
  | "subtotalCents"
  | "taxCents"
  | "totalCents"
  | "currency"
>;

type PaymentRollupRow = Pick<typeof payments.$inferSelect, "id" | "invoiceId" | "status" | "amountCents">;

type OrderPortalRow = Pick<
  typeof orders.$inferSelect,
  | "id"
  | "orderNumber"
  | "poNumber"
  | "createdAt"
  | "status"
  | "state"
  | "fulfillmentStatus"
  | "shippingMethod"
  | "shippedAt"
  | "trackingNumber"
>;

type OrderLineItemPortalRow = Pick<
  typeof orderLineItems.$inferSelect,
  | "id"
  | "orderId"
  | "description"
  | "width"
  | "height"
  | "quantity"
  | "status"
  | "workflowState"
  | "requiresProofApproval"
  | "approvedProofVersionId"
>;

type ShipmentPortalRow = Pick<
  typeof shipments.$inferSelect,
  "orderId" | "primaryOrderId" | "status" | "trackingNumber"
>;

type QuotePortalRow = Pick<
  typeof quotes.$inferSelect,
  "id" | "quoteNumber" | "createdAt" | "validUntil" | "status" | "subtotal" | "taxAmount" | "totalPrice"
>;

type QuoteLineItemPortalRow = Pick<
  typeof quoteLineItems.$inferSelect,
  "id" | "quoteId" | "productName" | "width" | "height" | "quantity" | "linePrice"
>;

const CUSTOMER_VISIBLE_INVOICE_STATUSES = ["billed", "sent", "partially_paid", "overdue", "paid", "void", "open"];

class PortalAccessError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

const toMoney = (value: unknown): number => {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
};

const centsToMoney = (value: unknown): number => {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n) / 100;
};

const toIso = (value: unknown): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

function getUserId(user: any): string | undefined {
  return user?.claims?.sub ?? user?.id;
}

function sanitizeOrderState(state: unknown, fallbackStatus: unknown): string {
  const normalized = String(state || fallbackStatus || "open").trim().toLowerCase();
  if (normalized === "production_complete") return "production_complete";
  if (normalized === "closed") return "closed";
  if (normalized === "canceled") return "canceled";
  return "open";
}

function orderDisplayStatus(status: string): string {
  switch (status) {
    case "production_complete":
      return "Ready";
    case "closed":
      return "Completed";
    case "canceled":
      return "Canceled";
    default:
      return "In Progress";
  }
}

function sanitizeLineItemStatus(raw: unknown): string {
  const state = String(raw || "").trim().toLowerCase();
  if (state === "completed" || state === "complete") return "Complete";
  if (state === "canceled" || state === "cancelled") return "Canceled";
  if (state === "on_hold") return "On Hold";
  if (state === "awaiting_proof_approval") return "Awaiting Approval";
  if (state === "new" || state === "needs_design") return "Received";
  return "In Progress";
}

function quoteDisplayStatus(raw: unknown, validUntil: unknown): string {
  const status = String(raw || "active").trim().toLowerCase();
  if (status === "canceled") return "canceled";
  if (validUntil && new Date(String(validUntil)).getTime() < Date.now()) return "expired";
  return status;
}

function mapQuoteActions(status: string): QuotePortalDto["customerVisibleActions"] {
  return {
    canView: true,
    canApprove: false,
    canRequestRevision: false,
  };
}

export function getPortalScope(req: Request): PortalScope {
  const userId = getUserId((req as any).user);
  const organizationId = req.organizationId;
  const customerId = (req as any).portalCustomerId;
  const customer = (req as any).portalCustomer;

  if (!userId || !organizationId || !customerId || !customer || customer.organizationId !== organizationId || customer.id !== customerId) {
    throw new PortalAccessError(403, "Portal customer scope is required");
  }

  return { userId, organizationId, customerId, customer };
}

async function findPortalContactName(scope: PortalScope, email: string | null): Promise<string | null> {
  if (!email) return null;

  const [contact] = await db
    .select({
      firstName: customerContacts.firstName,
      lastName: customerContacts.lastName,
    })
    .from(customerContacts)
    .where(and(eq(customerContacts.customerId, scope.customerId), eq(customerContacts.email, email)))
    .limit(1);

  const fullName = contact ? `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() : "";
  return fullName || null;
}

export async function getPortalSession(req: Request): Promise<PortalSessionDto> {
  const scope = getPortalScope(req);
  const portalEmail = String((req as any).user?.email || scope.customer.email || "").trim() || null;
  const userName = `${(req as any).user?.firstName || ""} ${(req as any).user?.lastName || ""}`.trim();
  const contactName = await findPortalContactName(scope, portalEmail);

  return {
    userId: scope.userId,
    customerId: scope.customerId,
    customerName: scope.customer.companyName,
    portalContactName: contactName || userName || null,
    portalEmail,
    permissions: {
      canViewInvoices: true,
      canPayInvoices: false,
      canViewOrders: true,
      canViewQuotes: true,
    },
  };
}

function mapInvoice(row: InvoicePortalRow, paymentRows: PaymentRollupRow[]): InvoicePortalDto {
  const rollup = computeInvoicePaymentRollup({
    invoiceTotalCents: Number(row.totalCents || 0),
    payments: paymentRows.map((payment) => ({
      id: payment.id,
      status: payment.status,
      amountCents: Number(payment.amountCents || 0),
    })),
  });

  return {
    id: row.id,
    invoiceNumber: Number(row.invoiceNumber),
    status: String(row.status || "draft"),
    issueDate: toIso(row.issueDate),
    dueDate: toIso(row.dueDate),
    subtotal: row.subtotalCents ? centsToMoney(row.subtotalCents) : toMoney(row.subtotal),
    tax: row.taxCents ? centsToMoney(row.taxCents) : toMoney(row.tax),
    total: row.totalCents ? centsToMoney(row.totalCents) : toMoney(row.total),
    amountPaid: centsToMoney(rollup.amountPaidCents),
    amountDue: centsToMoney(rollup.amountDueCents),
    currency: String(row.currency || "USD"),
    pdfAvailable: String(row.status || "").toLowerCase() !== "draft",
    paymentStatusLabel: getInvoicePaymentStatusLabel({ invoiceStatus: row.status, rollup }),
  };
}

async function loadInvoicePayments(organizationId: string, invoiceIds: string[]): Promise<Map<string, PaymentRollupRow[]>> {
  if (invoiceIds.length === 0) return new Map();

  const rows = await db
    .select({
      id: payments.id,
      invoiceId: payments.invoiceId,
      status: payments.status,
      amountCents: payments.amountCents,
    })
    .from(payments)
    .where(and(eq(payments.organizationId, organizationId), inArray(payments.invoiceId, invoiceIds)));

  const byInvoiceId = new Map<string, PaymentRollupRow[]>();
  for (const row of rows) {
    const list = byInvoiceId.get(row.invoiceId) ?? [];
    list.push(row);
    byInvoiceId.set(row.invoiceId, list);
  }
  return byInvoiceId;
}

export async function listPortalInvoices(req: Request): Promise<InvoicePortalDto[]> {
  const scope = getPortalScope(req);
  const rows = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      status: invoices.status,
      issueDate: invoices.issueDate,
      dueDate: invoices.dueDate,
      subtotal: invoices.subtotal,
      tax: invoices.tax,
      total: invoices.total,
      subtotalCents: invoices.subtotalCents,
      taxCents: invoices.taxCents,
      totalCents: invoices.totalCents,
      currency: invoices.currency,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.organizationId, scope.organizationId),
        eq(invoices.customerId, scope.customerId),
        inArray(invoices.status, CUSTOMER_VISIBLE_INVOICE_STATUSES),
      ),
    )
    .orderBy(desc(invoices.issueDate), desc(invoices.createdAt));

  const paymentsByInvoiceId = await loadInvoicePayments(scope.organizationId, rows.map((row) => row.id));
  return rows.map((row) => mapInvoice(row, paymentsByInvoiceId.get(row.id) ?? []));
}

export async function getPortalInvoice(req: Request, invoiceId: string): Promise<InvoicePortalDto | null> {
  const scope = getPortalScope(req);
  const [row] = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      status: invoices.status,
      issueDate: invoices.issueDate,
      dueDate: invoices.dueDate,
      subtotal: invoices.subtotal,
      tax: invoices.tax,
      total: invoices.total,
      subtotalCents: invoices.subtotalCents,
      taxCents: invoices.taxCents,
      totalCents: invoices.totalCents,
      currency: invoices.currency,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.id, invoiceId),
        eq(invoices.organizationId, scope.organizationId),
        eq(invoices.customerId, scope.customerId),
        inArray(invoices.status, CUSTOMER_VISIBLE_INVOICE_STATUSES),
      ),
    )
    .limit(1);

  if (!row) return null;
  const paymentsByInvoiceId = await loadInvoicePayments(scope.organizationId, [row.id]);
  return mapInvoice(row, paymentsByInvoiceId.get(row.id) ?? []);
}

function buildProofSummary(lineItems: Array<{ id: string; requiresProofApproval: boolean; approvedProofVersionId: string | null }>, proofVersions: Array<{ lineItemId: string; status: string }>): OrderPortalDto["proofStatusSummary"] {
  const requiredLineItemIds = new Set(lineItems.filter((lineItem) => lineItem.requiresProofApproval).map((lineItem) => lineItem.id));
  const requiredCount = requiredLineItemIds.size;
  const approvedCount = lineItems.filter((lineItem) => lineItem.requiresProofApproval && lineItem.approvedProofVersionId).length;
  let revisionRequestedCount = 0;

  for (const version of proofVersions) {
    if (requiredLineItemIds.has(version.lineItemId) && version.status === "revision_requested") {
      revisionRequestedCount += 1;
    }
  }

  const pendingCount = Math.max(0, requiredCount - approvedCount - revisionRequestedCount);
  const status =
    requiredCount === 0
      ? "not_required"
      : approvedCount >= requiredCount
        ? "approved"
        : revisionRequestedCount > 0
          ? "revision_requested"
          : "pending";

  return { status, requiredCount, approvedCount, pendingCount, revisionRequestedCount };
}

async function loadShipmentsForOrders(organizationId: string, orderIds: string[]) {
  if (orderIds.length === 0) return new Map<string, ShipmentPortalRow[]>();

  const rows = await db
    .select({
      shipment: {
        orderId: shipments.orderId,
        primaryOrderId: shipments.primaryOrderId,
        status: shipments.status,
        trackingNumber: shipments.trackingNumber,
      },
      linkedOrderId: shipmentOrders.orderId,
    })
    .from(shipments)
    .leftJoin(shipmentOrders, and(eq(shipmentOrders.shipmentId, shipments.id), eq(shipmentOrders.organizationId, organizationId)))
    .where(
      and(
        eq(shipments.organizationId, organizationId),
        or(inArray(shipments.orderId, orderIds), inArray(shipments.primaryOrderId, orderIds), inArray(shipmentOrders.orderId, orderIds)),
      ),
    );

  const byOrderId = new Map<string, ShipmentPortalRow[]>();
  for (const row of rows) {
    const shipment = row.shipment;
    const ids = new Set<string>();
    if (shipment.orderId && orderIds.includes(shipment.orderId)) ids.add(shipment.orderId);
    if (shipment.primaryOrderId && orderIds.includes(shipment.primaryOrderId)) ids.add(shipment.primaryOrderId);
    if (row.linkedOrderId && orderIds.includes(row.linkedOrderId)) ids.add(row.linkedOrderId);

    for (const orderId of Array.from(ids)) {
      const list = byOrderId.get(orderId) ?? [];
      list.push(shipment);
      byOrderId.set(orderId, list);
    }
  }

  return byOrderId;
}

function mapOrder(
  order: OrderPortalRow,
  lineItems: OrderLineItemPortalRow[],
  orderShipments: ShipmentPortalRow[],
  proofVersions: Array<{ lineItemId: string; status: string }>,
): OrderPortalDto {
  const status = sanitizeOrderState(order.state, order.status);
  const trackingNumbers = Array.from(
    new Set([
      ...(order.trackingNumber ? [String(order.trackingNumber)] : []),
      ...orderShipments
        .filter((shipment) => String(shipment.status || "").toUpperCase() !== "VOIDED")
        .map((shipment) => shipment.trackingNumber)
        .filter((tracking): tracking is string => typeof tracking === "string" && tracking.trim().length > 0),
    ]),
  );

  const safeLineItems = lineItems.map((lineItem) => ({
    id: lineItem.id,
    itemName: lineItem.description,
    quantity: Number(lineItem.quantity || 0),
    dimensions: {
      width: lineItem.width == null ? null : Number(lineItem.width),
      height: lineItem.height == null ? null : Number(lineItem.height),
    },
    status: sanitizeLineItemStatus(lineItem.workflowState || lineItem.status),
  }));

  return {
    id: order.id,
    orderNumber: String(order.orderNumber),
    customerPoNumber: order.poNumber ?? null,
    createdAt: toIso(order.createdAt),
    status,
    displayStatus: orderDisplayStatus(status),
    lineItems: safeLineItems,
    shipmentSummary: {
      fulfillmentStatus: order.fulfillmentStatus ?? null,
      shippingMethod: order.shippingMethod ?? null,
      shippedAt: toIso(order.shippedAt),
      trackingNumbers,
    },
    proofStatusSummary: buildProofSummary(
      lineItems.map((lineItem) => ({
        id: lineItem.id,
        requiresProofApproval: Boolean(lineItem.requiresProofApproval),
        approvedProofVersionId: lineItem.approvedProofVersionId ?? null,
      })),
      proofVersions,
    ),
  };
}

async function loadOrderLineItems(orderIds: string[]) {
  if (orderIds.length === 0) return new Map<string, OrderLineItemPortalRow[]>();

  const rows = await db
    .select({
      id: orderLineItems.id,
      orderId: orderLineItems.orderId,
      description: orderLineItems.description,
      width: orderLineItems.width,
      height: orderLineItems.height,
      quantity: orderLineItems.quantity,
      status: orderLineItems.status,
      workflowState: orderLineItems.workflowState,
      requiresProofApproval: orderLineItems.requiresProofApproval,
      approvedProofVersionId: orderLineItems.approvedProofVersionId,
      sortOrder: orderLineItems.sortOrder,
      createdAt: orderLineItems.createdAt,
    })
    .from(orderLineItems)
    .where(inArray(orderLineItems.orderId, orderIds))
    .orderBy(asc(orderLineItems.sortOrder), asc(orderLineItems.createdAt));

  const byOrderId = new Map<string, OrderLineItemPortalRow[]>();
  for (const row of rows) {
    const list = byOrderId.get(row.orderId) ?? [];
    list.push(row);
    byOrderId.set(row.orderId, list);
  }
  return byOrderId;
}

async function loadProofVersions(organizationId: string, lineItemIds: string[]) {
  if (lineItemIds.length === 0) return new Map<string, Array<{ lineItemId: string; status: string }>>();

  const rows = await db
    .select({
      lineItemId: lineItemProofVersions.lineItemId,
      status: lineItemProofVersions.status,
    })
    .from(lineItemProofVersions)
    .where(and(eq(lineItemProofVersions.organizationId, organizationId), inArray(lineItemProofVersions.lineItemId, lineItemIds)));

  const byLineItemId = new Map<string, Array<{ lineItemId: string; status: string }>>();
  for (const row of rows) {
    const list = byLineItemId.get(row.lineItemId) ?? [];
    list.push(row);
    byLineItemId.set(row.lineItemId, list);
  }
  return byLineItemId;
}

export async function listPortalOrders(req: Request): Promise<OrderPortalDto[]> {
  const scope = getPortalScope(req);
  const rows = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      poNumber: orders.poNumber,
      createdAt: orders.createdAt,
      status: orders.status,
      state: orders.state,
      fulfillmentStatus: orders.fulfillmentStatus,
      shippingMethod: orders.shippingMethod,
      shippedAt: orders.shippedAt,
      trackingNumber: orders.trackingNumber,
    })
    .from(orders)
    .where(and(eq(orders.organizationId, scope.organizationId), eq(orders.customerId, scope.customerId)))
    .orderBy(desc(orders.createdAt));

  const orderIds = rows.map((row) => row.id);
  const lineItemsByOrderId = await loadOrderLineItems(orderIds);
  const allLineItemIds = Array.from(lineItemsByOrderId.values()).flat().map((lineItem) => lineItem.id);
  const proofVersionsByLineItemId = await loadProofVersions(scope.organizationId, allLineItemIds);
  const shipmentsByOrderId = await loadShipmentsForOrders(scope.organizationId, orderIds);

  return rows.map((order) => {
    const lineItems = lineItemsByOrderId.get(order.id) ?? [];
    const proofVersions = lineItems.flatMap((lineItem) => proofVersionsByLineItemId.get(lineItem.id) ?? []);
    return mapOrder(order, lineItems, shipmentsByOrderId.get(order.id) ?? [], proofVersions);
  });
}

export async function getPortalOrder(req: Request, orderId: string): Promise<OrderPortalDto | null> {
  const scope = getPortalScope(req);
  const [order] = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      poNumber: orders.poNumber,
      createdAt: orders.createdAt,
      status: orders.status,
      state: orders.state,
      fulfillmentStatus: orders.fulfillmentStatus,
      shippingMethod: orders.shippingMethod,
      shippedAt: orders.shippedAt,
      trackingNumber: orders.trackingNumber,
    })
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.organizationId, scope.organizationId), eq(orders.customerId, scope.customerId)))
    .limit(1);

  if (!order) return null;

  const lineItemsByOrderId = await loadOrderLineItems([order.id]);
  const lineItems = lineItemsByOrderId.get(order.id) ?? [];
  const proofVersionsByLineItemId = await loadProofVersions(scope.organizationId, lineItems.map((lineItem) => lineItem.id));
  const shipmentsByOrderId = await loadShipmentsForOrders(scope.organizationId, [order.id]);
  const proofVersions = lineItems.flatMap((lineItem) => proofVersionsByLineItemId.get(lineItem.id) ?? []);
  return mapOrder(order, lineItems, shipmentsByOrderId.get(order.id) ?? [], proofVersions);
}

function mapQuote(quote: QuotePortalRow, lineItems: QuoteLineItemPortalRow[]): QuotePortalDto {
  const status = quoteDisplayStatus(quote.status, quote.validUntil);

  return {
    id: quote.id,
    quoteNumber: quote.quoteNumber == null ? null : Number(quote.quoteNumber),
    createdAt: toIso(quote.createdAt),
    validUntil: toIso(quote.validUntil),
    status,
    subtotal: toMoney(quote.subtotal),
    tax: toMoney(quote.taxAmount),
    total: toMoney(quote.totalPrice),
    lineItems: lineItems.map((lineItem) => ({
      id: lineItem.id,
      itemName: lineItem.productName,
      quantity: Number(lineItem.quantity || 0),
      dimensions: {
        width: lineItem.width == null ? null : Number(lineItem.width),
        height: lineItem.height == null ? null : Number(lineItem.height),
      },
      total: toMoney(lineItem.linePrice),
    })),
    customerVisibleActions: mapQuoteActions(status),
  };
}

async function loadQuoteLineItems(quoteIds: string[]) {
  if (quoteIds.length === 0) return new Map<string, QuoteLineItemPortalRow[]>();

  const rows = await db
    .select({
      id: quoteLineItems.id,
      quoteId: quoteLineItems.quoteId,
      productName: quoteLineItems.productName,
      width: quoteLineItems.width,
      height: quoteLineItems.height,
      quantity: quoteLineItems.quantity,
      linePrice: quoteLineItems.linePrice,
      displayOrder: quoteLineItems.displayOrder,
      createdAt: quoteLineItems.createdAt,
    })
    .from(quoteLineItems)
    .where(and(inArray(quoteLineItems.quoteId, quoteIds), eq(quoteLineItems.status, "active")))
    .orderBy(asc(quoteLineItems.displayOrder), asc(quoteLineItems.createdAt));

  const byQuoteId = new Map<string, QuoteLineItemPortalRow[]>();
  for (const row of rows) {
    if (!row.quoteId) continue;
    const list = byQuoteId.get(row.quoteId) ?? [];
    list.push(row);
    byQuoteId.set(row.quoteId, list);
  }
  return byQuoteId;
}

export async function listPortalQuotes(req: Request): Promise<QuotePortalDto[]> {
  const scope = getPortalScope(req);
  const rows = await db
    .select({
      id: quotes.id,
      quoteNumber: quotes.quoteNumber,
      createdAt: quotes.createdAt,
      validUntil: quotes.validUntil,
      status: quotes.status,
      subtotal: quotes.subtotal,
      taxAmount: quotes.taxAmount,
      totalPrice: quotes.totalPrice,
    })
    .from(quotes)
    .where(and(eq(quotes.organizationId, scope.organizationId), eq(quotes.customerId, scope.customerId), eq(quotes.status, "active")))
    .orderBy(desc(quotes.createdAt));

  const lineItemsByQuoteId = await loadQuoteLineItems(rows.map((row) => row.id));
  return rows.map((quote) => mapQuote(quote, lineItemsByQuoteId.get(quote.id) ?? []));
}

export async function getPortalQuote(req: Request, quoteId: string): Promise<QuotePortalDto | null> {
  const scope = getPortalScope(req);
  const [quote] = await db
    .select({
      id: quotes.id,
      quoteNumber: quotes.quoteNumber,
      createdAt: quotes.createdAt,
      validUntil: quotes.validUntil,
      status: quotes.status,
      subtotal: quotes.subtotal,
      taxAmount: quotes.taxAmount,
      totalPrice: quotes.totalPrice,
    })
    .from(quotes)
    .where(and(eq(quotes.id, quoteId), eq(quotes.organizationId, scope.organizationId), eq(quotes.customerId, scope.customerId), eq(quotes.status, "active")))
    .limit(1);

  if (!quote) return null;
  const lineItemsByQuoteId = await loadQuoteLineItems([quote.id]);
  return mapQuote(quote, lineItemsByQuoteId.get(quote.id) ?? []);
}

export function toPortalErrorResponse(error: unknown): { statusCode: number; message: string } {
  if (error instanceof PortalAccessError) {
    return { statusCode: error.statusCode, message: error.message };
  }
  return { statusCode: 500, message: "Portal request failed" };
}

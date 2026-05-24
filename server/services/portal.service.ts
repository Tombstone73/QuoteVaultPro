import { and, asc, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { Request } from "express";

import { db } from "../db";
import {
  auditLogs,
  companySettings,
  customerContacts,
  customers,
  integrationConnections,
  invoiceLineItems,
  invoices,
  lineItemProofVersions,
  orderAttachments,
  orderLineItems,
  orders,
  payments,
  pickupTickets,
  quoteAttachments,
  quoteLineItems,
  quoteWorkflowStates,
  quotes,
  shipmentOrders,
  shipments,
} from "@shared/schema";
import {
  computeInvoicePaymentRollup,
  getInvoicePaymentStatusLabel,
} from "@shared/rollups/invoicePaymentRollup";
import { getStripeClient } from "../lib/stripe";
import { refreshInvoiceStatus } from "../invoicesService";
import { generateInvoicePdfBytes } from "./invoicePdf";
import { storage } from "../storage";
import { resolveOriginalFileAccess } from "../lib/supabaseObjectHelpers";

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

export type PortalInvoicePaymentDto = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  paidAt: string | null;
  methodLabel: string;
  referenceNumber: string | null;
};

export type PortalFileDto = {
  id: string;
  displayName: string;
  fileTypeLabel: string;
  uploadedAt: string | null;
  fileSize: number | null;
  categoryLabel: string;
  previewAvailable: boolean;
  downloadAvailable: boolean;
};

export type PortalFileDownloadResult = {
  filename: string;
  mimeType: string;
  bytes?: Buffer;
  objectPath?: string;
};

export type PortalStripePaymentIntentDto = {
  clientSecret: string;
  paymentId: string;
  invoiceId: string;
  amount: number;
  currency: string;
  stripeAccountId: string;
};

export type PortalStripeConfirmDto = {
  payment: PortalInvoicePaymentDto;
  invoice: InvoicePortalDto;
};

export type PortalInvoicePdfResult = {
  bytes: Buffer;
  filename: string;
};

export type OrderPortalLineItemDto = {
  id: string;
  name: string;
  description: string | null;
  quantity: number;
  dimensions: {
    width: number | null;
    height: number | null;
  };
  displayStatus: string;
  proofStatus: string | null;
  fulfillmentStatusLabel: string | null;
};

export type OrderPortalProofSummaryDto = {
  proofRequired: boolean;
  statusLabel: string;
  actionRequired: boolean;
  latestVersionNumber: number | null;
  proofLinkAvailable: boolean;
  requiredCount: number;
  approvedCount: number;
  pendingCount: number;
  revisionRequestedCount: number;
};

export type OrderPortalFulfillmentSummaryDto = {
  methodLabel: string | null;
  statusLabel: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shippedAt: string | null;
  pickupReadyAt: string | null;
};

export type OrderPortalInvoiceSummaryDto = {
  invoiceCount: number;
  openInvoiceCount: number;
  paidInvoiceCount: number;
  amountDue: number;
  total: number;
  currency: string;
};

export type OrderPortalListDto = {
  id: string;
  orderNumber: string;
  customerPoNumber: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  displayStatus: string;
  rawStatus: string | null;
  total: number;
  itemCount: number;
  proofStatusSummary: OrderPortalProofSummaryDto;
  fulfillmentSummary: OrderPortalFulfillmentSummaryDto;
};

export type OrderPortalDetailDto = OrderPortalListDto & {
  lineItems: OrderPortalLineItemDto[];
  invoiceSummary: OrderPortalInvoiceSummaryDto | null;
};

export type QuotePortalLineItemDto = {
  id: string;
  name: string;
  description: string | null;
  quantity: number;
  dimensions: {
    width: number | null;
    height: number | null;
  };
  unitPrice: number;
  lineTotal: number;
  displayOptions: string[];
};

export type QuotePortalActionsDto = {
  canView: boolean;
  canApprove: boolean;
  canDecline: boolean;
  canRequestRevision: boolean;
  disabledReason: string | null;
};

export type QuotePortalExpirationSummaryDto = {
  expired: boolean;
  expirationLabel: string;
  validUntil: string | null;
};

export type QuotePortalListDto = {
  id: string;
  quoteNumber: number | null;
  createdAt: string | null;
  validUntil: string | null;
  displayStatus: string;
  total: number;
  itemCount: number;
  customerVisibleActions: QuotePortalActionsDto;
};

export type QuotePortalDetailDto = QuotePortalListDto & {
  subtotal: number;
  tax: number;
  lineItems: QuotePortalLineItemDto[];
  expirationSummary: QuotePortalExpirationSummaryDto;
};

export type QuotePortalAction = "approve" | "decline" | "request_revision";

export type QuotePortalOrderSummaryDto = {
  id: string;
  orderNumber: string;
  displayStatus: string;
};

export type QuotePortalActionResultDto = {
  quote: QuotePortalDetailDto;
  order?: QuotePortalOrderSummaryDto;
  message: string;
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

type PaymentPortalRow = Pick<
  typeof payments.$inferSelect,
  | "id"
  | "invoiceId"
  | "provider"
  | "status"
  | "amountCents"
  | "currency"
  | "method"
  | "metadata"
  | "paidAt"
  | "succeededAt"
  | "appliedAt"
  | "stripePaymentIntentId"
  | "createdAt"
>;

type InvoicePaymentPortalRow = Pick<
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
  | "shippingCents"
  | "totalCents"
  | "currency"
  | "orderId"
  | "notesPublic"
  | "terms"
  | "customTerms"
  | "importSource"
  | "isHistorical"
>;

type OrderPortalRow = Pick<
  typeof orders.$inferSelect,
  | "id"
  | "orderNumber"
  | "poNumber"
  | "createdAt"
  | "updatedAt"
  | "status"
  | "state"
  | "statusPillValue"
  | "total"
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
  "orderId" | "primaryOrderId" | "status" | "trackingNumber" | "shippedAt" | "carrier"
>;

type PickupTicketPortalRow = Pick<typeof pickupTickets.$inferSelect, "orderId" | "status" | "readyAt" | "pickedUpAt">;

type OrderInvoiceSummaryRow = Pick<
  typeof invoices.$inferSelect,
  "id" | "orderId" | "status" | "totalCents" | "currency"
>;

type QuotePortalRow = Pick<
  typeof quotes.$inferSelect,
  "id" | "quoteNumber" | "createdAt" | "validUntil" | "status" | "subtotal" | "taxAmount" | "totalPrice" | "convertedToOrderId"
>;

type QuoteLineItemPortalRow = Pick<
  typeof quoteLineItems.$inferSelect,
  "id" | "quoteId" | "productName" | "description" | "width" | "height" | "quantity" | "linePrice" | "selectedOptions"
>;

type QuoteWorkflowPortalRow = Pick<
  typeof quoteWorkflowStates.$inferSelect,
  "quoteId" | "status" | "customerNotes" | "rejectionReason"
>;

type PortalAttachmentRow = {
  id: string;
  fileRecordId: string | null;
  fileName: string;
  originalFilename: string | null;
  mimeType: string | null;
  fileUrl: string | null;
  fileSize: number | null;
  sizeBytes: number | null;
  createdAt: unknown;
  role?: string | null;
  uploadedByUserId?: string | null;
  thumbKey?: string | null;
  previewKey?: string | null;
  thumbnailUrl?: string | null;
  bucket?: string | null;
};

const CUSTOMER_VISIBLE_INVOICE_STATUSES = ["billed", "sent", "partially_paid", "overdue", "paid", "void", "open"];
const PORTAL_PAYABLE_INVOICE_STATUSES = ["billed", "sent", "open", "partially_paid", "overdue"];

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

function getUserName(user: any): string | null {
  const name = `${user?.firstName || ""} ${user?.lastName || ""}`.trim();
  return name || user?.email || null;
}

function normalizeInvoiceStatus(raw: unknown): string {
  const status = String(raw || "").trim().toLowerCase();
  if (status === "billed") return "sent";
  if (status === "voided") return "void";
  return status || "draft";
}

export function isPortalInvoiceStatusPayable(raw: unknown): boolean {
  return PORTAL_PAYABLE_INVOICE_STATUSES.includes(String(raw || "").trim().toLowerCase());
}

function normalizeStatus(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

export function mapPortalOrderStatus(params: {
  state?: unknown;
  status?: unknown;
  statusPillValue?: unknown;
  fulfillmentStatus?: unknown;
  shippingMethod?: unknown;
  proofActionRequired?: boolean;
}): string {
  const state = normalizeStatus(params.state);
  const status = normalizeStatus(params.status);
  const pill = normalizeStatus(params.statusPillValue);
  const fulfillmentStatus = normalizeStatus(params.fulfillmentStatus);
  const shippingMethod = normalizeStatus(params.shippingMethod);

  if (state === "canceled" || status === "canceled" || status === "cancelled") return "Canceled";
  if (state === "closed" || status === "completed" || status === "complete") return "Completed";
  if (fulfillmentStatus === "delivered") return shippingMethod === "pickup" ? "Completed" : "Delivered";
  if (fulfillmentStatus === "shipped") return "Shipped";
  if (fulfillmentStatus === "packed") return shippingMethod === "pickup" ? "Ready for Pickup" : "Ready to Ship";
  if (params.proofActionRequired) return "Awaiting Proof Approval";
  if (state === "production_complete") return shippingMethod === "pickup" ? "Ready for Pickup" : "Ready to Ship";
  if (status === "on_hold" || pill === "on_hold" || pill === "hold") return "On Hold";
  if (status === "new" || status === "created" || pill === "new") return "Received";
  if (status === "in_production" || pill.includes("production")) return "In Production";
  return "In Progress";
}

export function mapPortalLineItemStatus(params: {
  status?: unknown;
  workflowState?: unknown;
  requiresProofApproval?: boolean;
  approvedProofVersionId?: string | null;
  proofStatuses?: string[];
  fulfillmentStatus?: unknown;
}): string {
  const raw = normalizeStatus(params.workflowState || params.status);
  const proofStatuses = (params.proofStatuses || []).map(normalizeStatus);
  const fulfillmentStatus = normalizeStatus(params.fulfillmentStatus);

  if (raw === "canceled" || raw === "cancelled") return "Canceled";
  if (raw === "on_hold") return "On Hold";
  if (params.requiresProofApproval && !params.approvedProofVersionId) {
    if (proofStatuses.includes("revision_requested") || proofStatuses.includes("rejected")) return "Revision Requested";
    return "Awaiting Proof Approval";
  }
  if (fulfillmentStatus === "shipped" || fulfillmentStatus === "delivered") return "Completed";
  if (raw === "completed" || raw === "complete" || raw === "production_complete") return "Completed";
  if (raw === "new" || raw === "created" || raw === "needs_design") return "Received";
  if (raw === "ready_for_prepress" || raw === "ready_for_production" || raw === "in_production") return "In Production";
  return "In Progress";
}

function isExpired(validUntil: unknown): boolean {
  if (!validUntil) return false;
  const date = validUntil instanceof Date ? validUntil : new Date(String(validUntil));
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
}

export function mapPortalQuoteStatus(params: {
  status?: unknown;
  validUntil?: unknown;
  convertedToOrderId?: unknown;
  workflowStatus?: unknown;
}): string {
  const status = normalizeStatus(params.status || "active");
  const workflowStatus = normalizeStatus(params.workflowStatus);
  if (params.convertedToOrderId) return "Converted to Order";
  if (workflowStatus === "customer_revision_requested" || workflowStatus === "revision_requested" || workflowStatus === "change_requested") {
    return "Revision Requested";
  }
  if (workflowStatus === "customer_approved" || workflowStatus === "staff_approved") return "Accepted";
  if (workflowStatus === "rejected" || workflowStatus === "customer_declined") return "Declined";
  if (status === "canceled" || status === "cancelled" || status === "void") return "Unavailable";
  if (isExpired(params.validUntil)) return "Expired";
  if (status === "accepted" || status === "approved") return "Accepted";
  if (status === "rejected" || status === "declined") return "Declined";
  if (status === "active" || status === "sent" || status === "pending" || status === "pending_approval") return "Ready for Review";
  if (status === "draft") return "Under Review";
  return "Under Review";
}

function buildQuoteExpirationSummary(validUntil: unknown, displayStatus: string): QuotePortalExpirationSummaryDto {
  const validUntilIso = toIso(validUntil);
  const expired = displayStatus === "Expired" || isExpired(validUntil);
  const expirationLabel = !validUntilIso
    ? "No expiration date"
    : expired
      ? `Expired ${formatShortDate(validUntilIso)}`
      : `Valid until ${formatShortDate(validUntilIso)}`;
  return { expired, expirationLabel, validUntil: validUntilIso };
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "date unavailable";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

function mapQuoteActions(displayStatus: string): QuotePortalActionsDto {
  if (displayStatus === "Ready for Review") {
    return {
      canView: true,
      canApprove: true,
      canDecline: true,
      canRequestRevision: true,
      disabledReason: null,
    };
  }

  if (displayStatus === "Expired") {
    return {
      canView: true,
      canApprove: false,
      canDecline: true,
      canRequestRevision: true,
      disabledReason: "This quote has expired and cannot be approved.",
    };
  }

  return {
    canView: true,
    canApprove: false,
    canDecline: false,
    canRequestRevision: false,
    disabledReason:
      displayStatus === "Converted to Order"
        ? "This quote has already been converted to an order."
        : displayStatus === "Declined"
          ? "This quote has been declined."
          : displayStatus === "Revision Requested"
            ? "Your revision request has been recorded."
            : "Quote actions are unavailable for this quote.",
  };
}

function methodLabel(payment: Pick<PaymentPortalRow, "provider" | "method">): string {
  const provider = String(payment.provider || "").toLowerCase();
  const method = String(payment.method || "").toLowerCase();

  if (provider === "stripe" || method === "credit_card") return "Credit card";
  if (method === "bank_transfer") return "Bank transfer";
  if (method === "ach") return "ACH";
  if (method === "wire") return "Wire";
  if (method === "check") return "Check";
  if (method === "cash") return "Cash";
  return "Other";
}

function mapPayment(payment: PaymentPortalRow): PortalInvoicePaymentDto {
  const metadata = payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {};
  const status = String(payment.status || "pending").toLowerCase();
  const permanentPaymentDate =
    status === "succeeded" || status === "refunded"
      ? payment.paidAt || payment.succeededAt || payment.appliedAt
      : null;

  return {
    id: payment.id,
    amount: centsToMoney(payment.amountCents),
    currency: String(payment.currency || "USD"),
    status,
    paidAt: toIso(permanentPaymentDate),
    methodLabel: methodLabel(payment),
    referenceNumber: typeof (metadata as any).reference === "string" ? String((metadata as any).reference) : null,
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
      canPayInvoices: true,
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
    status: normalizeInvoiceStatus(row.status),
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

async function getPortalInvoiceForPayment(scope: PortalScope, invoiceId: string): Promise<InvoicePaymentPortalRow | null> {
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
      shippingCents: invoices.shippingCents,
      totalCents: invoices.totalCents,
      currency: invoices.currency,
      orderId: invoices.orderId,
      notesPublic: invoices.notesPublic,
      terms: invoices.terms,
      customTerms: invoices.customTerms,
      importSource: invoices.importSource,
      isHistorical: invoices.isHistorical,
    })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, scope.organizationId), eq(invoices.customerId, scope.customerId)))
    .limit(1);

  return row ?? null;
}

async function loadPortalInvoicePaymentRows(organizationId: string, invoiceId: string): Promise<PaymentPortalRow[]> {
  return db
    .select({
      id: payments.id,
      invoiceId: payments.invoiceId,
      provider: payments.provider,
      status: payments.status,
      amountCents: payments.amountCents,
      currency: payments.currency,
      method: payments.method,
      metadata: payments.metadata,
      paidAt: payments.paidAt,
      succeededAt: payments.succeededAt,
      appliedAt: payments.appliedAt,
      stripePaymentIntentId: payments.stripePaymentIntentId,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .where(and(eq(payments.invoiceId, invoiceId), eq(payments.organizationId, organizationId)))
    .orderBy(desc(payments.createdAt));
}

function invoiceRollup(invoice: Pick<InvoicePaymentPortalRow, "totalCents">, paymentRows: PaymentPortalRow[]) {
  return computeInvoicePaymentRollup({
    invoiceTotalCents: Number(invoice.totalCents || 0),
    payments: paymentRows.map((payment) => ({
      id: payment.id,
      status: payment.status,
      amountCents: Number(payment.amountCents || 0),
    })),
  });
}

function isImportedQuickBooksInvoice(invoice: InvoicePaymentPortalRow): boolean {
  return String(invoice.importSource || "").trim().toLowerCase() === "quickbooks";
}

function assertPortalInvoicePayable(invoice: InvoicePaymentPortalRow, paymentRows: PaymentPortalRow[]): number {
  const status = String(invoice.status || "").trim().toLowerCase();
  if (!isPortalInvoiceStatusPayable(status)) {
    throw new PortalAccessError(409, "Invoice is not payable");
  }

  if (isImportedQuickBooksInvoice(invoice) || Boolean(invoice.isHistorical)) {
    throw new PortalAccessError(409, "Invoice is not payable in the portal");
  }

  const rollup = invoiceRollup(invoice, paymentRows);
  const amountDueCents = Math.max(0, Math.round(Number(rollup.amountDueCents || 0)));
  if (amountDueCents <= 0) {
    throw new PortalAccessError(409, "Invoice is already paid");
  }

  return amountDueCents;
}

async function getStripeAccountId(organizationId: string): Promise<string> {
  const [stripeConn] = await db
    .select({
      externalAccountId: integrationConnections.externalAccountId,
      status: integrationConnections.status,
    })
    .from(integrationConnections)
    .where(and(eq(integrationConnections.organizationId, organizationId), eq(integrationConnections.provider, "stripe")))
    .limit(1);

  const stripeAccountId = stripeConn?.externalAccountId ? String(stripeConn.externalAccountId) : "";
  if (!stripeAccountId || String(stripeConn?.status || "connected") === "disconnected") {
    throw new PortalAccessError(409, "Stripe is not connected for this organization");
  }

  return stripeAccountId;
}

async function markStripePaymentNonPending(paymentId: string, organizationId: string, status: "failed" | "canceled") {
  const now = new Date();
  await db
    .update(payments)
    .set({
      status,
      ...(status === "failed" ? { failedAt: now } : { canceledAt: now }),
      updatedAt: now,
    } as any)
    .where(and(eq(payments.id, paymentId), eq(payments.organizationId, organizationId)));
}

async function reconcileSucceededStripePayment(params: {
  organizationId: string;
  invoiceId: string;
  paymentId: string;
  amountCents: number;
}) {
  const now = new Date();
  await db
    .update(payments)
    .set({
      status: "succeeded",
      amount: (params.amountCents / 100).toFixed(2),
      amountCents: params.amountCents,
      paidAt: now,
      succeededAt: now,
      updatedAt: now,
    } as any)
    .where(and(eq(payments.id, params.paymentId), eq(payments.organizationId, params.organizationId), eq(payments.invoiceId, params.invoiceId)));

  await refreshInvoiceStatus(params.invoiceId);
}

async function refreshPortalInvoiceDto(scope: PortalScope, invoiceId: string): Promise<InvoicePortalDto> {
  const dto = await getPortalInvoice({ organizationId: scope.organizationId, portalCustomerId: scope.customerId, portalCustomer: scope.customer, user: { id: scope.userId } } as any, invoiceId);
  if (!dto) throw new PortalAccessError(404, "Not found");
  return dto;
}

export async function listPortalInvoicePayments(req: Request, invoiceId: string): Promise<PortalInvoicePaymentDto[] | null> {
  const scope = getPortalScope(req);
  const invoice = await getPortalInvoiceForPayment(scope, invoiceId);
  if (!invoice || !CUSTOMER_VISIBLE_INVOICE_STATUSES.includes(String(invoice.status || "").toLowerCase())) return null;

  const rows = await loadPortalInvoicePaymentRows(scope.organizationId, invoice.id);
  return rows.map(mapPayment);
}

export async function createPortalStripePaymentIntent(req: Request, invoiceId: string): Promise<PortalStripePaymentIntentDto | null> {
  const scope = getPortalScope(req);
  const invoice = await getPortalInvoiceForPayment(scope, invoiceId);
  if (!invoice) return null;

  const paymentRows = await loadPortalInvoicePaymentRows(scope.organizationId, invoice.id);
  const amountDueCents = assertPortalInvoicePayable(invoice, paymentRows);
  const currency = String(invoice.currency || "USD").toUpperCase();
  const stripeAccountId = await getStripeAccountId(scope.organizationId);
  const now = new Date();

  await db
    .update(payments)
    .set({ status: "canceled", canceledAt: now, updatedAt: now } as any)
    .where(
      and(
        eq(payments.organizationId, scope.organizationId),
        eq(payments.invoiceId, invoice.id),
        eq(payments.provider, "stripe"),
        eq(payments.status, "pending"),
        ne(payments.amountCents, amountDueCents),
      ),
    );

  const [existingPending] = await db
    .select({
      id: payments.id,
      stripePaymentIntentId: payments.stripePaymentIntentId,
    })
    .from(payments)
    .where(
      and(
        eq(payments.organizationId, scope.organizationId),
        eq(payments.invoiceId, invoice.id),
        eq(payments.provider, "stripe"),
        eq(payments.status, "pending"),
        eq(payments.amountCents, amountDueCents),
      ),
    )
    .orderBy(desc(payments.createdAt))
    .limit(1);

  if (existingPending?.stripePaymentIntentId) {
    try {
      const stripe = getStripeClient();
      const pi = await stripe.paymentIntents.retrieve(String(existingPending.stripePaymentIntentId), { stripeAccount: stripeAccountId } as any);
      const piStatus = String((pi as any).status || "").toLowerCase();

      if (piStatus === "succeeded") {
        const paidAmountCents = Math.max(0, Math.round(Number((pi as any).amount_received ?? (pi as any).amount ?? amountDueCents)));
        await reconcileSucceededStripePayment({
          organizationId: scope.organizationId,
          invoiceId: invoice.id,
          paymentId: existingPending.id,
          amountCents: paidAmountCents,
        });
        throw new PortalAccessError(409, "Invoice is already paid");
      }

      if (piStatus !== "canceled" && piStatus !== "failed" && (pi as any).client_secret) {
        return {
          clientSecret: String((pi as any).client_secret),
          paymentId: existingPending.id,
          invoiceId: invoice.id,
          amount: centsToMoney(amountDueCents),
          currency,
          stripeAccountId,
        };
      }

      await markStripePaymentNonPending(existingPending.id, scope.organizationId, piStatus === "failed" ? "failed" : "canceled");
    } catch (error) {
      if (error instanceof PortalAccessError) throw error;
      await markStripePaymentNonPending(existingPending.id, scope.organizationId, "canceled");
    }
  }

  const stripe = getStripeClient();
  const idempotencyKey = `${scope.organizationId}:${invoice.id}:${amountDueCents}:portal:v1`;
  const pi = await stripe.paymentIntents.create(
    {
      amount: amountDueCents,
      currency: currency.toLowerCase(),
      description: `Invoice #${invoice.invoiceNumber}`,
      automatic_payment_methods: { enabled: true },
      metadata: {
        organizationId: scope.organizationId,
        invoiceId: invoice.id,
        customerId: scope.customerId,
        stripeAccountId,
      },
    },
    {
      idempotencyKey,
      stripeAccount: stripeAccountId,
    } as any,
  );

  if (!pi.client_secret) throw new PortalAccessError(502, "Payment processor did not return a client secret");

  const paymentIntentId = String(pi.id);
  const [existingByIntent] = await db
    .select({
      id: payments.id,
      status: payments.status,
    })
    .from(payments)
    .where(and(eq(payments.organizationId, scope.organizationId), eq(payments.stripePaymentIntentId, paymentIntentId)))
    .limit(1);

  if (existingByIntent && String(existingByIntent.status || "").toLowerCase() === "pending") {
    return {
      clientSecret: String(pi.client_secret),
      paymentId: existingByIntent.id,
      invoiceId: invoice.id,
      amount: centsToMoney(amountDueCents),
      currency,
      stripeAccountId,
    };
  }

  const insertedRows = await db
    .insert(payments)
    .values({
      organizationId: scope.organizationId,
      invoiceId: invoice.id,
      provider: "stripe",
      status: "pending",
      amount: (amountDueCents / 100).toFixed(2),
      amountCents: amountDueCents,
      currency,
      stripePaymentIntentId: paymentIntentId,
      metadata: {
        portal: true,
        invoiceId: invoice.id,
        customerId: scope.customerId,
        stripeAccountId,
      },
      method: "credit_card",
      appliedAt: now,
      createdByUserId: scope.userId,
      syncStatus: "pending",
      createdAt: now,
      updatedAt: now,
    } as any)
    .onConflictDoNothing({ target: [payments.organizationId, payments.stripePaymentIntentId] })
    .returning({ id: payments.id });

  const paymentId = insertedRows[0]?.id;
  if (!paymentId) {
    const [existingAfterConflict] = await db
      .select({ id: payments.id, status: payments.status })
      .from(payments)
      .where(and(eq(payments.organizationId, scope.organizationId), eq(payments.stripePaymentIntentId, paymentIntentId)))
      .limit(1);

    if (!existingAfterConflict || String(existingAfterConflict.status || "").toLowerCase() !== "pending") {
      throw new PortalAccessError(500, "Failed to create payment record");
    }

    return {
      clientSecret: String(pi.client_secret),
      paymentId: existingAfterConflict.id,
      invoiceId: invoice.id,
      amount: centsToMoney(amountDueCents),
      currency,
      stripeAccountId,
    };
  }

  try {
    await db.insert(auditLogs).values({
      organizationId: scope.organizationId,
      userId: scope.userId,
      userName: getUserName((req as any).user),
      actionType: "portal_payment_intent_created",
      entityType: "invoice",
      entityId: invoice.id,
      entityName: String(invoice.invoiceNumber),
      description: "Portal Stripe PaymentIntent created",
      newValues: { paymentId, amountCents: amountDueCents } as any,
      createdAt: now,
    } as any);
  } catch {}

  return {
    clientSecret: String(pi.client_secret),
    paymentId,
    invoiceId: invoice.id,
    amount: centsToMoney(amountDueCents),
    currency,
    stripeAccountId,
  };
}

export async function confirmPortalStripePayment(req: Request, invoiceId: string): Promise<PortalStripeConfirmDto | null> {
  const scope = getPortalScope(req);
  const invoice = await getPortalInvoiceForPayment(scope, invoiceId);
  if (!invoice) return null;

  const paymentIntentId = String((req.body as any)?.paymentIntentId || "").trim();
  if (!paymentIntentId) {
    throw new PortalAccessError(400, "Missing payment intent");
  }

  const stripeAccountId = await getStripeAccountId(scope.organizationId);
  const stripe = getStripeClient();
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId, { stripeAccount: stripeAccountId } as any);
  const piStatus = String((pi as any).status || "").toLowerCase();
  const metadata = ((pi as any).metadata || {}) as Record<string, any>;

  if (String(metadata.organizationId || "") !== scope.organizationId || String(metadata.invoiceId || "") !== invoice.id) {
    throw new PortalAccessError(404, "Not found");
  }

  const [payment] = await db
    .select({
      id: payments.id,
      invoiceId: payments.invoiceId,
      provider: payments.provider,
      status: payments.status,
      amountCents: payments.amountCents,
      currency: payments.currency,
      method: payments.method,
      metadata: payments.metadata,
      paidAt: payments.paidAt,
      succeededAt: payments.succeededAt,
      appliedAt: payments.appliedAt,
      stripePaymentIntentId: payments.stripePaymentIntentId,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .where(and(eq(payments.organizationId, scope.organizationId), eq(payments.invoiceId, invoice.id), eq(payments.stripePaymentIntentId, paymentIntentId)))
    .limit(1);

  if (!payment) return null;

  const piAmountCents = Math.max(0, Math.round(Number((pi as any).amount_received ?? (pi as any).amount ?? 0)));
  const currentPaymentStatus = String(payment.status || "").toLowerCase();
  if (piStatus !== "succeeded" && currentPaymentStatus !== "succeeded") {
    const currentRows = await loadPortalInvoicePaymentRows(scope.organizationId, invoice.id);
    assertPortalInvoicePayable(invoice, currentRows);
  }

  if (piStatus === "succeeded") {
    if (Number(payment.amountCents || 0) !== piAmountCents) {
      throw new PortalAccessError(409, "Payment amount changed");
    }

    if (currentPaymentStatus !== "succeeded") {
      await reconcileSucceededStripePayment({
        organizationId: scope.organizationId,
        invoiceId: invoice.id,
        paymentId: payment.id,
        amountCents: piAmountCents,
      });
    } else {
      await refreshInvoiceStatus(invoice.id);
    }
  } else if (piStatus === "payment_failed" || piStatus === "requires_payment_method") {
    await markStripePaymentNonPending(payment.id, scope.organizationId, "failed");
  } else if (piStatus === "canceled") {
    await markStripePaymentNonPending(payment.id, scope.organizationId, "canceled");
  }

  const [updatedPayment] = await loadPortalInvoicePaymentRows(scope.organizationId, invoice.id).then((rows) =>
    rows.filter((row) => row.id === payment.id),
  );
  if (!updatedPayment) return null;

  return {
    payment: mapPayment(updatedPayment),
    invoice: await refreshPortalInvoiceDto(scope, invoice.id),
  };
}

export async function getPortalInvoicePdf(req: Request, invoiceId: string): Promise<PortalInvoicePdfResult | null> {
  const scope = getPortalScope(req);
  const invoice = await getPortalInvoiceForPayment(scope, invoiceId);
  if (!invoice || normalizeInvoiceStatus(invoice.status) === "draft") return null;

  let job: { poNumber?: string | null; jobNumber?: string | null } | null = null;
  if (invoice.orderId) {
    const [order] = await db
      .select({
        orderNumber: orders.orderNumber,
        poNumber: orders.poNumber,
      })
      .from(orders)
      .where(and(eq(orders.id, String(invoice.orderId)), eq(orders.organizationId, scope.organizationId), eq(orders.customerId, scope.customerId)))
      .limit(1);

    if (order) {
      job = {
        poNumber: order.poNumber ?? null,
        jobNumber: order.orderNumber ?? null,
      };
    }
  }

  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, scope.customerId), eq(customers.organizationId, scope.organizationId)))
    .limit(1);

  const [orgCompany] = await db
    .select()
    .from(companySettings)
    .where(eq(companySettings.organizationId, scope.organizationId))
    .limit(1);

  const lineItems = await db
    .select()
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, invoice.id))
    .orderBy(invoiceLineItems.sortOrder, desc(invoiceLineItems.createdAt));

  const paymentRows = await loadPortalInvoicePaymentRows(scope.organizationId, invoice.id);
  const rollup = invoiceRollup(invoice, paymentRows);
  const statusLabel = getInvoicePaymentStatusLabel({ invoiceStatus: invoice.status, rollup });
  const pdfBytes = await generateInvoicePdfBytes({
    invoice: invoice as any,
    customer: (customer as any) || null,
    companySettings: (orgCompany as any) || null,
    paymentSummary: {
      amountPaidCents: rollup.amountPaidCents,
      amountDueCents: rollup.amountDueCents,
      statusLabel,
    },
    lineItems: lineItems as any,
    job,
  });

  return {
    bytes: Buffer.from(pdfBytes),
    filename: `invoice-${invoice.invoiceNumber ? String(invoice.invoiceNumber) : invoice.id}.pdf`,
  };
}

function sanitizeDownloadFilename(value: unknown, fallback: string): string {
  const raw = String(value || fallback || "download").trim() || "download";
  return raw.replace(/[\r\n\t\0]/g, " ").replace(/"/g, "'").slice(0, 240);
}

function fileTypeLabel(mimeType: unknown, filename: unknown): string {
  const mime = String(mimeType || "").toLowerCase();
  const name = String(filename || "").toLowerCase();
  if (mime.includes("pdf") || name.endsWith(".pdf")) return "PDF";
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|tiff?)$/.test(name)) return "Image";
  if (mime.includes("zip") || name.endsWith(".zip")) return "Archive";
  if (mime.includes("text") || /\.(txt|csv)$/.test(name)) return "Document";
  return "File";
}

function mapPortalAttachmentFile(
  attachment: PortalAttachmentRow,
  categoryLabel: string,
  idPrefix = "",
): PortalFileDto {
  const displayName = sanitizeDownloadFilename(attachment.originalFilename || attachment.fileName, `file-${attachment.id}`);
  return {
    id: `${idPrefix}${attachment.id}`,
    displayName,
    fileTypeLabel: fileTypeLabel(attachment.mimeType, displayName),
    uploadedAt: toIso(attachment.createdAt),
    fileSize: attachment.sizeBytes ?? attachment.fileSize ?? null,
    categoryLabel,
    previewAvailable: Boolean(attachment.previewKey || attachment.thumbKey || attachment.thumbnailUrl),
    downloadAvailable: Boolean(attachment.fileRecordId || attachment.fileUrl),
  };
}

function mapInvoicePdfFile(invoice: InvoicePaymentPortalRow): PortalFileDto {
  const invoiceNumber = invoice.invoiceNumber ? String(invoice.invoiceNumber) : invoice.id;
  return {
    id: "pdf",
    displayName: `invoice-${invoiceNumber}.pdf`,
    fileTypeLabel: "PDF",
    uploadedAt: toIso(invoice.issueDate),
    fileSize: null,
    categoryLabel: "Invoice",
    previewAvailable: true,
    downloadAvailable: true,
  };
}

async function getScopedPortalOrderId(scope: PortalScope, orderId: string): Promise<string | null> {
  const [order] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.organizationId, scope.organizationId), eq(orders.customerId, scope.customerId)))
    .limit(1);
  return order?.id ?? null;
}

async function getScopedPortalQuoteId(scope: PortalScope, quoteId: string): Promise<string | null> {
  const [quote] = await db
    .select({ id: quotes.id })
    .from(quotes)
    .where(
      and(
        eq(quotes.id, quoteId),
        eq(quotes.organizationId, scope.organizationId),
        eq(quotes.customerId, scope.customerId),
        inArray(quotes.status, CUSTOMER_VISIBLE_QUOTE_STATUSES),
      ),
    )
    .limit(1);
  return quote?.id ?? null;
}

async function getCustomerVisibleProofAttachmentIds(scope: PortalScope, orderId: string): Promise<Set<string>> {
  const proofRows = await db
    .select({ proofFileId: lineItemProofVersions.proofFileId })
    .from(lineItemProofVersions)
    .where(
      and(
        eq(lineItemProofVersions.organizationId, scope.organizationId),
        eq(lineItemProofVersions.orderId, orderId),
        inArray(lineItemProofVersions.status, ["awaiting_response", "approved", "rejected", "revision_requested"]),
      ),
    );
  return new Set(proofRows.map((row) => row.proofFileId).filter(Boolean));
}

function isCustomerVisibleOrderAttachment(attachment: PortalAttachmentRow, proofAttachmentIds: Set<string>, scope: PortalScope): boolean {
  const role = normalizeStatus(attachment.role);
  if (proofAttachmentIds.has(attachment.id)) return true;
  if (role === "customer_po") return true;
  if (attachment.uploadedByUserId && attachment.uploadedByUserId === scope.userId) return true;
  return false;
}

function orderAttachmentCategory(attachment: PortalAttachmentRow, proofAttachmentIds: Set<string>): string {
  const role = normalizeStatus(attachment.role);
  if (proofAttachmentIds.has(attachment.id) || role === "proof") return "Proof";
  if (role === "customer_po") return "Customer PO";
  return "Customer File";
}

async function loadVisibleOrderAttachments(scope: PortalScope, orderId: string): Promise<PortalAttachmentRow[] | null> {
  const scopedOrderId = await getScopedPortalOrderId(scope, orderId);
  if (!scopedOrderId) return null;
  const proofAttachmentIds = await getCustomerVisibleProofAttachmentIds(scope, scopedOrderId);
  const rows = await db
    .select({
      id: orderAttachments.id,
      fileRecordId: orderAttachments.fileRecordId,
      fileName: orderAttachments.fileName,
      originalFilename: orderAttachments.originalFilename,
      mimeType: orderAttachments.mimeType,
      fileUrl: orderAttachments.fileUrl,
      fileSize: orderAttachments.fileSize,
      sizeBytes: orderAttachments.sizeBytes,
      createdAt: orderAttachments.createdAt,
      role: orderAttachments.role,
      uploadedByUserId: orderAttachments.uploadedByUserId,
      thumbKey: orderAttachments.thumbKey,
      previewKey: orderAttachments.previewKey,
      thumbnailUrl: orderAttachments.thumbnailUrl,
    })
    .from(orderAttachments)
    .where(eq(orderAttachments.orderId, scopedOrderId))
    .orderBy(desc(orderAttachments.createdAt));

  return rows.filter((row) => isCustomerVisibleOrderAttachment(row, proofAttachmentIds, scope));
}

async function loadVisibleQuoteAttachments(scope: PortalScope, quoteId: string): Promise<PortalAttachmentRow[] | null> {
  const scopedQuoteId = await getScopedPortalQuoteId(scope, quoteId);
  if (!scopedQuoteId) return null;
  const rows = await db
    .select({
      id: quoteAttachments.id,
      fileRecordId: quoteAttachments.fileRecordId,
      fileName: quoteAttachments.fileName,
      originalFilename: quoteAttachments.originalFilename,
      mimeType: quoteAttachments.mimeType,
      fileUrl: quoteAttachments.fileUrl,
      fileSize: quoteAttachments.fileSize,
      sizeBytes: quoteAttachments.sizeBytes,
      createdAt: quoteAttachments.createdAt,
      uploadedByUserId: quoteAttachments.uploadedByUserId,
      thumbKey: quoteAttachments.thumbKey,
      previewKey: quoteAttachments.previewKey,
      bucket: quoteAttachments.bucket,
    })
    .from(quoteAttachments)
    .where(and(eq(quoteAttachments.quoteId, scopedQuoteId), eq(quoteAttachments.organizationId, scope.organizationId)))
    .orderBy(desc(quoteAttachments.createdAt));

  return rows.filter((row) => row.uploadedByUserId === scope.userId);
}

export async function listPortalInvoiceFiles(req: Request, invoiceId: string): Promise<PortalFileDto[] | null> {
  const scope = getPortalScope(req);
  const invoice = await getPortalInvoiceForPayment(scope, invoiceId);
  if (!invoice || normalizeInvoiceStatus(invoice.status) === "draft") return null;
  return [mapInvoicePdfFile(invoice)];
}

export async function listPortalOrderFiles(req: Request, orderId: string): Promise<PortalFileDto[] | null> {
  const scope = getPortalScope(req);
  const attachments = await loadVisibleOrderAttachments(scope, orderId);
  if (!attachments) return null;
  const proofAttachmentIds = await getCustomerVisibleProofAttachmentIds(scope, orderId);
  return attachments.map((attachment) => mapPortalAttachmentFile(attachment, orderAttachmentCategory(attachment, proofAttachmentIds), "oa_"));
}

export async function listPortalQuoteFiles(req: Request, quoteId: string): Promise<PortalFileDto[] | null> {
  const scope = getPortalScope(req);
  const attachments = await loadVisibleQuoteAttachments(scope, quoteId);
  if (!attachments) return null;
  return attachments.map((attachment) => mapPortalAttachmentFile(attachment, "Quote File", "qa_"));
}

async function portalAttachmentDownload(attachment: PortalAttachmentRow): Promise<PortalFileDownloadResult | null> {
  const access = await resolveOriginalFileAccess(attachment);
  if (!access.objectPath || access.availabilityStatus !== "available") return null;
  return {
    filename: sanitizeDownloadFilename(access.displayFilename || attachment.originalFilename || attachment.fileName, `file-${attachment.id}`),
    mimeType: access.mimeType || attachment.mimeType || "application/octet-stream",
    objectPath: access.objectPath,
  };
}

export async function getPortalInvoiceFileDownload(req: Request, invoiceId: string, fileId: string): Promise<PortalFileDownloadResult | null> {
  if (fileId !== "pdf") return null;
  const pdf = await getPortalInvoicePdf(req, invoiceId);
  if (!pdf) return null;
  return { filename: pdf.filename, mimeType: "application/pdf", bytes: pdf.bytes };
}

export async function getPortalOrderFileDownload(req: Request, orderId: string, fileId: string): Promise<PortalFileDownloadResult | null> {
  const scope = getPortalScope(req);
  const normalizedFileId = fileId.startsWith("oa_") ? fileId.slice(3) : fileId;
  const attachments = await loadVisibleOrderAttachments(scope, orderId);
  if (!attachments) return null;
  const attachment = attachments.find((row) => row.id === normalizedFileId);
  if (!attachment) return null;
  return portalAttachmentDownload(attachment);
}

export async function getPortalQuoteFileDownload(req: Request, quoteId: string, fileId: string): Promise<PortalFileDownloadResult | null> {
  const scope = getPortalScope(req);
  const normalizedFileId = fileId.startsWith("qa_") ? fileId.slice(3) : fileId;
  const attachments = await loadVisibleQuoteAttachments(scope, quoteId);
  if (!attachments) return null;
  const attachment = attachments.find((row) => row.id === normalizedFileId);
  if (!attachment) return null;
  return portalAttachmentDownload(attachment);
}

function buildProofSummary(
  lineItems: Array<{ id: string; requiresProofApproval: boolean; approvedProofVersionId: string | null }>,
  proofVersions: Array<{ lineItemId: string; status: string; versionNumber: number }>,
): OrderPortalProofSummaryDto {
  const requiredLineItemIds = new Set(lineItems.filter((lineItem) => lineItem.requiresProofApproval).map((lineItem) => lineItem.id));
  const requiredCount = requiredLineItemIds.size;
  const approvedCount = lineItems.filter((lineItem) => lineItem.requiresProofApproval && lineItem.approvedProofVersionId).length;
  let revisionRequestedCount = 0;
  let latestVersionNumber: number | null = null;

  for (const version of proofVersions) {
    if (requiredLineItemIds.has(version.lineItemId)) {
      latestVersionNumber = Math.max(latestVersionNumber ?? 0, Number(version.versionNumber || 0)) || null;
    }
    if (requiredLineItemIds.has(version.lineItemId) && version.status === "revision_requested") {
      revisionRequestedCount += 1;
    }
  }

  const pendingCount = Math.max(0, requiredCount - approvedCount - revisionRequestedCount);
  const statusKey =
    requiredCount === 0
      ? "not_required"
      : approvedCount >= requiredCount
        ? "approved"
        : revisionRequestedCount > 0
          ? "revision_requested"
          : "pending";
  const actionRequired = statusKey === "pending" || statusKey === "revision_requested";
  const statusLabel =
    statusKey === "not_required"
      ? "No proof required"
      : statusKey === "approved"
        ? "Proof approved"
        : statusKey === "revision_requested"
          ? "Revision requested"
          : "Awaiting customer approval";

  return {
    proofRequired: requiredCount > 0,
    statusLabel,
    actionRequired,
    latestVersionNumber,
    proofLinkAvailable: false,
    requiredCount,
    approvedCount,
    pendingCount,
    revisionRequestedCount,
  };
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
        shippedAt: shipments.shippedAt,
        carrier: shipments.carrier,
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

async function loadPickupTicketsForOrders(organizationId: string, orderIds: string[]) {
  if (orderIds.length === 0) return new Map<string, PickupTicketPortalRow>();

  const rows = await db
    .select({
      orderId: pickupTickets.orderId,
      status: pickupTickets.status,
      readyAt: pickupTickets.readyAt,
      pickedUpAt: pickupTickets.pickedUpAt,
    })
    .from(pickupTickets)
    .where(and(eq(pickupTickets.organizationId, organizationId), inArray(pickupTickets.orderId, orderIds)));

  const byOrderId = new Map<string, PickupTicketPortalRow>();
  for (const row of rows) {
    byOrderId.set(row.orderId, row);
  }
  return byOrderId;
}

async function loadInvoiceSummariesForOrders(organizationId: string, customerId: string, orderIds: string[]) {
  if (orderIds.length === 0) return new Map<string, OrderPortalInvoiceSummaryDto>();

  const rows = await db
    .select({
      id: invoices.id,
      orderId: invoices.orderId,
      status: invoices.status,
      totalCents: invoices.totalCents,
      currency: invoices.currency,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        eq(invoices.customerId, customerId),
        inArray(invoices.orderId, orderIds),
        inArray(invoices.status, CUSTOMER_VISIBLE_INVOICE_STATUSES),
      ),
    );

  const paymentsByInvoiceId = await loadInvoicePayments(organizationId, rows.map((row) => row.id));
  const byOrderId = new Map<string, OrderPortalInvoiceSummaryDto>();
  for (const row of rows as OrderInvoiceSummaryRow[]) {
    if (!row.orderId) continue;
    const rollup = computeInvoicePaymentRollup({
      invoiceTotalCents: Number(row.totalCents || 0),
      payments: (paymentsByInvoiceId.get(row.id) ?? []).map((payment) => ({
        id: payment.id,
        status: payment.status,
        amountCents: Number(payment.amountCents || 0),
      })),
    });
    const current = byOrderId.get(row.orderId) ?? {
      invoiceCount: 0,
      openInvoiceCount: 0,
      paidInvoiceCount: 0,
      amountDue: 0,
      total: 0,
      currency: String(row.currency || "USD"),
    };
    current.invoiceCount += 1;
    current.amountDue += centsToMoney(rollup.amountDueCents);
    current.total += centsToMoney(row.totalCents);
    if (rollup.amountDueCents <= 0) current.paidInvoiceCount += 1;
    else current.openInvoiceCount += 1;
    byOrderId.set(row.orderId, current);
  }

  for (const summary of Array.from(byOrderId.values())) {
    summary.amountDue = Math.round(summary.amountDue * 100) / 100;
    summary.total = Math.round(summary.total * 100) / 100;
  }
  return byOrderId;
}

function methodLabelForOrder(raw: unknown): string | null {
  const method = normalizeStatus(raw);
  if (!method) return null;
  if (method === "pickup") return "Pickup";
  if (method === "ship") return "Shipping";
  if (method === "deliver" || method === "delivery") return "Delivery";
  return "Fulfillment";
}

function buildFulfillmentSummary(
  order: OrderPortalRow,
  orderShipments: ShipmentPortalRow[],
  pickupTicket: PickupTicketPortalRow | null,
): OrderPortalFulfillmentSummaryDto {
  const method = normalizeStatus(order.shippingMethod);
  const fulfillment = normalizeStatus(order.fulfillmentStatus);
  const activeShipments = orderShipments.filter((shipment) => normalizeStatus(shipment.status) !== "voided");
  const shippedShipment = activeShipments.find((shipment) => normalizeStatus(shipment.status) === "shipped") ?? activeShipments[0];
  const trackingNumber = String(order.trackingNumber || shippedShipment?.trackingNumber || "").trim() || null;
  const shippedAt = order.shippedAt || shippedShipment?.shippedAt || null;
  const pickupStatus = normalizeStatus(pickupTicket?.status);

  let statusLabel = "Not ready";
  if (pickupTicket?.pickedUpAt || pickupStatus === "picked_up" || (method === "pickup" && fulfillment === "delivered")) {
    statusLabel = "Picked up";
  } else if (shippedAt || fulfillment === "shipped" || normalizeStatus(shippedShipment?.status) === "shipped") {
    statusLabel = "Shipped";
  } else if (pickupTicket?.readyAt || pickupStatus === "ready" || (method === "pickup" && fulfillment === "packed")) {
    statusLabel = "Ready for pickup";
  } else if (method !== "pickup" && fulfillment === "packed") {
    statusLabel = "Ready to ship";
  }

  return {
    methodLabel: methodLabelForOrder(order.shippingMethod),
    statusLabel,
    trackingNumber,
    trackingUrl: null,
    shippedAt: toIso(shippedAt),
    pickupReadyAt: toIso(pickupTicket?.readyAt),
  };
}

function mapOrderDetail(
  order: OrderPortalRow,
  lineItems: OrderLineItemPortalRow[],
  orderShipments: ShipmentPortalRow[],
  pickupTicket: PickupTicketPortalRow | null,
  proofVersions: Array<{ lineItemId: string; status: string; versionNumber: number }>,
  invoiceSummary: OrderPortalInvoiceSummaryDto | null,
): OrderPortalDetailDto {
  const proofSummary = buildProofSummary(
    lineItems.map((lineItem) => ({
      id: lineItem.id,
      requiresProofApproval: Boolean(lineItem.requiresProofApproval),
      approvedProofVersionId: lineItem.approvedProofVersionId ?? null,
    })),
    proofVersions,
  );
  const fulfillmentSummary = buildFulfillmentSummary(order, orderShipments, pickupTicket);
  const displayStatus = mapPortalOrderStatus({
    state: order.state,
    status: order.status,
    statusPillValue: order.statusPillValue,
    fulfillmentStatus: order.fulfillmentStatus,
    shippingMethod: order.shippingMethod,
    proofActionRequired: proofSummary.actionRequired,
  });
  const safeLineItems = lineItems.map((lineItem) => ({
    id: lineItem.id,
    name: lineItem.description,
    description: null,
    quantity: Number(lineItem.quantity || 0),
    dimensions: {
      width: lineItem.width == null ? null : Number(lineItem.width),
      height: lineItem.height == null ? null : Number(lineItem.height),
    },
    displayStatus: mapPortalLineItemStatus({
      status: lineItem.status,
      workflowState: lineItem.workflowState,
      requiresProofApproval: Boolean(lineItem.requiresProofApproval),
      approvedProofVersionId: lineItem.approvedProofVersionId ?? null,
      proofStatuses: proofVersions.filter((version) => version.lineItemId === lineItem.id).map((version) => version.status),
      fulfillmentStatus: order.fulfillmentStatus,
    }),
    proofStatus: lineItem.requiresProofApproval ? (lineItem.approvedProofVersionId ? "Approved" : "Awaiting proof approval") : null,
    fulfillmentStatusLabel: fulfillmentSummary.statusLabel,
  }));

  return {
    id: order.id,
    orderNumber: String(order.orderNumber),
    customerPoNumber: order.poNumber ?? null,
    createdAt: toIso(order.createdAt),
    updatedAt: toIso(order.updatedAt),
    displayStatus,
    rawStatus: null,
    total: toMoney(order.total),
    itemCount: lineItems.length,
    proofStatusSummary: proofSummary,
    fulfillmentSummary,
    lineItems: safeLineItems,
    invoiceSummary,
  };
}

function mapOrderList(detail: OrderPortalDetailDto): OrderPortalListDto {
  const { lineItems: _lineItems, invoiceSummary: _invoiceSummary, ...listDto } = detail;
  return listDto;
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
  if (lineItemIds.length === 0) return new Map<string, Array<{ lineItemId: string; status: string; versionNumber: number }>>();

  const rows = await db
    .select({
      lineItemId: lineItemProofVersions.lineItemId,
      status: lineItemProofVersions.status,
      versionNumber: lineItemProofVersions.versionNumber,
    })
    .from(lineItemProofVersions)
    .where(and(eq(lineItemProofVersions.organizationId, organizationId), inArray(lineItemProofVersions.lineItemId, lineItemIds)));

  const byLineItemId = new Map<string, Array<{ lineItemId: string; status: string; versionNumber: number }>>();
  for (const row of rows) {
    const list = byLineItemId.get(row.lineItemId) ?? [];
    list.push(row);
    byLineItemId.set(row.lineItemId, list);
  }
  return byLineItemId;
}

export async function listPortalOrders(req: Request): Promise<OrderPortalListDto[]> {
  const scope = getPortalScope(req);
  const rows = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      poNumber: orders.poNumber,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
      status: orders.status,
      state: orders.state,
      statusPillValue: orders.statusPillValue,
      total: orders.total,
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
  const pickupTicketsByOrderId = await loadPickupTicketsForOrders(scope.organizationId, orderIds);
  const invoiceSummariesByOrderId = await loadInvoiceSummariesForOrders(scope.organizationId, scope.customerId, orderIds);

  return rows.map((order) => {
    const lineItems = lineItemsByOrderId.get(order.id) ?? [];
    const proofVersions = lineItems.flatMap((lineItem) => proofVersionsByLineItemId.get(lineItem.id) ?? []);
    return mapOrderList(
      mapOrderDetail(
        order,
        lineItems,
        shipmentsByOrderId.get(order.id) ?? [],
        pickupTicketsByOrderId.get(order.id) ?? null,
        proofVersions,
        invoiceSummariesByOrderId.get(order.id) ?? null,
      ),
    );
  });
}

export async function getPortalOrder(req: Request, orderId: string): Promise<OrderPortalDetailDto | null> {
  const scope = getPortalScope(req);
  const [order] = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      poNumber: orders.poNumber,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
      status: orders.status,
      state: orders.state,
      statusPillValue: orders.statusPillValue,
      total: orders.total,
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
  const pickupTicketsByOrderId = await loadPickupTicketsForOrders(scope.organizationId, [order.id]);
  const invoiceSummariesByOrderId = await loadInvoiceSummariesForOrders(scope.organizationId, scope.customerId, [order.id]);
  const proofVersions = lineItems.flatMap((lineItem) => proofVersionsByLineItemId.get(lineItem.id) ?? []);
  return mapOrderDetail(
    order,
    lineItems,
    shipmentsByOrderId.get(order.id) ?? [],
    pickupTicketsByOrderId.get(order.id) ?? null,
    proofVersions,
    invoiceSummariesByOrderId.get(order.id) ?? null,
  );
}

function safeQuoteDisplayOptions(selectedOptions: unknown): string[] {
  if (!Array.isArray(selectedOptions)) return [];
  return selectedOptions
    .map((option) => {
      if (!option || typeof option !== "object") return null;
      const optionName = String((option as any).optionName || "").trim();
      const value = (option as any).value;
      if (!optionName || value == null || typeof value === "object") return null;
      return `${optionName}: ${String(value)}`.slice(0, 120);
    })
    .filter((value): value is string => Boolean(value));
}

function mapQuoteDetail(
  quote: QuotePortalRow,
  lineItems: QuoteLineItemPortalRow[],
  workflowState: QuoteWorkflowPortalRow | null = null,
): QuotePortalDetailDto {
  const displayStatus = mapPortalQuoteStatus({
    status: quote.status,
    validUntil: quote.validUntil,
    convertedToOrderId: quote.convertedToOrderId,
    workflowStatus: workflowState?.status,
  });
  const mappedLineItems = lineItems.map((lineItem) => {
    const quantity = Math.max(1, Number(lineItem.quantity || 0));
    const lineTotal = toMoney(lineItem.linePrice);
    return {
      id: lineItem.id,
      name: lineItem.productName,
      description: lineItem.description ? String(lineItem.description) : null,
      quantity,
      dimensions: {
        width: lineItem.width == null ? null : Number(lineItem.width),
        height: lineItem.height == null ? null : Number(lineItem.height),
      },
      unitPrice: Math.round((lineTotal / quantity) * 100) / 100,
      lineTotal,
      displayOptions: safeQuoteDisplayOptions(lineItem.selectedOptions),
    };
  });
  return {
    id: quote.id,
    quoteNumber: quote.quoteNumber == null ? null : Number(quote.quoteNumber),
    createdAt: toIso(quote.createdAt),
    validUntil: toIso(quote.validUntil),
    displayStatus,
    total: toMoney(quote.totalPrice),
    itemCount: mappedLineItems.length,
    customerVisibleActions: mapQuoteActions(displayStatus),
    subtotal: toMoney(quote.subtotal),
    tax: toMoney(quote.taxAmount),
    lineItems: mappedLineItems,
    expirationSummary: buildQuoteExpirationSummary(quote.validUntil, displayStatus),
  };
}

function mapQuoteList(detail: QuotePortalDetailDto): QuotePortalListDto {
  const { subtotal: _subtotal, tax: _tax, lineItems: _lineItems, expirationSummary: _expirationSummary, ...listDto } = detail;
  return listDto;
}

async function loadQuoteLineItems(quoteIds: string[]) {
  if (quoteIds.length === 0) return new Map<string, QuoteLineItemPortalRow[]>();

  const rows = await db
    .select({
      id: quoteLineItems.id,
      quoteId: quoteLineItems.quoteId,
      productName: quoteLineItems.productName,
      description: quoteLineItems.description,
      width: quoteLineItems.width,
      height: quoteLineItems.height,
      quantity: quoteLineItems.quantity,
      linePrice: quoteLineItems.linePrice,
      selectedOptions: quoteLineItems.selectedOptions,
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

async function loadQuoteWorkflowStates(quoteIds: string[]) {
  if (quoteIds.length === 0) return new Map<string, QuoteWorkflowPortalRow>();

  const rows = await db
    .select({
      quoteId: quoteWorkflowStates.quoteId,
      status: quoteWorkflowStates.status,
      customerNotes: quoteWorkflowStates.customerNotes,
      rejectionReason: quoteWorkflowStates.rejectionReason,
    })
    .from(quoteWorkflowStates)
    .where(inArray(quoteWorkflowStates.quoteId, quoteIds));

  return new Map(rows.map((row) => [row.quoteId, row]));
}

const CUSTOMER_VISIBLE_QUOTE_STATUSES: Array<"active" | "pending" | "pending_approval" | "canceled"> = [
  "active",
  "pending",
  "pending_approval",
  "canceled",
];

export async function listPortalQuotes(req: Request): Promise<QuotePortalListDto[]> {
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
      convertedToOrderId: quotes.convertedToOrderId,
    })
    .from(quotes)
    .where(and(eq(quotes.organizationId, scope.organizationId), eq(quotes.customerId, scope.customerId), inArray(quotes.status, CUSTOMER_VISIBLE_QUOTE_STATUSES)))
    .orderBy(desc(quotes.createdAt));

  const lineItemsByQuoteId = await loadQuoteLineItems(rows.map((row) => row.id));
  const workflowStatesByQuoteId = await loadQuoteWorkflowStates(rows.map((row) => row.id));
  return rows.map((quote) =>
    mapQuoteList(mapQuoteDetail(quote, lineItemsByQuoteId.get(quote.id) ?? [], workflowStatesByQuoteId.get(quote.id) ?? null)),
  );
}

export async function getPortalQuote(req: Request, quoteId: string): Promise<QuotePortalDetailDto | null> {
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
      convertedToOrderId: quotes.convertedToOrderId,
    })
    .from(quotes)
    .where(and(eq(quotes.id, quoteId), eq(quotes.organizationId, scope.organizationId), eq(quotes.customerId, scope.customerId), inArray(quotes.status, CUSTOMER_VISIBLE_QUOTE_STATUSES)))
    .limit(1);

  if (!quote) return null;
  const lineItemsByQuoteId = await loadQuoteLineItems([quote.id]);
  const workflowStatesByQuoteId = await loadQuoteWorkflowStates([quote.id]);
  return mapQuoteDetail(quote, lineItemsByQuoteId.get(quote.id) ?? [], workflowStatesByQuoteId.get(quote.id) ?? null);
}

function sanitizePortalActionNote(value: unknown): string | null {
  const note = String(value || "").trim();
  if (!note) return null;
  return note.slice(0, 1000);
}

async function lockPortalQuoteAction(tx: Pick<typeof db, "execute">, quoteId: string) {
  // Quote actions create permanent state, so retries/double-clicks are serialized per quote.
  // This transaction-level advisory lock is independent of the migration lock and releases
  // automatically at transaction end; it avoids unbounded session-level locks.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`portal_quote_action:${quoteId}`}))`);
}

async function getScopedPortalQuoteRecord(scope: PortalScope, quoteId: string): Promise<QuotePortalRow | null> {
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
      convertedToOrderId: quotes.convertedToOrderId,
    })
    .from(quotes)
    .where(and(eq(quotes.id, quoteId), eq(quotes.organizationId, scope.organizationId), eq(quotes.customerId, scope.customerId)))
    .limit(1);

  return quote ?? null;
}

async function getPortalWorkflowState(quoteId: string): Promise<QuoteWorkflowPortalRow | null> {
  const workflowStates = await loadQuoteWorkflowStates([quoteId]);
  return workflowStates.get(quoteId) ?? null;
}

async function upsertPortalQuoteWorkflowState(
  quoteId: string,
  values: Partial<typeof quoteWorkflowStates.$inferInsert> & { status: string },
) {
  const [existing] = await db
    .select({ id: quoteWorkflowStates.id })
    .from(quoteWorkflowStates)
    .where(eq(quoteWorkflowStates.quoteId, quoteId))
    .limit(1);

  if (existing) {
    await db
      .update(quoteWorkflowStates)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(quoteWorkflowStates.id, existing.id));
    return;
  }

  await db.insert(quoteWorkflowStates).values({ quoteId, ...values } as typeof quoteWorkflowStates.$inferInsert);
}

async function getConvertedOrderSummary(scope: PortalScope, quote: QuotePortalRow): Promise<QuotePortalOrderSummaryDto | null> {
  const orderWhere = quote.convertedToOrderId
    ? and(
        eq(orders.id, String(quote.convertedToOrderId)),
        eq(orders.organizationId, scope.organizationId),
        eq(orders.customerId, scope.customerId),
      )
    : and(eq(orders.quoteId, quote.id), eq(orders.organizationId, scope.organizationId), eq(orders.customerId, scope.customerId));

  const [order] = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      state: orders.state,
      statusPillValue: orders.statusPillValue,
      fulfillmentStatus: orders.fulfillmentStatus,
      shippingMethod: orders.shippingMethod,
    })
    .from(orders)
    .where(orderWhere)
    .limit(1);

  if (!order) return null;

  if (!quote.convertedToOrderId) {
    await db
      .update(quotes)
      .set({ convertedToOrderId: order.id })
      .where(and(eq(quotes.id, quote.id), eq(quotes.organizationId, scope.organizationId)));
  }

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    displayStatus: mapPortalOrderStatus(order),
  };
}

function assertPortalQuoteCanApprove(quote: QuotePortalRow, workflowState: QuoteWorkflowPortalRow | null) {
  const displayStatus = mapPortalQuoteStatus({
    status: quote.status,
    validUntil: quote.validUntil,
    convertedToOrderId: quote.convertedToOrderId,
    workflowStatus: workflowState?.status,
  });

  if (displayStatus === "Expired") {
    throw new PortalAccessError(409, "This quote has expired and cannot be approved.");
  }
  if (displayStatus === "Unavailable" || displayStatus === "Declined" || displayStatus === "Revision Requested") {
    throw new PortalAccessError(409, "This quote is not available for approval.");
  }
  if (normalizeStatus(quote.status) === "draft") {
    throw new PortalAccessError(404, "Not found");
  }
}

function assertPortalQuoteCanDeclineOrRevise(quote: QuotePortalRow, workflowState: QuoteWorkflowPortalRow | null) {
  const displayStatus = mapPortalQuoteStatus({
    status: quote.status,
    validUntil: quote.validUntil,
    convertedToOrderId: quote.convertedToOrderId,
    workflowStatus: workflowState?.status,
  });

  if (displayStatus === "Converted to Order" || displayStatus === "Unavailable") {
    throw new PortalAccessError(409, "This quote is not available for this action.");
  }
  if (normalizeStatus(quote.status) === "draft") {
    throw new PortalAccessError(404, "Not found");
  }
}

async function writePortalQuoteAudit(args: {
  req: Request;
  scope: PortalScope;
  quote: QuotePortalRow;
  actionType: string;
  description: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
}) {
  try {
    await db.insert(auditLogs).values({
      organizationId: args.scope.organizationId,
      userId: args.scope.userId,
      userName: getUserName((args.req as any).user),
      actionType: args.actionType,
      entityType: "quote",
      entityId: args.quote.id,
      entityName: args.quote.quoteNumber != null ? String(args.quote.quoteNumber) : args.quote.id,
      description: args.description,
      oldValues: args.oldValues,
      newValues: args.newValues,
      ipAddress: args.req.ip,
      userAgent: args.req.get("user-agent") || null,
    });
  } catch (error) {
    console.error("[Portal Quote Action] audit log failed", {
      quoteId: args.quote.id,
      actionType: args.actionType,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function getRequiredPortalQuoteActionResult(
  req: Request,
  quoteId: string,
  message: string,
  order?: QuotePortalOrderSummaryDto | null,
): Promise<QuotePortalActionResultDto> {
  const quote = await getPortalQuote(req, quoteId);
  if (!quote) {
    throw new PortalAccessError(404, "Not found");
  }
  return order ? { quote, order, message } : { quote, message };
}

export async function approvePortalQuote(req: Request, quoteId: string): Promise<QuotePortalActionResultDto | null> {
  const scope = getPortalScope(req);
  const note = sanitizePortalActionNote((req.body as any)?.note ?? (req.body as any)?.customerNotes);

  return db.transaction(async (tx) => {
    await lockPortalQuoteAction(tx, quoteId);
    const quote = await getScopedPortalQuoteRecord(scope, quoteId);
    if (!quote) return null;

    let workflowState = await getPortalWorkflowState(quote.id);
    const existingOrder = await getConvertedOrderSummary(scope, quote);
    if (existingOrder) {
      await upsertPortalQuoteWorkflowState(quote.id, {
        status: "customer_approved",
        approvedByCustomerUserId: scope.userId,
        customerNotes: note ?? workflowState?.customerNotes ?? null,
      });
      return getRequiredPortalQuoteActionResult(req, quote.id, "Quote has already been converted to an order.", existingOrder);
    }

    assertPortalQuoteCanApprove(quote, workflowState);

    let createdOrder: QuotePortalOrderSummaryDto | null = null;
    try {
      const order = await storage.convertQuoteToOrder(scope.organizationId, quote.id, scope.userId);
      createdOrder = {
        id: order.id,
        orderNumber: order.orderNumber,
        displayStatus: mapPortalOrderStatus(order),
      };
    } catch (error) {
      const freshQuote = await getScopedPortalQuoteRecord(scope, quoteId);
      const retryOrder = freshQuote ? await getConvertedOrderSummary(scope, freshQuote) : null;
      if (retryOrder) {
        createdOrder = retryOrder;
      } else {
        throw error;
      }
    }

    workflowState = await getPortalWorkflowState(quote.id);
    await db
      .update(quotes)
      .set({ status: "active" })
      .where(and(eq(quotes.id, quote.id), eq(quotes.organizationId, scope.organizationId), eq(quotes.customerId, scope.customerId)));
    await upsertPortalQuoteWorkflowState(quote.id, {
      status: "customer_approved",
      approvedByCustomerUserId: scope.userId,
      customerNotes: note ?? workflowState?.customerNotes ?? null,
    });
    await writePortalQuoteAudit({
      req,
      scope,
      quote,
      actionType: "PORTAL_QUOTE_APPROVE",
      description: createdOrder
        ? `Customer approved quote and converted it to order ${createdOrder.orderNumber}`
        : "Customer approved quote",
      oldValues: { status: quote.status, workflowStatus: workflowState?.status ?? null },
      newValues: { status: "active", workflowStatus: "customer_approved", orderId: createdOrder?.id ?? null },
    });

    return getRequiredPortalQuoteActionResult(req, quote.id, "Quote approved and converted to an order.", createdOrder);
  });
}

export async function declinePortalQuote(req: Request, quoteId: string): Promise<QuotePortalActionResultDto | null> {
  const scope = getPortalScope(req);
  const note = sanitizePortalActionNote((req.body as any)?.note ?? (req.body as any)?.reason);

  return db.transaction(async (tx) => {
    await lockPortalQuoteAction(tx, quoteId);
    const quote = await getScopedPortalQuoteRecord(scope, quoteId);
    if (!quote) return null;
    const workflowState = await getPortalWorkflowState(quote.id);

    if (mapPortalQuoteStatus({ status: quote.status, validUntil: quote.validUntil, convertedToOrderId: quote.convertedToOrderId, workflowStatus: workflowState?.status }) === "Declined") {
      return getRequiredPortalQuoteActionResult(req, quote.id, "This quote has already been declined.");
    }

    assertPortalQuoteCanDeclineOrRevise(quote, workflowState);
    const order = await getConvertedOrderSummary(scope, quote);
    if (order) throw new PortalAccessError(409, "This quote has already been converted to an order.");

    await db
      .update(quotes)
      .set({ status: "canceled" })
      .where(and(eq(quotes.id, quote.id), eq(quotes.organizationId, scope.organizationId), eq(quotes.customerId, scope.customerId)));
    await upsertPortalQuoteWorkflowState(quote.id, {
      status: "rejected",
      rejectedByUserId: scope.userId,
      rejectionReason: note,
    });
    await writePortalQuoteAudit({
      req,
      scope,
      quote,
      actionType: "PORTAL_QUOTE_DECLINE",
      description: note ? "Customer declined quote with a note" : "Customer declined quote",
      oldValues: { status: quote.status, workflowStatus: workflowState?.status ?? null },
      newValues: { status: "canceled", workflowStatus: "rejected" },
    });

    return getRequiredPortalQuoteActionResult(req, quote.id, "Quote declined.");
  });
}

export async function requestPortalQuoteRevision(req: Request, quoteId: string): Promise<QuotePortalActionResultDto | null> {
  const scope = getPortalScope(req);
  const note = sanitizePortalActionNote((req.body as any)?.note ?? (req.body as any)?.customerNotes);

  return db.transaction(async (tx) => {
    await lockPortalQuoteAction(tx, quoteId);
    const quote = await getScopedPortalQuoteRecord(scope, quoteId);
    if (!quote) return null;
    const workflowState = await getPortalWorkflowState(quote.id);

    if (
      mapPortalQuoteStatus({
        status: quote.status,
        validUntil: quote.validUntil,
        convertedToOrderId: quote.convertedToOrderId,
        workflowStatus: workflowState?.status,
      }) === "Revision Requested"
    ) {
      return getRequiredPortalQuoteActionResult(req, quote.id, "Your revision request has already been recorded.");
    }

    assertPortalQuoteCanDeclineOrRevise(quote, workflowState);
    const order = await getConvertedOrderSummary(scope, quote);
    if (order) throw new PortalAccessError(409, "This quote has already been converted to an order.");

    await upsertPortalQuoteWorkflowState(quote.id, {
      status: "customer_revision_requested",
      customerNotes: note,
    });
    await writePortalQuoteAudit({
      req,
      scope,
      quote,
      actionType: "PORTAL_QUOTE_REVISION_REQUEST",
      description: note ? "Customer requested quote revision with a note" : "Customer requested quote revision",
      oldValues: { status: quote.status, workflowStatus: workflowState?.status ?? null },
      newValues: { status: quote.status, workflowStatus: "customer_revision_requested" },
    });

    return getRequiredPortalQuoteActionResult(req, quote.id, "Revision request recorded.");
  });
}

export function toPortalErrorResponse(error: unknown): { statusCode: number; message: string } {
  if (error instanceof PortalAccessError) {
    return { statusCode: error.statusCode, message: error.message };
  }
  return { statusCode: 500, message: "Portal request failed" };
}

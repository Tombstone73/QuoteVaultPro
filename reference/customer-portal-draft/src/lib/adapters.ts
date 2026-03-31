/**
 * Adapter layer — transforms raw API responses into portal-safe DTOs.
 * This is the single firewall between backend shape and UI.
 * All internal fields are stripped here. The UI never touches raw API data.
 */

import type {
  PortalOrderListItem,
  OrderState,
  PortalQuoteListItem,
  QuoteState,
  PortalInvoiceListItem,
  PortalInvoiceDetail,
  InvoiceStatus,
  PortalOrderDetail,
  PortalOrderLineItem,
  PortalOrderFile,
  LineItemWorkflowState,
} from "@/types/portal";

// ─── State Label Maps (from audit section 2.3) ──────────

const ORDER_STATE_LABELS: Record<OrderState, string> = {
  open: "In Progress",
  production_complete: "Ready for Pickup",
  closed: "Completed",
  canceled: "Canceled",
};

const QUOTE_STATE_LABELS: Record<QuoteState, string> = {
  draft: "Draft",
  sent: "Pending Review",
  approved: "Approved",
  expired: "Expired",
  rejected: "Rejected",
};

// ─── Order Adapter ───────────────────────────────────────

/**
 * Picks only confirmed DTO fields from raw API response.
 * Strips: notesInternal, notesProduction, billingStatus, routingTarget,
 *   statusPillValue, workflowStatusId, createdByUserId, assignedTo,
 *   paymentStatus, fulfillmentStatus, status (deprecated),
 *   organizationId, customerId, contactId, and all *Override fields.
 */
export function adaptOrderListItem(raw: Record<string, unknown>): PortalOrderListItem {
  const state = (raw.state as OrderState) ?? "open";

  return {
    id: raw.id as string,
    orderNumber: raw.orderNumber as string,
    poNumber: (raw.poNumber as string | null) ?? null,
    state,
    stateLabel: ORDER_STATE_LABELS[state] ?? state,
    priority: (raw.priority as PortalOrderListItem["priority"]) ?? "normal",
    dueDate: (raw.dueDate as string | null) ?? null,
    promisedDate: (raw.promisedDate as string | null) ?? null,
    subtotal: (raw.subtotal as number) ?? 0,
    tax: (raw.tax as number) ?? 0,
    total: (raw.total as number) ?? 0,
    shippingMethod: (raw.shippingMethod as PortalOrderListItem["shippingMethod"]) ?? "pickup",
    trackingNumber: (raw.trackingNumber as string | null) ?? null,
    shippedAt: (raw.shippedAt as string | null) ?? null,
    createdAt: raw.createdAt as string,
  };
}

export function adaptOrderList(rawList: Record<string, unknown>[]): PortalOrderListItem[] {
  return rawList.map(adaptOrderListItem);
}

// ─── Order Detail Adapters ──────────────────────────────

const WORKFLOW_STATE_LABELS: Record<LineItemWorkflowState, string> = {
  processing: "Processing",
  in_production: "In Production",
  ready: "Ready",
  on_hold: "On Hold",
  canceled: "Canceled",
};

const FILE_ROLE_LABELS: Record<string, string> = {
  artwork: "Artwork",
  customer_po: "Customer PO",
};

const PORTAL_VISIBLE_FILE_ROLES = new Set(["artwork", "customer_po"]);

export function adaptOrderLineItem(raw: Record<string, unknown>): PortalOrderLineItem {
  const ws = (raw.workflowState as LineItemWorkflowState) ?? "processing";
  return {
    id: raw.id as string,
    description: (raw.description as string) ?? (raw.name as string) ?? "",
    quantity: (raw.quantity as number) ?? 1,
    unitPrice: (raw.unitPrice as number) ?? 0,
    total: (raw.total as number) ?? 0,
    workflowState: ws,
    workflowStateLabel: WORKFLOW_STATE_LABELS[ws] ?? ws,
  };
}

export function adaptOrderFile(
  raw: Record<string, unknown>,
  orderId: string,
  lineItemId: string,
): PortalOrderFile | null {
  const role = (raw.fileRole as string) ?? (raw.role as string) ?? "";
  if (!PORTAL_VISIBLE_FILE_ROLES.has(role)) return null;

  return {
    id: raw.id as string,
    fileName: (raw.fileName as string) ?? (raw.originalName as string) ?? "file",
    fileRole: role as PortalOrderFile["fileRole"],
    fileRoleLabel: FILE_ROLE_LABELS[role] ?? role,
    lineItemId,
    downloadUrl: `/orders/${orderId}/line-items/${lineItemId}/files/${raw.id}/download`,
  };
}

export function adaptOrderDetail(
  raw: Record<string, unknown>,
  lineItemsRaw: Record<string, unknown>[],
  filesMap: Map<string, Record<string, unknown>[]>,
): PortalOrderDetail {
  const base = adaptOrderListItem(raw);
  const lineItems = lineItemsRaw.map(adaptOrderLineItem);

  const files: PortalOrderFile[] = [];
  for (const [lineItemId, rawFiles] of filesMap) {
    for (const rf of rawFiles) {
      const f = adaptOrderFile(rf, base.id, lineItemId);
      if (f) files.push(f);
    }
  }

  return { ...base, lineItems, files };
}

// ─── Quote Adapter ───────────────────────────────────────

/**
 * Picks only confirmed quote DTO fields. Strips internal fields same as orders.
 */
export function adaptQuoteListItem(raw: Record<string, unknown>): PortalQuoteListItem {
  const state = (raw.state as QuoteState) ?? "draft";

  return {
    id: raw.id as string,
    quoteNumber: raw.quoteNumber as string,
    state,
    stateLabel: QUOTE_STATE_LABELS[state] ?? state,
    subtotal: (raw.subtotal as number) ?? 0,
    tax: (raw.tax as number) ?? 0,
    total: (raw.total as number) ?? 0,
    expiresAt: (raw.expiresAt as string | null) ?? null,
    createdAt: raw.createdAt as string,
  };
}

export function adaptQuoteList(rawList: Record<string, unknown>[]): PortalQuoteListItem[] {
  return rawList.map(adaptQuoteListItem);
}

// ─── Invoice Adapter ────────────────────────────────────

const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  billed: "Unpaid",
  paid: "Paid",
  void: "Void",
};

export function adaptInvoiceListItem(raw: Record<string, unknown>): PortalInvoiceListItem {
  const status = (raw.status as InvoiceStatus) ?? "draft";
  return {
    id: raw.id as string,
    invoiceNumber: raw.invoiceNumber as string,
    status,
    statusLabel: INVOICE_STATUS_LABELS[status] ?? status,
    subtotal: (raw.subtotal as number) ?? 0,
    tax: (raw.tax as number) ?? 0,
    total: (raw.total as number) ?? 0,
    amountDue: (raw.amountDue as number) ?? 0,
    dueDate: (raw.dueDate as string | null) ?? null,
    createdAt: raw.createdAt as string,
  };
}

export function adaptInvoiceList(rawList: Record<string, unknown>[]): PortalInvoiceListItem[] {
  return rawList.map(adaptInvoiceListItem);
}

export function adaptInvoiceDetail(raw: Record<string, unknown>): PortalInvoiceDetail {
  const status = (raw.status as InvoiceStatus) ?? "draft";
  const rawLines = (raw.lineItems as Record<string, unknown>[]) ?? [];
  const rawPayments = (raw.payments as Record<string, unknown>[]) ?? [];

  return {
    id: raw.id as string,
    invoiceNumber: raw.invoiceNumber as string,
    status,
    statusLabel: INVOICE_STATUS_LABELS[status] ?? status,
    subtotal: (raw.subtotal as number) ?? 0,
    tax: (raw.tax as number) ?? 0,
    total: (raw.total as number) ?? 0,
    amountDue: (raw.amountDue as number) ?? 0,
    dueDate: (raw.dueDate as string | null) ?? null,
    createdAt: raw.createdAt as string,
    lineItems: rawLines.map((li) => ({
      id: li.id as string,
      description: li.description as string,
      quantity: (li.quantity as number) ?? 1,
      unitPrice: (li.unitPrice as number) ?? 0,
      total: (li.total as number) ?? 0,
    })),
    payments: rawPayments.map((p) => ({
      id: p.id as string,
      amount: (p.amount as number) ?? 0,
      method: (p.method as string) ?? "unknown",
      paidAt: p.paidAt as string,
    })),
  };
}

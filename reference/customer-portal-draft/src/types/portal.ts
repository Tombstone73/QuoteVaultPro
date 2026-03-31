/**
 * Portal DTOs — verbatim from the customer-portal-api-contract-audit.
 * Only types confirmed by the audit are defined here.
 */

// ─── Enums ───────────────────────────────────────────────

export type OrderState = "open" | "production_complete" | "closed" | "canceled";

export type QuoteState = "draft" | "sent" | "approved" | "expired" | "rejected";

export type Priority = "rush" | "normal" | "low";

export type ShippingMethod = "pickup" | "ship" | "deliver";

// ─── Session ─────────────────────────────────────────────

export interface PortalSession {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  customerId: string;
  customerName: string;
}

// ─── Orders ──────────────────────────────────────────────

export interface PortalOrderListItem {
  id: string;
  orderNumber: string;
  poNumber: string | null;
  state: OrderState;
  stateLabel: string;
  priority: Priority;
  dueDate: string | null;
  promisedDate: string | null;
  subtotal: number;
  tax: number;
  total: number;
  shippingMethod: ShippingMethod;
  trackingNumber: string | null;
  shippedAt: string | null;
  createdAt: string;
}

// ─── Quotes ──────────────────────────────────────────────

export interface PortalQuoteLineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface PortalQuoteListItem {
  id: string;
  quoteNumber: string;
  state: QuoteState;
  stateLabel: string;
  subtotal: number;
  tax: number;
  total: number;
  expiresAt: string | null;
  createdAt: string;
}

export interface PortalQuoteDetail extends PortalQuoteListItem {
  lineItems: PortalQuoteLineItem[];
}

// ─── Invoices ────────────────────────────────────────────

export type InvoiceStatus = "draft" | "billed" | "paid" | "void";

export interface PortalInvoiceListItem {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  statusLabel: string;
  subtotal: number;
  tax: number;
  total: number;
  amountDue: number;
  dueDate: string | null;
  createdAt: string;
}

export interface PortalInvoiceLineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface PortalInvoicePayment {
  id: string;
  amount: number;
  method: string;
  paidAt: string;
}

export interface PortalInvoiceDetail {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  statusLabel: string;
  subtotal: number;
  tax: number;
  total: number;
  amountDue: number;
  dueDate: string | null;
  createdAt: string;
  lineItems: PortalInvoiceLineItem[];
  payments: PortalInvoicePayment[];
}

// ─── Order Detail ────────────────────────────────────────

export type LineItemWorkflowState =
  | "processing"
  | "in_production"
  | "ready"
  | "on_hold"
  | "canceled";

export interface PortalOrderLineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  workflowState: LineItemWorkflowState;
  workflowStateLabel: string;
}

export interface PortalOrderFile {
  id: string;
  fileName: string;
  fileRole: "artwork" | "customer_po";
  fileRoleLabel: string;
  lineItemId: string;
  downloadUrl: string;
}

export interface PortalOrderDetail extends PortalOrderListItem {
  lineItems: PortalOrderLineItem[];
  files: PortalOrderFile[];
}

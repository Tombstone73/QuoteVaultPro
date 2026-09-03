import type { InvoiceId, OrderId, OrganizationId, QuoteId } from "../shared/commercialValues.js";

/**
 * Compact, non-authoritative projections for the operator Sales workspace.
 * They intentionally do not carry line graphs or mutable Billing/Routing state.
 */
export type SalesWorkspacePageRequest = Readonly<{
  limit?: number;
  cursor?: string;
  search?: string;
  lifecycle?: string;
  /** Inclusive ISO date bounds for the Sales-owned requested due date. */
  dueFrom?: string;
  dueTo?: string;
  /** This is applied by the tenant-scoped read projection before paging. */
  sort?: "updated_desc" | "updated_asc";
}>;

export type SalesWorkspacePage<T> = Readonly<{
  items: readonly T[];
  totalMatching: number;
  nextCursor?: string;
  summary?: Readonly<{
    itemCount: number;
    sellingTotalCents?: number;
    currencies: readonly string[];
  }>;
}>;

export type QuoteListItem = Readonly<{
  source: "v2" | "legacy";
  /** Opaque within the explicitly tagged source; callers must never infer source from it. */
  recordId: string;
  quoteId: QuoteId;
  number: string;
  customerDisplayName: string;
  purchaseOrderNumber?: string;
  lineCount?: number;
  lifecycle: string;
  sellingTotalCents: number;
  currency: string;
  requestedDueDate?: string;
  updatedAt: string;
  convertedOrderId?: OrderId;
  convertedOrderNumber?: string;
}>;

export type OrderListItem = Readonly<{
  source: "v2" | "legacy";
  /** Opaque within the explicitly tagged source; callers must never infer source from it. */
  recordId: string;
  orderId: OrderId;
  number: string;
  customerDisplayName: string;
  purchaseOrderNumber?: string;
  lineCount?: number;
  lifecycle: string;
  sellingTotalCents: number;
  currency: string;
  requestedDueDate?: string;
  updatedAt: string;
  draftInvoice?: Readonly<{ invoiceId: InvoiceId; lifecycle: "draft"; totalCents: number }>;
  routing: "routed" | "no_route";
  activeRecordClassification?: "CLOSED_HISTORY" | "ACTIVE_BUT_CAN_REMAIN_LEGACY" | "ACTIVE_REQUIRES_CUTOVER_STRATEGY" | "AMBIGUOUS";
}>;

export type LegacyCommercialDetail = Readonly<{
  source: "legacy";
  recordId: string;
  number: string;
  customerDisplayName: string;
  lifecycle: string;
  sellingTotalCents: number;
  currency: string;
  requestedDueDate?: string;
  updatedAt: string;
  readOnly: true;
  activeRecordClassification?: "CLOSED_HISTORY" | "ACTIVE_BUT_CAN_REMAIN_LEGACY" | "ACTIVE_REQUIRES_CUTOVER_STRATEGY" | "AMBIGUOUS";
}>;
/** Canonical Sales/audit evidence only; this is not a fabricated cross-domain timeline. */
export type SalesOrderHistoryEvent = Readonly<{ eventType: string; occurredAt: string; summary: string }>;

/** Sales consumes these bounded read models; it never reads Billing or Routing tables directly. */
export interface SalesWorkspaceReadPort {
  listQuotes(
    organizationId: OrganizationId,
    request: SalesWorkspacePageRequest,
  ): Promise<SalesWorkspacePage<QuoteListItem>>;
  listOrders(
    organizationId: OrganizationId,
    request: SalesWorkspacePageRequest,
  ): Promise<SalesWorkspacePage<OrderListItem>>;
  /** A bounded Orders-list projection with the server-calculated mixed-source summary. */
  listOrdersForWorkspace(
    organizationId: OrganizationId,
    request: SalesWorkspacePageRequest,
  ): Promise<SalesWorkspacePage<OrderListItem>>;
  readLegacyQuote(organizationId: OrganizationId, recordId: string): Promise<LegacyCommercialDetail | null>;
  readLegacyOrder(organizationId: OrganizationId, recordId: string): Promise<LegacyCommercialDetail | null>;
  listOrderHistory(organizationId: OrganizationId, orderId: OrderId): Promise<readonly SalesOrderHistoryEvent[]>;
}

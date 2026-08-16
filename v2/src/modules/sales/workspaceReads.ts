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
}>;

export type SalesWorkspacePage<T> = Readonly<{
  items: readonly T[];
  nextCursor?: string;
}>;

export type QuoteListItem = Readonly<{
  quoteId: QuoteId;
  number: string;
  customerDisplayName: string;
  lifecycle: "draft" | "sent" | "accepted" | "converted";
  sellingTotalCents: number;
  currency: string;
  requestedDueDate?: string;
  updatedAt: string;
  convertedOrderId?: OrderId;
  convertedOrderNumber?: string;
}>;

export type OrderListItem = Readonly<{
  orderId: OrderId;
  number: string;
  customerDisplayName: string;
  lifecycle: "open" | "cancelled";
  sellingTotalCents: number;
  currency: string;
  requestedDueDate?: string;
  updatedAt: string;
  draftInvoice?: Readonly<{ invoiceId: InvoiceId; lifecycle: "draft"; totalCents: number }>;
  routing: "routed" | "no_route";
}>;

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
}

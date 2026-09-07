import type { PortalPrincipal } from "../../authorization/principals.js";

/** Explicit customer-safe projections. Staff Sales read models never cross the portal boundary. */
export type PortalMoney = Readonly<{ cents: number; currency: string }>;
export type PortalOrderSummary = Readonly<{ orderId: string; number: string; purchaseOrderNumber?: string; createdAt: string; requestedDueDate?: string; status: "open" | "completed" | "cancelled"; total: PortalMoney; payment: "unbilled" | "open_balance" | "settled"; fulfillment: "not_required" | "required" | "partial" | "fulfilled" }>;
/**
 * Customer-safe operational fulfillment facts.  These are intentionally
 * per-order only: a combined shipment never reveals another customer's work.
 */
export type PortalOrderLine = Readonly<{ lineId: string; description: string; quantity: number; fulfilledQuantity: number; remainingFulfillmentQuantity: number; unitPrice: PortalMoney; lineTotal: PortalMoney }>;
export type PortalShipment = Readonly<{ shipmentId: string; status: "prepared" | "shipped"; createdAt: string; carrier?: string; service?: string; trackingNumber?: string; shippedAt?: string; quantity: number }>;
export type PortalOrderDetail = PortalOrderSummary & Readonly<{ lines: readonly PortalOrderLine[]; shipments: readonly PortalShipment[] }>;
export type PortalQuoteSummary = Readonly<{ quoteId: string; number: string; createdAt: string; requestedDueDate?: string; status: string; total: PortalMoney; convertedOrderId?: string }>;
export type PortalQuoteDetail = PortalQuoteSummary & Readonly<{ lines: readonly Readonly<{ lineId: string; description: string; quantity: number; unitPrice: PortalMoney; lineTotal: PortalMoney }>[] }>;
export type PortalPage<T> = Readonly<{ items: readonly T[]; nextCursor?: string }>;
/** A small server-derived aggregate for the Portal home surface. */
export type PortalOrdersDashboard = Readonly<{ recentOrders: readonly PortalOrderSummary[]; currentOrderCount: number; historicalOrderCount: number; openBalanceOrderCount: number }>;
export type PortalCommercialRead = Readonly<{ listOrders(principal: PortalPrincipal, cursor?: string): Promise<PortalPage<PortalOrderSummary>>; ordersDashboard(principal: PortalPrincipal): Promise<PortalOrdersDashboard>; getOrder(principal: PortalPrincipal, orderId: string): Promise<PortalOrderDetail | null>; listQuotes(principal: PortalPrincipal, cursor?: string): Promise<PortalPage<PortalQuoteSummary>>; getQuote(principal: PortalPrincipal, quoteId: string): Promise<PortalQuoteDetail | null> }>;

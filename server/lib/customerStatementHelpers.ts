import { documentNumberMatchesSearch } from "@shared/documentNumbering";

/**
 * customerStatementHelpers.ts
 *
 * Pure helper functions for the customer statement endpoint.
 * Extracted for testability — no DB or Express dependencies.
 *
 * These are used by:
 *   GET /api/customers/:id/statement  (customerRelations.routes.ts)
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export interface StatementOrderInput {
  state: string;
  closedAt: string | null;
  createdAt: string;
  orderNumber: string;
  poNumber: string | null;
  label: string | null;
  status: string;
}

export interface StatementInvoiceInput {
  status: string;
  total: string;
  amountPaid: string;
  balanceDue: string;
  transactionType?: string; // for credit tx rows
  amount?: string;          // for credit tx rows
}

export interface StatementCreditTxInput {
  transactionType: string;
  amount: string;
}

export interface StatementSummary {
  openOrderCount: number;
  completedOrderCount: number;
  openOrderTotal: string;
  completedOrderTotal: string;
  invoicedTotal: string;
  paidTotal: string;
  outstandingBalance: string;
  creditTotal: string;
  refundTotal: string;
}

// ── Date helpers ───────────────────────────────────────────────────────────────

/**
 * Convert any Date | string | null/undefined to a safe ISO string.
 * Returns epoch string for invalid/missing values instead of throwing.
 */
export function safeIso(val: Date | string | null | undefined): string | null {
  if (val == null) return null;
  const d = new Date(val as unknown as string);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Normalise a dateTo query param: if it's a 10-char date-only string (YYYY-MM-DD),
 * append T23:59:59.999Z so comparisons include the full selected calendar day.
 */
export function normaliseDateTo(dateTo: string | null): string | null {
  if (!dateTo) return null;
  return dateTo.length === 10 ? `${dateTo}T23:59:59.999Z` : dateTo;
}

/**
 * Choose the canonical date for this order row, used for date-range filtering:
 * - closed orders → closedAt (when it became closed) ?? createdAt
 * - all others    → createdAt
 */
export function orderEffectiveDate(order: {
  state: string;
  closedAt: string | null | undefined;
  createdAt: string;
}): string {
  if (order.state === "closed" && order.closedAt) {
    return safeIso(order.closedAt) ?? order.closedAt;
  }
  return safeIso(order.createdAt) ?? order.createdAt;
}

// ── Order classification ───────────────────────────────────────────────────────

/** Open orders: state is 'open' or 'production_complete'. */
export function isOpenOrder(state: string): boolean {
  return state === "open" || state === "production_complete";
}

/** Completed orders: state is 'closed'. */
export function isCompletedOrder(state: string): boolean {
  return state === "closed";
}

// ── Filter predicates ──────────────────────────────────────────────────────────

/**
 * Returns true if the order satisfies the status section filter.
 *   'open'      → must be an open order
 *   'completed' → must be a completed order
 *   'all'       → any non-canceled order
 */
export function filterOrderByStatus(
  order: { state: string },
  statusFilter: "open" | "completed" | "all",
): boolean {
  if (statusFilter === "open") return isOpenOrder(order.state);
  if (statusFilter === "completed") return isCompletedOrder(order.state);
  // 'all': include open + completed (exclude canceled)
  return order.state !== "canceled";
}

/**
 * Returns true if the order's effective date falls within [dateFrom, dateTo].
 * Null bounds are treated as unbounded.
 */
export function filterOrderByDate(
  order: { state: string; closedAt: string | null | undefined; createdAt: string },
  dateFrom: string | null,
  dateTo: string | null,
): boolean {
  const effectiveMs = new Date(orderEffectiveDate(order)).getTime();
  if (dateFrom && effectiveMs < new Date(dateFrom).getTime()) return false;
  if (dateTo   && effectiveMs > new Date(dateTo).getTime())   return false;
  return true;
}

/**
 * Returns true if the order matches the search string.
 * Searches: orderNumber, poNumber, label, status (case-insensitive).
 */
export function filterOrderBySearch(
  order: { orderNumber: string; displayNumber?: string | null; numberCore?: number | null; poNumber: string | null; label: string | null; status: string },
  search: string,
): boolean {
  if (!search) return true;
  const s = search.toLowerCase();
  return (
    documentNumberMatchesSearch({
      query: search,
      displayNumber: order.displayNumber,
      numberCore: order.numberCore,
      legacyNumber: order.orderNumber,
    }) ||
    order.orderNumber.toLowerCase().includes(s) ||
    (order.poNumber || "").toLowerCase().includes(s) ||
    (order.label || "").toLowerCase().includes(s) ||
    order.status.toLowerCase().includes(s)
  );
}

/**
 * Returns true if the invoice matches the search string.
 * Searches: invoiceNumber, customerPoNumber, notesPublic, sourceOrderNumber.
 */
export function filterInvoiceBySearch(
  invoice: {
    invoiceNumber: number | string;
    displayNumber?: string | null;
    numberCore?: number | null;
    customerPoNumber: string | null | undefined;
    notesPublic: string | null | undefined;
    sourceOrderNumber: number | null | undefined;
  },
  search: string,
): boolean {
  if (!search) return true;
  const s = search.toLowerCase();
  return (
    documentNumberMatchesSearch({
      query: search,
      displayNumber: invoice.displayNumber,
      numberCore: invoice.numberCore,
      legacyNumber: invoice.invoiceNumber,
    }) ||
    String(invoice.invoiceNumber).toLowerCase().includes(s) ||
    (invoice.customerPoNumber || "").toLowerCase().includes(s) ||
    (invoice.notesPublic || "").toLowerCase().includes(s) ||
    (invoice.sourceOrderNumber != null && String(invoice.sourceOrderNumber).includes(s))
  );
}

/**
 * Returns true if the quote matches the search string.
 * Searches: quoteNumber, label, status.
 */
export function filterQuoteBySearch(
  quote: {
    quoteNumber: number | null | undefined;
    displayNumber?: string | null;
    numberCore?: number | null;
    label: string | null | undefined;
    status: string | null | undefined;
  },
  search: string,
): boolean {
  if (!search) return true;
  const s = search.toLowerCase();
  return (
    documentNumberMatchesSearch({
      query: search,
      displayNumber: quote.displayNumber,
      numberCore: quote.numberCore,
      legacyNumber: quote.quoteNumber,
    }) ||
    (quote.quoteNumber != null && String(quote.quoteNumber).includes(s)) ||
    (quote.label || "").toLowerCase().includes(s) ||
    (quote.status || "").toLowerCase().includes(s)
  );
}

// ── Summary calculation ────────────────────────────────────────────────────────

/**
 * Compute the statement summary from full (unfiltered) domain arrays.
 * Summary is always over ALL data for this customer — filters do not reduce totals.
 *
 * @param allOrders  All non-canceled orders for the customer
 * @param allInvoices All invoices for the customer
 * @param allCreditTx All customerCreditTransactions for the customer
 * @param refundTotal Pre-computed refund total (from payments table)
 */
export function buildStatementSummary(
  allOrders: Array<{ state: string; total: string }>,
  allInvoices: Array<{ status: string; total: string; amountPaid: string; balanceDue: string }>,
  allCreditTx: Array<{ transactionType: string; amount: string }>,
  refundTotal: number,
): StatementSummary {
  const openOrders = allOrders.filter((o) => isOpenOrder(o.state));
  const completedOrders = allOrders.filter((o) => isCompletedOrder(o.state));

  const openOrderTotal = openOrders.reduce((s, o) => s + parseFloat(o.total || "0"), 0);
  const completedOrderTotal = completedOrders.reduce((s, o) => s + parseFloat(o.total || "0"), 0);

  // Invoices: exclude void
  const nonVoidInvoices = allInvoices.filter((inv) => inv.status !== "void");
  const invoicedTotal = nonVoidInvoices.reduce((s, inv) => s + parseFloat(inv.total || "0"), 0);
  const paidTotal = nonVoidInvoices.reduce((s, inv) => s + parseFloat(inv.amountPaid || "0"), 0);
  // outstandingBalance: sum of balanceDue on non-void, non-paid invoices
  const outstandingBalance = nonVoidInvoices
    .filter((inv) => inv.status !== "paid")
    .reduce((s, inv) => s + parseFloat(inv.balanceDue || "0"), 0);

  // Credits: transactionType = "payment" (manual credit) or "credit"
  const creditTotal = allCreditTx
    .filter((ct) => ct.transactionType === "payment" || ct.transactionType === "credit")
    .reduce((s, ct) => s + parseFloat(ct.amount || "0"), 0);

  return {
    openOrderCount:        openOrders.length,
    completedOrderCount:   completedOrders.length,
    openOrderTotal:        openOrderTotal.toFixed(2),
    completedOrderTotal:   completedOrderTotal.toFixed(2),
    invoicedTotal:         invoicedTotal.toFixed(2),
    paidTotal:             paidTotal.toFixed(2),
    outstandingBalance:    outstandingBalance.toFixed(2),
    creditTotal:           creditTotal.toFixed(2),
    refundTotal:           refundTotal.toFixed(2),
  };
}

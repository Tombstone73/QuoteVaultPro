import type { InvoiceListColumnFilterQuery } from "@/hooks/useInvoices";
import type { InvoiceSortDir, InvoiceSortKey } from "@/lib/invoiceListSort";

export const INVOICE_LIST_COLUMN_FILTER_PARAM_KEYS: Array<keyof InvoiceListColumnFilterQuery> = [
  "customer", "contact", "jobName", "purchaseOrderNumber", "columnOrderNumber", "invoiceNumber",
  "accountingApproval", "issueDateFrom", "issueDateTo", "dueDateFrom", "dueDateTo", "sendStatus",
  "lastSent", "totalMin", "totalMax", "paidMin", "paidMax", "balanceMin", "balanceMax",
];

const SORT_KEYS: InvoiceSortKey[] = [
  "invoiceNumber", "customer", "contact", "orderNumber", "purchaseOrderNumber", "issueDate", "dueDate",
  "lastSentAt", "status", "total", "balance",
];

export type InvoiceListUrlState = {
  search: string;
  status: string;
  customerId: string | undefined;
  customerName: string | undefined;
  issueDatePreset: "custom" | undefined;
  sortKey: InvoiceSortKey;
  sortDir: InvoiceSortDir;
  page: number;
  pageSize: number;
  columnFilters: InvoiceListColumnFilterQuery;
};

const read = (params: URLSearchParams, key: string) => params.get(key)?.trim() || undefined;

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * The URL is the single persisted source of truth for the global Invoice
 * workspace. Keeping this parsing pure makes a refresh or browser Back
 * reconstruct the exact server query and React Query cache key.
 */
export function parseInvoiceListUrlState(params: URLSearchParams): InvoiceListUrlState {
  const columnFilters = INVOICE_LIST_COLUMN_FILTER_PARAM_KEYS.reduce<InvoiceListColumnFilterQuery>((result, key) => {
    const value = read(params, key);
    if (value) result[key] = value as never;
    return result;
  }, {});
  const requestedSort = read(params, "sortBy");
  const requestedPageSize = positiveInteger(read(params, "pageSize"), 50);

  return {
    search: read(params, "search") || "",
    status: read(params, "status") || "all",
    customerId: read(params, "customerId"),
    customerName: read(params, "customerName"),
    issueDatePreset: read(params, "issueDatePreset") === "custom" ? "custom" : undefined,
    sortKey: SORT_KEYS.includes(requestedSort as InvoiceSortKey) ? requestedSort as InvoiceSortKey : "issueDate",
    sortDir: read(params, "sortDir") === "asc" ? "asc" : "desc",
    page: positiveInteger(read(params, "page"), 1),
    pageSize: [25, 50, 100].includes(requestedPageSize) ? requestedPageSize : 50,
    columnFilters,
  };
}

/** Return a normalized copy without blank/default values or stale page state. */
export function updateInvoiceListUrlState(
  current: URLSearchParams,
  changes: Record<string, string | undefined>,
  resetPage = false,
) {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(changes)) {
    if (value?.trim()) next.set(key, value);
    else next.delete(key);
  }
  if (resetPage) next.delete("page");
  return next;
}

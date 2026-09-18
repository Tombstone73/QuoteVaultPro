import type { InvoiceListColumnFilterQuery } from "@/hooks/useInvoices";
import { getDefaultInvoiceSortDir, type InvoiceSortDir, type InvoiceSortKey } from "@/lib/invoiceListSort";

export const INVOICE_LIST_COLUMN_FILTER_PARAM_KEYS: Array<keyof InvoiceListColumnFilterQuery> = [
  "customer", "contact", "jobName", "purchaseOrderNumber", "columnOrderNumber", "invoiceNumber",
  "accountingApproval", "issueDateFrom", "issueDateTo", "dueDateFrom", "dueDateTo", "sendStatus",
  "lastSent", "totalMin", "totalMax", "paidMin", "paidMax", "balanceMin", "balanceMax",
  "jobStatus", "excludeCustomerId",
];

const INVOICE_LIST_EXPLICIT_FILTER_PARAM_KEYS = [
  "status", "includePaidHistorical", "includeCanceled", "customerId", "customerName", "excludeCustomerName", "issueDatePreset",
  ...INVOICE_LIST_COLUMN_FILTER_PARAM_KEYS,
];

const SORT_KEYS: InvoiceSortKey[] = [
  "invoiceNumber", "customer", "contact", "orderNumber", "purchaseOrderNumber", "issueDate", "dueDate",
  "lastSentAt", "status", "approval", "jobStatus", "total", "paid", "balance", "jobName",
];

const DISCRETE_MULTI_VALUE_PARAM_KEYS = new Set<string>([
  "status", "accountingApproval", "sendStatus", "jobStatus",
]);

export type InvoiceListUrlState = {
  search: string;
  status: string;
  includePaidHistorical: boolean;
  includeCanceled: boolean;
  customerId: string | undefined;
  customerName: string | undefined;
  excludeCustomerName: string | undefined;
  issueDatePreset: "custom" | undefined;
  hasExplicitSort: boolean;
  sortKey: InvoiceSortKey;
  sortDir: InvoiceSortDir;
  page: number;
  pageSize: number;
  columnFilters: InvoiceListColumnFilterQuery;
};

const read = (params: URLSearchParams, key: string) => params.get(key)?.trim() || undefined;

/** Canonical, shareable CSV form for discrete filters. Existing single values
 * remain unchanged; blank segments and duplicate selections are removed. */
export function normalizeInvoiceListDiscreteFilter(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const values = [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
  return values.length ? values.join(",") : undefined;
}

/** Keep the controlled input's in-progress whitespace; normalize only for API reads. */
export const normalizeInvoiceListSearchQuery = (search: string): string | undefined => search.trim() || undefined;

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Explicit URL state is the source of truth for a shared/global Invoice
 * workspace. Keeping this parsing pure makes a refresh or browser Back
 * reconstruct the exact server query and React Query cache key; optional
 * user-scoped sticky preferences are applied by the page only when the URL
 * does not explicitly provide that state.
 */
export function parseInvoiceListUrlState(params: URLSearchParams): InvoiceListUrlState {
  const columnFilters = INVOICE_LIST_COLUMN_FILTER_PARAM_KEYS.reduce<InvoiceListColumnFilterQuery>((result, key) => {
    const value = DISCRETE_MULTI_VALUE_PARAM_KEYS.has(key)
      ? normalizeInvoiceListDiscreteFilter(read(params, key))
      : read(params, key);
    if (value) result[key] = value as never;
    return result;
  }, {});
  const requestedSort = read(params, "sortBy");
  const hasExplicitSort = SORT_KEYS.includes(requestedSort as InvoiceSortKey);
  const sortKey = hasExplicitSort ? requestedSort as InvoiceSortKey : "issueDate";
  const requestedPageSize = positiveInteger(read(params, "pageSize"), 50);

  return {
    search: params.get("search") ?? "",
    status: normalizeInvoiceListDiscreteFilter(read(params, "status")) || "all",
    includePaidHistorical: read(params, "includePaidHistorical") === "1",
    includeCanceled: read(params, "includeCanceled") === "1",
    customerId: read(params, "customerId"),
    customerName: read(params, "customerName"),
    excludeCustomerName: read(params, "excludeCustomerName"),
    issueDatePreset: read(params, "issueDatePreset") === "custom" ? "custom" : undefined,
    hasExplicitSort,
    sortKey,
    sortDir: hasExplicitSort && (read(params, "sortDir") === "asc" || read(params, "sortDir") === "desc")
      ? read(params, "sortDir") as InvoiceSortDir
      : getDefaultInvoiceSortDir(sortKey),
    page: positiveInteger(read(params, "page"), 1),
    pageSize: [25, 50, 100].includes(requestedPageSize) ? requestedPageSize : 50,
    columnFilters,
  };
}

/** Explicit drilldown filters must always win over saved list preferences. */
export function hasExplicitInvoiceListFilters(params: URLSearchParams): boolean {
  return INVOICE_LIST_EXPLICIT_FILTER_PARAM_KEYS.some((key) => params.has(key));
}

/** Return a normalized copy without blank/default values or stale page state. */
export function updateInvoiceListUrlState(
  current: URLSearchParams,
  changes: Record<string, string | undefined>,
  resetPage = false,
) {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(changes)) {
    const normalized = DISCRETE_MULTI_VALUE_PARAM_KEYS.has(key)
      ? normalizeInvoiceListDiscreteFilter(value)
      : value?.trim() ? value : undefined;
    if (normalized) next.set(key, normalized);
    else next.delete(key);
  }
  if (resetPage) next.delete("page");
  return next;
}

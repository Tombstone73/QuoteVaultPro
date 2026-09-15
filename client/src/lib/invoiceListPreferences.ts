import type { InvoiceListColumnFilterQuery } from "@/hooks/useInvoices";
import { getDefaultInvoiceSortDir, type InvoiceSortDir, type InvoiceSortKey } from "@/lib/invoiceListSort";

export type InvoiceListPageSize = 25 | 50 | 100;

export type InvoiceListStickyFilters = {
  status?: string;
  includePaidHistorical?: boolean;
  customerId?: string;
  customerName?: string;
  excludeCustomerName?: string;
  issueDatePreset?: "custom";
  columnFilters?: InvoiceListColumnFilterQuery;
};

export type InvoiceListPreferences = {
  version: 1;
  stickySortingAndFilters: boolean;
  sortKey: InvoiceSortKey;
  sortDir: InvoiceSortDir;
  pageSize: InvoiceListPageSize;
  filters: InvoiceListStickyFilters;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export const DEFAULT_INVOICE_LIST_PREFERENCES: InvoiceListPreferences = {
  version: 1,
  stickySortingAndFilters: false,
  sortKey: "issueDate",
  sortDir: "desc",
  pageSize: 50,
  filters: {},
};

export const INVOICE_LIST_PREFERENCES_STORAGE_KEY_PREFIX = "titanos:invoices:list-preferences:v1";

const SORT_KEYS = new Set<InvoiceSortKey>([
  "invoiceNumber", "customer", "contact", "jobName", "orderNumber", "purchaseOrderNumber", "issueDate", "dueDate",
  "lastSentAt", "status", "approval", "jobStatus", "total", "paid", "balance",
]);
const PAGE_SIZES = new Set<InvoiceListPageSize>([25, 50, 100]);
const COLUMN_FILTER_KEYS: Array<keyof InvoiceListColumnFilterQuery> = [
  "accountingApproval", "customer", "contact", "jobName", "purchaseOrderNumber", "columnOrderNumber", "invoiceNumber",
  "issueDateFrom", "issueDateTo", "dueDateFrom", "dueDateTo", "sendStatus", "lastSent", "totalMin", "totalMax",
  "paidMin", "paidMax", "balanceMin", "balanceMax", "jobStatus", "excludeCustomerId",
];

function getStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function nonBlankString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeColumnFilters(value: unknown): InvoiceListColumnFilterQuery | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const filters = COLUMN_FILTER_KEYS.reduce<InvoiceListColumnFilterQuery>((result, key) => {
    const normalized = nonBlankString(raw[key]);
    if (normalized) result[key] = normalized as never;
    return result;
  }, {});
  return Object.keys(filters).length ? filters : undefined;
}

function normalizeFilters(value: unknown): InvoiceListStickyFilters {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const columnFilters = normalizeColumnFilters(raw.columnFilters);
  const filters: InvoiceListStickyFilters = {
    status: nonBlankString(raw.status),
    includePaidHistorical: typeof raw.includePaidHistorical === "boolean" ? raw.includePaidHistorical : undefined,
    customerId: nonBlankString(raw.customerId),
    customerName: nonBlankString(raw.customerName),
    excludeCustomerName: nonBlankString(raw.excludeCustomerName),
    issueDatePreset: raw.issueDatePreset === "custom" ? "custom" : undefined,
    columnFilters,
  };
  return Object.fromEntries(Object.entries(filters).filter(([, item]) => item !== undefined)) as InvoiceListStickyFilters;
}

export function getInvoiceListPreferencesStorageKey(userId: string, organizationId?: string | null): string {
  const userScope = String(userId || "").trim() || "unknown";
  const organizationScope = String(organizationId || "").trim() || "unknown";
  return `${INVOICE_LIST_PREFERENCES_STORAGE_KEY_PREFIX}:org_${organizationScope}:user_${userScope}`;
}

export function normalizeInvoiceListPreferences(value: unknown): InvoiceListPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_INVOICE_LIST_PREFERENCES, filters: {} };
  const raw = value as Partial<Record<keyof InvoiceListPreferences, unknown>>;
  if (raw.version !== 1) return { ...DEFAULT_INVOICE_LIST_PREFERENCES, filters: {} };
  const sortKey = typeof raw.sortKey === "string" && SORT_KEYS.has(raw.sortKey as InvoiceSortKey)
    ? raw.sortKey as InvoiceSortKey
    : DEFAULT_INVOICE_LIST_PREFERENCES.sortKey;
  const sortDir = raw.sortDir === "asc" || raw.sortDir === "desc"
    ? raw.sortDir
    : getDefaultInvoiceSortDir(sortKey);
  const pageSize = typeof raw.pageSize === "number" && PAGE_SIZES.has(raw.pageSize as InvoiceListPageSize)
    ? raw.pageSize as InvoiceListPageSize
    : DEFAULT_INVOICE_LIST_PREFERENCES.pageSize;

  return {
    version: 1,
    stickySortingAndFilters: raw.stickySortingAndFilters === true,
    sortKey,
    sortDir,
    pageSize,
    filters: normalizeFilters(raw.filters),
  };
}

export function resolveInvoiceListViewPreferences(value: unknown): InvoiceListPreferences {
  const preferences = normalizeInvoiceListPreferences(value);
  return {
    ...preferences,
    sortKey: preferences.stickySortingAndFilters ? preferences.sortKey : DEFAULT_INVOICE_LIST_PREFERENCES.sortKey,
    sortDir: preferences.stickySortingAndFilters ? preferences.sortDir : DEFAULT_INVOICE_LIST_PREFERENCES.sortDir,
    filters: preferences.stickySortingAndFilters ? preferences.filters : {},
  };
}

export function readPersistedInvoiceListPreferences(
  userId: string,
  organizationId?: string | null,
  storage?: StorageLike | null,
): InvoiceListPreferences {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return { ...DEFAULT_INVOICE_LIST_PREFERENCES, filters: {} };
  try {
    const raw = resolvedStorage.getItem(getInvoiceListPreferencesStorageKey(userId, organizationId));
    return raw ? normalizeInvoiceListPreferences(JSON.parse(raw)) : { ...DEFAULT_INVOICE_LIST_PREFERENCES, filters: {} };
  } catch {
    return { ...DEFAULT_INVOICE_LIST_PREFERENCES, filters: {} };
  }
}

export function persistInvoiceListPreferences(
  userId: string,
  organizationId: string | null | undefined,
  preferences: InvoiceListPreferences,
  storage?: StorageLike | null,
): void {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return;
  try {
    resolvedStorage.setItem(
      getInvoiceListPreferencesStorageKey(userId, organizationId),
      JSON.stringify(normalizeInvoiceListPreferences(preferences)),
    );
  } catch {
    // Local storage is an optional list UX enhancement.
  }
}

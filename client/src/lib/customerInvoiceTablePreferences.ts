export const CUSTOMER_INVOICE_TABLE_SORT_STORAGE_KEY_PREFIX = "titanos:customers:invoice-table-sort:v1";

export const CUSTOMER_INVOICE_SORT_FIELDS = [
  "invoiceNumber",
  "jobOrder",
  "poNumber",
  "orderNumber",
  "invoiceDate",
  "lastSent",
  "dueDate",
  "approval",
  "jobStatus",
  "total",
  "balance",
  "invoiceStatus",
] as const;

export type CustomerInvoiceSortField = (typeof CUSTOMER_INVOICE_SORT_FIELDS)[number];
export type CustomerInvoiceSortDirection = "asc" | "desc";
export type CustomerInvoiceTableSortPreference = {
  version: 1;
  sortBy: CustomerInvoiceSortField;
  sortDir: CustomerInvoiceSortDirection;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const DEFAULT_CUSTOMER_INVOICE_TABLE_SORT: CustomerInvoiceTableSortPreference = {
  version: 1,
  sortBy: "invoiceDate",
  sortDir: "desc",
};

export function customerInvoiceTableSortStorageKey(userId?: string | null, organizationId?: string | null) {
  return `${CUSTOMER_INVOICE_TABLE_SORT_STORAGE_KEY_PREFIX}:org_${organizationId || "unknown"}:user_${userId || "anonymous"}`;
}

function isSortField(value: unknown): value is CustomerInvoiceSortField {
  return typeof value === "string" && (CUSTOMER_INVOICE_SORT_FIELDS as readonly string[]).includes(value);
}

function getStorage(storage?: StorageLike): StorageLike | undefined {
  if (storage) return storage;
  return typeof window === "undefined" ? undefined : window.localStorage;
}

export function readCustomerInvoiceTableSortPreference(userId?: string | null, organizationId?: string | null, storage?: StorageLike): CustomerInvoiceTableSortPreference {
  const localStorage = getStorage(storage);
  if (!localStorage) return DEFAULT_CUSTOMER_INVOICE_TABLE_SORT;
  try {
    const parsed = JSON.parse(localStorage.getItem(customerInvoiceTableSortStorageKey(userId, organizationId)) || "null") as Partial<CustomerInvoiceTableSortPreference> | null;
    if (parsed?.version === 1 && isSortField(parsed.sortBy) && (parsed.sortDir === "asc" || parsed.sortDir === "desc")) {
      return { version: 1, sortBy: parsed.sortBy, sortDir: parsed.sortDir };
    }
  } catch {}
  return DEFAULT_CUSTOMER_INVOICE_TABLE_SORT;
}

export function persistCustomerInvoiceTableSortPreference(userId: string | null | undefined, organizationId: string | null | undefined, preference: CustomerInvoiceTableSortPreference, storage?: StorageLike) {
  const localStorage = getStorage(storage);
  if (!localStorage) return;
  try {
    localStorage.setItem(customerInvoiceTableSortStorageKey(userId, organizationId), JSON.stringify(preference));
  } catch {}
}

export function clearCustomerInvoiceTableSortPreference(userId?: string | null, organizationId?: string | null, storage?: StorageLike) {
  const localStorage = getStorage(storage);
  if (!localStorage) return;
  try {
    localStorage.removeItem(customerInvoiceTableSortStorageKey(userId, organizationId));
  } catch {}
}

export function customerInvoiceSortApiField(sortBy: CustomerInvoiceSortField) {
  switch (sortBy) {
    case "jobOrder": return "orderNumber";
    case "poNumber": return "purchaseOrderNumber";
    case "invoiceDate": return "issueDate";
    case "lastSent": return "lastSentAt";
    case "invoiceStatus": return "status";
    default: return sortBy;
  }
}

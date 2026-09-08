import { type InvoiceSortDir, type InvoiceSortKey } from "@/lib/invoiceListSort";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type InvoiceListSortPreferences = {
  version: 1;
  sortKey: InvoiceSortKey;
  sortDir: InvoiceSortDir;
};

export const DEFAULT_INVOICE_LIST_SORT_PREFERENCES: InvoiceListSortPreferences = {
  version: 1,
  sortKey: "issueDate",
  sortDir: "desc",
};

export const INVOICE_LIST_SORT_PREFERENCES_STORAGE_KEY_PREFIX = "titanos:invoices:global-sort:v1";

const SORT_KEYS = new Set<InvoiceSortKey>([
  "invoiceNumber", "customer", "contact", "orderNumber", "purchaseOrderNumber", "issueDate", "dueDate",
  "lastSentAt", "status", "total", "balance",
]);

function getStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function getInvoiceListSortPreferencesStorageKey(userId: string, organizationId?: string | null) {
  const userScope = String(userId || "").trim() || "unknown";
  const organizationScope = String(organizationId || "").trim() || "unknown";
  return `${INVOICE_LIST_SORT_PREFERENCES_STORAGE_KEY_PREFIX}:org_${organizationScope}:user_${userScope}`;
}

export function normalizeInvoiceListSortPreferences(value: unknown): InvoiceListSortPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_INVOICE_LIST_SORT_PREFERENCES };
  const raw = value as Partial<Record<keyof InvoiceListSortPreferences, unknown>>;
  if (raw.version !== 1) return { ...DEFAULT_INVOICE_LIST_SORT_PREFERENCES };
  return {
    version: 1,
    sortKey: typeof raw.sortKey === "string" && SORT_KEYS.has(raw.sortKey as InvoiceSortKey)
      ? raw.sortKey as InvoiceSortKey
      : DEFAULT_INVOICE_LIST_SORT_PREFERENCES.sortKey,
    sortDir: raw.sortDir === "asc" || raw.sortDir === "desc"
      ? raw.sortDir
      : DEFAULT_INVOICE_LIST_SORT_PREFERENCES.sortDir,
  };
}

export function readPersistedInvoiceListSortPreferences(
  userId: string,
  organizationId?: string | null,
  storage?: StorageLike | null,
): InvoiceListSortPreferences {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return { ...DEFAULT_INVOICE_LIST_SORT_PREFERENCES };
  try {
    const raw = resolvedStorage.getItem(getInvoiceListSortPreferencesStorageKey(userId, organizationId));
    return raw ? normalizeInvoiceListSortPreferences(JSON.parse(raw)) : { ...DEFAULT_INVOICE_LIST_SORT_PREFERENCES };
  } catch {
    return { ...DEFAULT_INVOICE_LIST_SORT_PREFERENCES };
  }
}

export function persistInvoiceListSortPreferences(
  userId: string,
  organizationId: string | null | undefined,
  preferences: InvoiceListSortPreferences,
  storage?: StorageLike | null,
) {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return;
  try {
    resolvedStorage.setItem(
      getInvoiceListSortPreferencesStorageKey(userId, organizationId),
      JSON.stringify(normalizeInvoiceListSortPreferences(preferences)),
    );
  } catch {
    // This is a local UX preference only. A blocked storage API must not stop invoice work.
  }
}

export function clearPersistedInvoiceListSortPreferences(
  userId: string,
  organizationId?: string | null,
  storage?: StorageLike | null,
) {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return;
  try {
    resolvedStorage.removeItem(getInvoiceListSortPreferencesStorageKey(userId, organizationId));
  } catch {
    // Storage is optional.
  }
}

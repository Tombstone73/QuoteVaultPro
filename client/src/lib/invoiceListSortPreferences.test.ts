import {
  DEFAULT_INVOICE_LIST_SORT_PREFERENCES,
  clearPersistedInvoiceListSortPreferences,
  getInvoiceListSortPreferencesStorageKey,
  persistInvoiceListSortPreferences,
  readPersistedInvoiceListSortPreferences,
} from "@/lib/invoiceListSortPreferences";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
  };
}

describe("Global Invoice sort preferences", () => {
  test("persists a sort independently for the active user and organization", () => {
    const storage = createStorage();
    persistInvoiceListSortPreferences("user-1", "org-1", { version: 1, sortKey: "customer", sortDir: "asc" }, storage);

    expect(readPersistedInvoiceListSortPreferences("user-1", "org-1", storage)).toEqual({ version: 1, sortKey: "customer", sortDir: "asc" });
    expect(readPersistedInvoiceListSortPreferences("user-2", "org-1", storage)).toEqual(DEFAULT_INVOICE_LIST_SORT_PREFERENCES);
    expect(readPersistedInvoiceListSortPreferences("user-1", "org-2", storage)).toEqual(DEFAULT_INVOICE_LIST_SORT_PREFERENCES);
  });

  test("fails closed for invalid preferences and resets the independent preference", () => {
    const storage = createStorage();
    storage.setItem(getInvoiceListSortPreferencesStorageKey("user-1", "org-1"), JSON.stringify({ version: 1, sortKey: "not-real", sortDir: "sideways" }));
    expect(readPersistedInvoiceListSortPreferences("user-1", "org-1", storage)).toEqual(DEFAULT_INVOICE_LIST_SORT_PREFERENCES);

    persistInvoiceListSortPreferences("user-1", "org-1", { version: 1, sortKey: "balance", sortDir: "asc" }, storage);
    clearPersistedInvoiceListSortPreferences("user-1", "org-1", storage);
    expect(readPersistedInvoiceListSortPreferences("user-1", "org-1", storage)).toEqual(DEFAULT_INVOICE_LIST_SORT_PREFERENCES);
  });
});

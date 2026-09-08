import {
  DEFAULT_CUSTOMER_INVOICE_TABLE_SORT,
  clearCustomerInvoiceTableSortPreference,
  customerInvoiceSortApiField,
  customerInvoiceTableSortStorageKey,
  persistCustomerInvoiceTableSortPreference,
  readCustomerInvoiceTableSortPreference,
} from "@/lib/customerInvoiceTablePreferences";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
  };
}

describe("Customer Detail invoice table sort preferences", () => {
  test("persists one customer-invoice sort for the active operator, regardless of customer", () => {
    const storage = createStorage();
    persistCustomerInvoiceTableSortPreference("user-a", "org-a", { version: 1, sortBy: "dueDate", sortDir: "asc" }, storage);

    expect(readCustomerInvoiceTableSortPreference("user-a", "org-a", storage)).toEqual({ version: 1, sortBy: "dueDate", sortDir: "asc" });
    expect(readCustomerInvoiceTableSortPreference("user-a", "org-b", storage)).toEqual(DEFAULT_CUSTOMER_INVOICE_TABLE_SORT);
    expect(readCustomerInvoiceTableSortPreference("user-b", "org-a", storage)).toEqual(DEFAULT_CUSTOMER_INVOICE_TABLE_SORT);
  });

  test("fails closed for stale preferences and reset removes only this table preference", () => {
    const storage = createStorage();
    storage.setItem(customerInvoiceTableSortStorageKey("user-a", "org-a"), JSON.stringify({ version: 1, sortBy: "removedColumn", sortDir: "sideways" }));
    expect(readCustomerInvoiceTableSortPreference("user-a", "org-a", storage)).toEqual(DEFAULT_CUSTOMER_INVOICE_TABLE_SORT);

    persistCustomerInvoiceTableSortPreference("user-a", "org-a", { version: 1, sortBy: "balance", sortDir: "asc" }, storage);
    clearCustomerInvoiceTableSortPreference("user-a", "org-a", storage);
    expect(readCustomerInvoiceTableSortPreference("user-a", "org-a", storage)).toEqual(DEFAULT_CUSTOMER_INVOICE_TABLE_SORT);
  });

  test("maps Customer Detail labels only to allowlisted invoice API fields", () => {
    expect(customerInvoiceSortApiField("invoiceDate")).toBe("issueDate");
    expect(customerInvoiceSortApiField("lastSent")).toBe("lastSentAt");
    expect(customerInvoiceSortApiField("invoiceStatus")).toBe("status");
    expect(customerInvoiceSortApiField("approval")).toBe("approval");
  });
});

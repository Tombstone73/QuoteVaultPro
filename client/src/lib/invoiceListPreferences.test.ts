import {
  DEFAULT_INVOICE_LIST_PREFERENCES,
  getInvoiceListPreferencesStorageKey,
  persistInvoiceListPreferences,
  readPersistedInvoiceListPreferences,
  resolveInvoiceListViewPreferences,
} from "@/lib/invoiceListPreferences";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("Invoice list preferences", () => {
  it("defaults sticky sorting and filters off", () => {
    expect(resolveInvoiceListViewPreferences(undefined)).toEqual(DEFAULT_INVOICE_LIST_PREFERENCES);
  });

  it("persists structured filters, sort, and page size for the same organization and user", () => {
    const storage = createStorage();
    persistInvoiceListPreferences("user-1", "org-1", {
      version: 1,
      stickySortingAndFilters: true,
      sortKey: "balance",
      sortDir: "asc",
      pageSize: 100,
      filters: {
        status: "overdue",
        includePaidHistorical: true,
        includeCanceled: true,
        customerId: "customer-1",
        customerName: "Acme",
        columnFilters: { sendStatus: "never_sent", balanceMin: "100" },
      },
    }, storage);

    expect(readPersistedInvoiceListPreferences("user-1", "org-1", storage)).toMatchObject({
      stickySortingAndFilters: true,
      sortKey: "balance",
      sortDir: "asc",
      pageSize: 100,
      filters: {
        status: "overdue",
        includePaidHistorical: true,
        includeCanceled: true,
        customerId: "customer-1",
        customerName: "Acme",
        columnFilters: { sendStatus: "never_sent", balanceMin: "100" },
      },
    });
  });

  it("ignores saved sorting and filters while sticky mode is off but retains the chosen page size", () => {
    const resolved = resolveInvoiceListViewPreferences({
      version: 1,
      stickySortingAndFilters: false,
      sortKey: "balance",
      sortDir: "asc",
      pageSize: 100,
      filters: { status: "overdue", columnFilters: { sendStatus: "never_sent" } },
    });

    expect(resolved).toMatchObject({
      stickySortingAndFilters: false,
      sortKey: "issueDate",
      sortDir: "desc",
      pageSize: 100,
      filters: {},
    });
  });

  it("does not store page, search, or session UI state in the preference schema", () => {
    const storage = createStorage();
    const key = getInvoiceListPreferencesStorageKey("user-1", "org-1");
    storage.setItem(key, JSON.stringify({
      version: 1,
      stickySortingAndFilters: true,
      sortKey: "customer",
      sortDir: "asc",
      pageSize: 50,
      page: 3,
      search: "Acme",
      filters: { status: "sent" },
    }));

    expect(readPersistedInvoiceListPreferences("user-1", "org-1", storage)).toEqual({
      version: 1,
      stickySortingAndFilters: true,
      sortKey: "customer",
      sortDir: "asc",
      pageSize: 50,
      filters: { status: "sent" },
    });
  });

  it("scopes preferences to both organization and user and safely falls back for malformed storage", () => {
    const storage = createStorage();
    storage.setItem(getInvoiceListPreferencesStorageKey("user-1", "org-1"), "not-json");
    expect(readPersistedInvoiceListPreferences("user-1", "org-1", storage)).toEqual(DEFAULT_INVOICE_LIST_PREFERENCES);

    persistInvoiceListPreferences("user-1", "org-1", {
      ...DEFAULT_INVOICE_LIST_PREFERENCES,
      stickySortingAndFilters: true,
      pageSize: 25,
    }, storage);
    expect(readPersistedInvoiceListPreferences("user-1", "org-2", storage)).toEqual(DEFAULT_INVOICE_LIST_PREFERENCES);
    expect(readPersistedInvoiceListPreferences("user-2", "org-1", storage)).toEqual(DEFAULT_INVOICE_LIST_PREFERENCES);
  });

  it("keeps an explicitly cleared sticky filter set cleared", () => {
    const storage = createStorage();
    persistInvoiceListPreferences("user-1", "org-1", {
      ...DEFAULT_INVOICE_LIST_PREFERENCES,
      stickySortingAndFilters: true,
      filters: {},
    }, storage);
    expect(readPersistedInvoiceListPreferences("user-1", "org-1", storage).filters).toEqual({});
  });

  it("persists the Unpaid status filter without special client-side handling", () => {
    const storage = createStorage();
    persistInvoiceListPreferences("user-1", "org-1", {
      ...DEFAULT_INVOICE_LIST_PREFERENCES,
      stickySortingAndFilters: true,
      filters: { status: "unpaid" },
    }, storage);
    expect(readPersistedInvoiceListPreferences("user-1", "org-1", storage).filters).toEqual({ status: "unpaid" });
  });

  it("persists the Approved plus Never Sent working set in sticky filters", () => {
    const storage = createStorage();
    persistInvoiceListPreferences("user-1", "org-1", {
      ...DEFAULT_INVOICE_LIST_PREFERENCES,
      stickySortingAndFilters: true,
      filters: { columnFilters: { accountingApproval: "approved", sendStatus: "never_sent" } },
    }, storage);
    expect(readPersistedInvoiceListPreferences("user-1", "org-1", storage).filters).toEqual({
      columnFilters: { accountingApproval: "approved", sendStatus: "never_sent" },
    });
  });
});

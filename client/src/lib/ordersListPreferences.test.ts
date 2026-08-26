import {
  DEFAULT_ORDERS_LIST_PREFERENCES,
  getOrdersListPreferencesStorageKey,
  normalizeOrdersListPreferences,
  persistOrdersListPreferences,
  readPersistedOrdersListPreferences,
  resolveOrdersListViewPreferences,
} from "./ordersListPreferences";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("orders list preferences", () => {
  test("defaults to non-sticky date sorting and 25 rows", () => {
    expect(readPersistedOrdersListPreferences("user-1", "org-1", createStorage()))
      .toEqual(DEFAULT_ORDERS_LIST_PREFERENCES);
  });

  test("persists sticky sort state and rows per page across a remount", () => {
    const storage = createStorage();
    persistOrdersListPreferences("user-1", "org-1", {
      version: 1,
      stickySorting: true,
      sortKey: "proof",
      sortDirection: "asc",
      pageSize: 100,
    }, storage);

    expect(readPersistedOrdersListPreferences("user-1", "org-1", storage)).toMatchObject({
      stickySorting: true,
      sortKey: "proof",
      sortDirection: "asc",
      pageSize: 100,
    });
  });

  test("keeps rows per page while sticky sorting is off", () => {
    const storage = createStorage();
    persistOrdersListPreferences("user-1", "org-1", {
      ...DEFAULT_ORDERS_LIST_PREFERENCES,
      pageSize: 50,
    }, storage);

    expect(readPersistedOrdersListPreferences("user-1", "org-1", storage)).toMatchObject({
      stickySorting: false,
      pageSize: 50,
    });
  });

  test("ignores a remembered sort when sticky sorting is off", () => {
    expect(resolveOrdersListViewPreferences({
      version: 1,
      stickySorting: false,
      sortKey: "proof",
      sortDirection: "asc",
      pageSize: 100,
    })).toEqual({
      stickySorting: false,
      sortKey: "date",
      sortDirection: "desc",
      pageSize: 100,
    });
  });

  test("fails safely for corrupt, stale, and unsupported persisted values", () => {
    expect(normalizeOrdersListPreferences({
      version: 1,
      stickySorting: "yes",
      sortKey: "unknown",
      sortDirection: "sideways",
      pageSize: 999,
    })).toEqual(DEFAULT_ORDERS_LIST_PREFERENCES);
    expect(normalizeOrdersListPreferences({ version: 0 })).toEqual(DEFAULT_ORDERS_LIST_PREFERENCES);
  });

  test("scopes preferences by organization and user", () => {
    const storage = createStorage();
    persistOrdersListPreferences("user-1", "org-1", {
      ...DEFAULT_ORDERS_LIST_PREFERENCES,
      pageSize: 200,
    }, storage);

    expect(getOrdersListPreferencesStorageKey("user-1", "org-1"))
      .toBe("titanos:orders:list-preferences:v1:org_org-1:user_user-1");
    expect(readPersistedOrdersListPreferences("user-1", "org-2", storage))
      .toEqual(DEFAULT_ORDERS_LIST_PREFERENCES);
    expect(readPersistedOrdersListPreferences("user-2", "org-1", storage))
      .toEqual(DEFAULT_ORDERS_LIST_PREFERENCES);
  });
});

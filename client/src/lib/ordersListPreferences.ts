export type OrdersListSortKey =
  | "date"
  | "created"
  | "orderNumber"
  | "poNumber"
  | "customer"
  | "total"
  | "dueDate"
  | "status"
  | "priority"
  | "items"
  | "label"
  | "listLabel"
  | "invoiceStatus"
  | "paymentStatus"
  | "proof"
  | "production";

export type OrdersListSortDirection = "asc" | "desc";
export type OrdersListPageSize = 10 | 25 | 50 | 100 | 200;

export type OrdersListPreferences = {
  version: 1;
  stickySorting: boolean;
  sortKey: OrdersListSortKey;
  sortDirection: OrdersListSortDirection;
  pageSize: OrdersListPageSize;
  /** Sticky only: null means every currently active status pill is selected. */
  statusPillSelection: string[] | null;
  /** A display preference that is deliberately independent of sticky sorting. */
  includeThumbnails: boolean;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export const DEFAULT_ORDERS_LIST_PREFERENCES: OrdersListPreferences = {
  version: 1,
  stickySorting: false,
  sortKey: "date",
  sortDirection: "desc",
  pageSize: 25,
  statusPillSelection: null,
  includeThumbnails: false,
};

export const ORDERS_LIST_PREFERENCES_STORAGE_KEY_PREFIX = "titanos:orders:list-preferences:v1";

const SORT_KEYS = new Set<OrdersListSortKey>([
  "date", "created", "orderNumber", "poNumber", "customer", "total", "dueDate",
  "status", "priority", "items", "label", "listLabel", "invoiceStatus",
  "paymentStatus", "proof", "production",
]);
const SORT_DIRECTIONS = new Set<OrdersListSortDirection>(["asc", "desc"]);
const PAGE_SIZES = new Set<OrdersListPageSize>([10, 25, 50, 100, 200]);

export function resolveOrdersListViewPreferences(value: unknown): Pick<
  OrdersListPreferences,
  "stickySorting" | "sortKey" | "sortDirection" | "pageSize" | "statusPillSelection" | "includeThumbnails"
> {
  const preferences = normalizeOrdersListPreferences(value);
  return {
    stickySorting: preferences.stickySorting,
    sortKey: preferences.stickySorting ? preferences.sortKey : DEFAULT_ORDERS_LIST_PREFERENCES.sortKey,
    sortDirection: preferences.stickySorting ? preferences.sortDirection : DEFAULT_ORDERS_LIST_PREFERENCES.sortDirection,
    pageSize: preferences.pageSize,
    statusPillSelection: preferences.stickySorting ? preferences.statusPillSelection : null,
    includeThumbnails: preferences.includeThumbnails,
  };
}

function getStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function getOrdersListPreferencesStorageKey(userId: string, organizationId?: string | null): string {
  const userScope = String(userId || "").trim() || "unknown";
  const organizationScope = String(organizationId || "").trim() || "unknown";
  return `${ORDERS_LIST_PREFERENCES_STORAGE_KEY_PREFIX}:org_${organizationScope}:user_${userScope}`;
}

export function normalizeOrdersListPreferences(value: unknown): OrdersListPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_ORDERS_LIST_PREFERENCES };
  }

  const raw = value as Partial<Record<keyof OrdersListPreferences, unknown>>;
  if (raw.version !== 1) return { ...DEFAULT_ORDERS_LIST_PREFERENCES };

  const sortKey = typeof raw.sortKey === "string" && SORT_KEYS.has(raw.sortKey as OrdersListSortKey)
    ? raw.sortKey as OrdersListSortKey
    : DEFAULT_ORDERS_LIST_PREFERENCES.sortKey;
  const sortDirection = typeof raw.sortDirection === "string" && SORT_DIRECTIONS.has(raw.sortDirection as OrdersListSortDirection)
    ? raw.sortDirection as OrdersListSortDirection
    : DEFAULT_ORDERS_LIST_PREFERENCES.sortDirection;
  const pageSize = typeof raw.pageSize === "number" && PAGE_SIZES.has(raw.pageSize as OrdersListPageSize)
    ? raw.pageSize as OrdersListPageSize
    : DEFAULT_ORDERS_LIST_PREFERENCES.pageSize;
  const statusPillSelection = raw.statusPillSelection === null
    ? null
    : Array.isArray(raw.statusPillSelection)
      ? Array.from(new Set(raw.statusPillSelection.filter((id): id is string => typeof id === "string" && id.trim().length > 0)))
      : DEFAULT_ORDERS_LIST_PREFERENCES.statusPillSelection;

  return {
    version: 1,
    stickySorting: typeof raw.stickySorting === "boolean" ? raw.stickySorting : false,
    sortKey,
    sortDirection,
    pageSize,
    statusPillSelection,
    includeThumbnails: typeof raw.includeThumbnails === "boolean"
      ? raw.includeThumbnails
      : DEFAULT_ORDERS_LIST_PREFERENCES.includeThumbnails,
  };
}

export function readPersistedOrdersListPreferences(
  userId: string,
  organizationId?: string | null,
  storage?: StorageLike | null,
): OrdersListPreferences {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return { ...DEFAULT_ORDERS_LIST_PREFERENCES };

  try {
    const raw = resolvedStorage.getItem(getOrdersListPreferencesStorageKey(userId, organizationId));
    return raw ? normalizeOrdersListPreferences(JSON.parse(raw)) : { ...DEFAULT_ORDERS_LIST_PREFERENCES };
  } catch {
    return { ...DEFAULT_ORDERS_LIST_PREFERENCES };
  }
}

export function persistOrdersListPreferences(
  userId: string,
  organizationId: string | null | undefined,
  preferences: OrdersListPreferences,
  storage?: StorageLike | null,
): void {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return;

  try {
    resolvedStorage.setItem(
      getOrdersListPreferencesStorageKey(userId, organizationId),
      JSON.stringify(normalizeOrdersListPreferences(preferences)),
    );
  } catch {
    // Local storage is an optional UX enhancement; failures must not affect loading.
  }
}

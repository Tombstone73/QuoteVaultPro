type StorageLike = Pick<Storage, "getItem" | "setItem">;

export type OrderDetailDisplayPreferences = {
  version: 1;
  showOrderLineThumbnails: boolean;
};

export const DEFAULT_ORDER_DETAIL_DISPLAY_PREFERENCES: OrderDetailDisplayPreferences = {
  version: 1,
  showOrderLineThumbnails: false,
};

export const ORDER_DETAIL_DISPLAY_PREFERENCES_STORAGE_KEY_PREFIX = "titanos:orders:detail-display-preferences:v1";

function getStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function getOrderDetailDisplayPreferencesStorageKey(userId: string, organizationId?: string | null): string {
  const userScope = String(userId || "").trim() || "unknown";
  const organizationScope = String(organizationId || "").trim() || "unknown";
  return `${ORDER_DETAIL_DISPLAY_PREFERENCES_STORAGE_KEY_PREFIX}:org_${organizationScope}:user_${userScope}`;
}

export function normalizeOrderDetailDisplayPreferences(value: unknown): OrderDetailDisplayPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_ORDER_DETAIL_DISPLAY_PREFERENCES };
  const raw = value as Partial<Record<keyof OrderDetailDisplayPreferences, unknown>>;
  if (raw.version !== 1) return { ...DEFAULT_ORDER_DETAIL_DISPLAY_PREFERENCES };
  return { version: 1, showOrderLineThumbnails: typeof raw.showOrderLineThumbnails === "boolean" ? raw.showOrderLineThumbnails : false };
}

export function readPersistedOrderDetailDisplayPreferences(userId: string, organizationId?: string | null, storage?: StorageLike | null): OrderDetailDisplayPreferences {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return { ...DEFAULT_ORDER_DETAIL_DISPLAY_PREFERENCES };
  try {
    const raw = resolvedStorage.getItem(getOrderDetailDisplayPreferencesStorageKey(userId, organizationId));
    return raw ? normalizeOrderDetailDisplayPreferences(JSON.parse(raw)) : { ...DEFAULT_ORDER_DETAIL_DISPLAY_PREFERENCES };
  } catch {
    return { ...DEFAULT_ORDER_DETAIL_DISPLAY_PREFERENCES };
  }
}

export function persistOrderDetailDisplayPreferences(userId: string, organizationId: string | null | undefined, preferences: OrderDetailDisplayPreferences, storage?: StorageLike | null): void {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return;
  try {
    resolvedStorage.setItem(getOrderDetailDisplayPreferencesStorageKey(userId, organizationId), JSON.stringify(normalizeOrderDetailDisplayPreferences(preferences)));
  } catch {
    // Display preferences are optional and must never affect order workflows.
  }
}

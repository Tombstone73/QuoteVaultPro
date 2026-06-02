export type PrepressListSortBy = "due_date" | "job_number" | "client" | "type" | "material";
export type PrepressListSortDirection = "asc" | "desc";
export type PrepressDestinationFilter = "all" | "roll" | "flatbed";
export type PrepressStatusFilter = "all" | "ready_for_prepress" | "in_prepress";

export type PrepressListPreferences = {
  sortBy: PrepressListSortBy;
  sortDirection: PrepressListSortDirection;
  destination: PrepressDestinationFilter;
  status: PrepressStatusFilter;
  rush: boolean;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export const DEFAULT_PREPRESS_LIST_PREFERENCES: PrepressListPreferences = {
  sortBy: "due_date",
  sortDirection: "asc",
  destination: "all",
  status: "all",
  rush: false,
};

export const PREPRESS_LIST_PREFERENCES_STORAGE_KEY_PREFIX = "titanos:prepress:list-preferences";

const PREPRESS_SORT_BY_VALUES = new Set<PrepressListSortBy>(["due_date", "job_number", "client", "type", "material"]);
const PREPRESS_SORT_DIRECTION_VALUES = new Set<PrepressListSortDirection>(["asc", "desc"]);
const PREPRESS_DESTINATION_VALUES = new Set<PrepressDestinationFilter>(["all", "roll", "flatbed"]);
const PREPRESS_STATUS_VALUES = new Set<PrepressStatusFilter>(["all", "ready_for_prepress", "in_prepress"]);

function getStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function getPrepressListPreferencesStorageKey(userId: string): string {
  return `${PREPRESS_LIST_PREFERENCES_STORAGE_KEY_PREFIX}:${userId}`;
}

export function normalizePrepressListPreferences(value: unknown): PrepressListPreferences {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<Record<keyof PrepressListPreferences, unknown>>
    : {};

  const sortBy = readString(raw.sortBy);
  const sortDirection = readString(raw.sortDirection);
  const destination = readString(raw.destination);
  const status = readString(raw.status);

  return {
    sortBy: sortBy && PREPRESS_SORT_BY_VALUES.has(sortBy as PrepressListSortBy)
      ? sortBy as PrepressListSortBy
      : DEFAULT_PREPRESS_LIST_PREFERENCES.sortBy,
    sortDirection: sortDirection && PREPRESS_SORT_DIRECTION_VALUES.has(sortDirection as PrepressListSortDirection)
      ? sortDirection as PrepressListSortDirection
      : DEFAULT_PREPRESS_LIST_PREFERENCES.sortDirection,
    destination: destination && PREPRESS_DESTINATION_VALUES.has(destination as PrepressDestinationFilter)
      ? destination as PrepressDestinationFilter
      : DEFAULT_PREPRESS_LIST_PREFERENCES.destination,
    status: status && PREPRESS_STATUS_VALUES.has(status as PrepressStatusFilter)
      ? status as PrepressStatusFilter
      : DEFAULT_PREPRESS_LIST_PREFERENCES.status,
    rush: typeof raw.rush === "boolean" ? raw.rush : DEFAULT_PREPRESS_LIST_PREFERENCES.rush,
  };
}

export function readPersistedPrepressListPreferences(
  userId: string,
  storage?: StorageLike | null,
): PrepressListPreferences {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return { ...DEFAULT_PREPRESS_LIST_PREFERENCES };

  try {
    const raw = resolvedStorage.getItem(getPrepressListPreferencesStorageKey(userId));
    if (!raw) return { ...DEFAULT_PREPRESS_LIST_PREFERENCES };
    return normalizePrepressListPreferences(JSON.parse(raw));
  } catch (error) {
    console.error("Failed to read prepress list preferences:", error);
    return { ...DEFAULT_PREPRESS_LIST_PREFERENCES };
  }
}

export function persistPrepressListPreferences(
  userId: string,
  preferences: PrepressListPreferences,
  storage?: StorageLike | null,
): void {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return;

  try {
    resolvedStorage.setItem(
      getPrepressListPreferencesStorageKey(userId),
      JSON.stringify(normalizePrepressListPreferences(preferences)),
    );
  } catch (error) {
    console.error("Failed to save prepress list preferences:", error);
  }
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export type TravelerPrinterPreferences = {
  version: 1;
  defaultDestinationId: string | null;
};

export type TravelerPrinterDestination = {
  id: string;
  isDefault: boolean;
  available: boolean;
};

export const TRAVELER_PRINTER_PREFERENCES_STORAGE_KEY_PREFIX = "titanos:traveler:printer-preferences:v1";

export const DEFAULT_TRAVELER_PRINTER_PREFERENCES: TravelerPrinterPreferences = {
  version: 1,
  defaultDestinationId: null,
};

function getStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function getTravelerPrinterPreferencesStorageKey(userId: string, organizationId?: string | null): string {
  const userScope = String(userId || "").trim() || "unknown";
  const organizationScope = String(organizationId || "").trim() || "unknown";
  return `${TRAVELER_PRINTER_PREFERENCES_STORAGE_KEY_PREFIX}:org_${organizationScope}:user_${userScope}`;
}

export function normalizeTravelerPrinterPreferences(value: unknown): TravelerPrinterPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_TRAVELER_PRINTER_PREFERENCES };
  }

  const raw = value as Partial<Record<keyof TravelerPrinterPreferences, unknown>>;
  if (raw.version !== 1) return { ...DEFAULT_TRAVELER_PRINTER_PREFERENCES };

  return {
    version: 1,
    defaultDestinationId: typeof raw.defaultDestinationId === "string" && raw.defaultDestinationId.trim()
      ? raw.defaultDestinationId.trim()
      : null,
  };
}

export function readPersistedTravelerPrinterPreferences(
  userId: string,
  organizationId?: string | null,
  storage?: StorageLike | null,
): TravelerPrinterPreferences {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return { ...DEFAULT_TRAVELER_PRINTER_PREFERENCES };

  try {
    const raw = resolvedStorage.getItem(getTravelerPrinterPreferencesStorageKey(userId, organizationId));
    return raw ? normalizeTravelerPrinterPreferences(JSON.parse(raw)) : { ...DEFAULT_TRAVELER_PRINTER_PREFERENCES };
  } catch {
    return { ...DEFAULT_TRAVELER_PRINTER_PREFERENCES };
  }
}

export function persistTravelerPrinterPreferences(
  userId: string,
  organizationId: string | null | undefined,
  preferences: TravelerPrinterPreferences,
  storage?: StorageLike | null,
): void {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return;

  try {
    resolvedStorage.setItem(
      getTravelerPrinterPreferencesStorageKey(userId, organizationId),
      JSON.stringify(normalizeTravelerPrinterPreferences(preferences)),
    );
  } catch {
    // A saved Traveler destination is an optional per-user UX preference.
  }
}

export function resolveTravelerPrinterDestinationId(
  destinations: TravelerPrinterDestination[],
  preferredDestinationId?: string | null,
): string {
  const preferred = preferredDestinationId && destinations.find((destination) => (
    destination.id === preferredDestinationId && destination.available
  ));
  if (preferred) return preferred.id;

  const organizationDefault = destinations.find((destination) => destination.isDefault && destination.available);
  if (organizationDefault) return organizationDefault.id;

  return destinations.find((destination) => destination.available)?.id ?? "";
}

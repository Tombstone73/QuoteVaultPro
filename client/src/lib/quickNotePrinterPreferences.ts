import {
  DEFAULT_TRAVELER_PRINTER_PREFERENCES,
  getTravelerPrinterPreferencesStorageKey,
  normalizeTravelerPrinterPreferences,
  persistTravelerPrinterPreferences,
  readPersistedTravelerPrinterPreferences,
  resolveTravelerPrinterDestinationId,
} from "@/lib/travelerPrinterPreferences";

export type QuickNotePrinterPreferences = typeof DEFAULT_TRAVELER_PRINTER_PREFERENCES;
export const QUICK_NOTE_PRINTER_PREFERENCES_STORAGE_KEY_PREFIX = "titanos:quick-note:printer-preferences:v1";
export const DEFAULT_QUICK_NOTE_PRINTER_PREFERENCES = DEFAULT_TRAVELER_PRINTER_PREFERENCES;

function key(userId: string, organizationId?: string | null) {
  return getTravelerPrinterPreferencesStorageKey(userId, organizationId)
    .replace("titanos:traveler:printer-preferences:v1", QUICK_NOTE_PRINTER_PREFERENCES_STORAGE_KEY_PREFIX);
}
export function readPersistedQuickNotePrinterPreferences(userId: string, organizationId?: string | null): QuickNotePrinterPreferences {
  if (typeof window === "undefined") return { ...DEFAULT_QUICK_NOTE_PRINTER_PREFERENCES };
  try { const raw = localStorage.getItem(key(userId, organizationId)); return raw ? normalizeTravelerPrinterPreferences(JSON.parse(raw)) : { ...DEFAULT_QUICK_NOTE_PRINTER_PREFERENCES }; } catch { return { ...DEFAULT_QUICK_NOTE_PRINTER_PREFERENCES }; }
}
export function persistQuickNotePrinterPreferences(userId: string, organizationId: string | null | undefined, preferences: QuickNotePrinterPreferences) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(key(userId, organizationId), JSON.stringify(normalizeTravelerPrinterPreferences(preferences))); } catch { /* optional preference */ }
}
export { resolveTravelerPrinterDestinationId };

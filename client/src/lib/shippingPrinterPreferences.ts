import type { ShippingDocumentType } from "@shared/shippingDocuments";
import { getTravelerPrinterPreferencesStorageKey, normalizeTravelerPrinterPreferences, DEFAULT_TRAVELER_PRINTER_PREFERENCES } from "./travelerPrinterPreferences";
export { resolveTravelerPrinterDestinationId } from "./travelerPrinterPreferences";

export function shippingPrinterPreferenceKey(userId: string, organizationId: string | null | undefined, documentType: ShippingDocumentType) {
  return getTravelerPrinterPreferencesStorageKey(userId, organizationId)
    .replace("titanos:traveler:printer-preferences:v1", `titanos:shipping:${documentType}:printer-preferences:v1`);
}
export function readShippingPrinterPreference(userId: string, organizationId: string | null | undefined, type: ShippingDocumentType) {
  try { return normalizeTravelerPrinterPreferences(JSON.parse(localStorage.getItem(shippingPrinterPreferenceKey(userId, organizationId, type)) || "null")); }
  catch { return { ...DEFAULT_TRAVELER_PRINTER_PREFERENCES }; }
}
export function saveShippingPrinterPreference(userId: string, organizationId: string | null | undefined, type: ShippingDocumentType, destinationId: string) {
  try { localStorage.setItem(shippingPrinterPreferenceKey(userId, organizationId, type), JSON.stringify({ version: 1, defaultDestinationId: destinationId })); }
  catch { /* Optional preference; never fail a successfully queued print. */ }
}

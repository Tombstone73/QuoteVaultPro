import { z } from "zod";

/** A user-scoped key in the existing list_settings preference store. */
export const TRAVELER_PRINTER_PREFERENCE_LIST_KEY = "traveler-printer-preferences";

export const travelerPrinterPreferenceSchema = z.object({
  defaultDestinationId: z.string().trim().min(1).max(128),
});

export type TravelerPrinterPreference = z.infer<typeof travelerPrinterPreferenceSchema>;

export type TravelerPrinterPreferenceResponse = {
  defaultDestinationId: string | null;
  hasSavedDefault: boolean;
};

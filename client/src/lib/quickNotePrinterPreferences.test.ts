import { describe, expect, test } from "@jest/globals";
import { persistQuickNotePrinterPreferences, readPersistedQuickNotePrinterPreferences } from "./quickNotePrinterPreferences";

describe("Quick Note printer preferences", () => {
  test("are isolated from Traveler preferences and scoped to the user and organization", () => {
    localStorage.clear();
    persistQuickNotePrinterPreferences("user-a", "org-a", { version: 1, defaultDestinationId: "note-printer" });
    expect(readPersistedQuickNotePrinterPreferences("user-a", "org-a").defaultDestinationId).toBe("note-printer");
    expect(readPersistedQuickNotePrinterPreferences("user-b", "org-a").defaultDestinationId).toBeNull();
    expect(readPersistedQuickNotePrinterPreferences("user-a", "org-b").defaultDestinationId).toBeNull();
  });
});

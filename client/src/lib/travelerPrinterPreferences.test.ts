import { describe, expect, test } from "@jest/globals";

import {
  getTravelerPrinterPreferencesStorageKey,
  persistTravelerPrinterPreferences,
  readPersistedTravelerPrinterPreferences,
  resolveTravelerPrinterDestinationId,
} from "./travelerPrinterPreferences";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const destinations = [
  { id: "prepress", isDefault: true, available: true },
  { id: "shipping", isDefault: false, available: true },
  { id: "offline", isDefault: false, available: false },
];

describe("Traveler printer preferences", () => {
  test("uses the current organization default when the user has no saved preference", () => {
    expect(resolveTravelerPrinterDestinationId(destinations)).toBe("prepress");
  });

  test("persists a saved Traveler destination across a refresh for the same user and organization", () => {
    const storage = new MemoryStorage();
    persistTravelerPrinterPreferences("user-a", "org-a", { version: 1, defaultDestinationId: "shipping" }, storage);

    const preferences = readPersistedTravelerPrinterPreferences("user-a", "org-a", storage);
    expect(preferences.defaultDestinationId).toBe("shipping");
    expect(resolveTravelerPrinterDestinationId(destinations, preferences.defaultDestinationId)).toBe("shipping");
  });

  test("does not leak a saved destination across users or organizations", () => {
    const storage = new MemoryStorage();
    persistTravelerPrinterPreferences("user-a", "org-a", { version: 1, defaultDestinationId: "shipping" }, storage);

    expect(readPersistedTravelerPrinterPreferences("user-b", "org-a", storage).defaultDestinationId).toBeNull();
    expect(readPersistedTravelerPrinterPreferences("user-a", "org-b", storage).defaultDestinationId).toBeNull();
    expect(getTravelerPrinterPreferencesStorageKey("user-a", "org-a"))
      .not.toBe(getTravelerPrinterPreferencesStorageKey("user-b", "org-a"));
  });

  test("falls back safely when the saved destination is missing or unavailable", () => {
    expect(resolveTravelerPrinterDestinationId(destinations, "deleted-profile")).toBe("prepress");
    expect(resolveTravelerPrinterDestinationId(destinations, "offline")).toBe("prepress");
  });

  test("keeps the saved default until an explicit replacement is persisted", () => {
    const storage = new MemoryStorage();
    persistTravelerPrinterPreferences("user-a", "org-a", { version: 1, defaultDestinationId: "prepress" }, storage);

    expect(readPersistedTravelerPrinterPreferences("user-a", "org-a", storage).defaultDestinationId).toBe("prepress");

    persistTravelerPrinterPreferences("user-a", "org-a", { version: 1, defaultDestinationId: "shipping" }, storage);
    expect(readPersistedTravelerPrinterPreferences("user-a", "org-a", storage).defaultDestinationId).toBe("shipping");
  });
});

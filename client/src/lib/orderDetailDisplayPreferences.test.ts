import { describe, expect, test } from "@jest/globals";
import { DEFAULT_ORDER_DETAIL_DISPLAY_PREFERENCES, getOrderDetailDisplayPreferencesStorageKey, persistOrderDetailDisplayPreferences, readPersistedOrderDetailDisplayPreferences } from "./orderDetailDisplayPreferences";

function createStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
}

describe("Order Detail display preferences", () => {
  test("defaults to compact line items", () => {
    expect(readPersistedOrderDetailDisplayPreferences("user-a", "org-a", createStorage())).toEqual(DEFAULT_ORDER_DETAIL_DISPLAY_PREFERENCES);
  });

  test("persists thumbnails across order navigation for the same user and organization", () => {
    const storage = createStorage();
    persistOrderDetailDisplayPreferences("user-a", "org-a", { version: 1, showOrderLineThumbnails: true }, storage);
    expect(readPersistedOrderDetailDisplayPreferences("user-a", "org-a", storage).showOrderLineThumbnails).toBe(true);
  });

  test("keeps each user and organization independent", () => {
    const storage = createStorage();
    persistOrderDetailDisplayPreferences("user-a", "org-a", { version: 1, showOrderLineThumbnails: true }, storage);
    expect(readPersistedOrderDetailDisplayPreferences("user-b", "org-a", storage)).toEqual(DEFAULT_ORDER_DETAIL_DISPLAY_PREFERENCES);
    expect(readPersistedOrderDetailDisplayPreferences("user-a", "org-b", storage)).toEqual(DEFAULT_ORDER_DETAIL_DISPLAY_PREFERENCES);
    expect(getOrderDetailDisplayPreferencesStorageKey("user-a", "org-a")).toBe("titanos:orders:detail-display-preferences:v1:org_org-a:user_user-a");
  });
});

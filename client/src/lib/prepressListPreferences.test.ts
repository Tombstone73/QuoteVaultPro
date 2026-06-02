import { describe, expect, test } from "@jest/globals";
import {
  DEFAULT_PREPRESS_LIST_PREFERENCES,
  getPrepressListPreferencesStorageKey,
  normalizePrepressListPreferences,
  persistPrepressListPreferences,
  readPersistedPrepressListPreferences,
} from "./prepressListPreferences";

function createStorage() {
  const store = new Map<string, string>();

  return {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe("prepress list preferences", () => {
  test("falls back to the default unlocked list view when no preference exists", () => {
    const storage = createStorage();

    expect(readPersistedPrepressListPreferences("user-1", storage)).toEqual(DEFAULT_PREPRESS_LIST_PREFERENCES);
  });

  test("persists sort selection and direction for remount readback", () => {
    const storage = createStorage();

    persistPrepressListPreferences("user-1", {
      ...DEFAULT_PREPRESS_LIST_PREFERENCES,
      sortBy: "client",
      sortDirection: "desc",
    }, storage);

    expect(readPersistedPrepressListPreferences("user-1", storage)).toEqual({
      ...DEFAULT_PREPRESS_LIST_PREFERENCES,
      sortBy: "client",
      sortDirection: "desc",
    });
  });

  test("persists destination, status, and rush filters", () => {
    const storage = createStorage();

    persistPrepressListPreferences("user-1", {
      sortBy: "job_number",
      sortDirection: "asc",
      destination: "roll",
      status: "in_prepress",
      rush: true,
    }, storage);

    expect(readPersistedPrepressListPreferences("user-1", storage)).toEqual({
      sortBy: "job_number",
      sortDirection: "asc",
      destination: "roll",
      status: "in_prepress",
      rush: true,
    });
  });

  test("normalizes invalid saved values back to safe defaults", () => {
    expect(normalizePrepressListPreferences({
      sortBy: "bad-sort",
      sortDirection: "sideways",
      destination: "screen-print",
      status: "blocked",
      rush: "yes",
    })).toEqual(DEFAULT_PREPRESS_LIST_PREFERENCES);
  });

  test("uses user-scoped storage keys so browser preferences do not bleed between users", () => {
    const storage = createStorage();

    persistPrepressListPreferences("user-1", {
      ...DEFAULT_PREPRESS_LIST_PREFERENCES,
      destination: "flatbed",
      status: "ready_for_prepress",
      rush: true,
    }, storage);

    expect(getPrepressListPreferencesStorageKey("user-1")).toBe("titanos:prepress:list-preferences:user-1");
    expect(getPrepressListPreferencesStorageKey("user-2")).toBe("titanos:prepress:list-preferences:user-2");
    expect(readPersistedPrepressListPreferences("user-2", storage)).toEqual(DEFAULT_PREPRESS_LIST_PREFERENCES);
  });
});

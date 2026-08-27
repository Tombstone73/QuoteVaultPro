import assert from "node:assert/strict";
import {
  defaultSalesUpdatedSort,
  mayWriteSalesUpdatedSort,
  readSalesUpdatedSort,
  salesSortPreferenceKey,
  writeSalesUpdatedSort,
} from "./salesSortPreference";

type FakeStorage = Storage & { readonly writes: readonly string[] };
const fakeStorage = (): FakeStorage => {
  const values = new Map<string, string>();
  const writes: string[] = [];
  return {
    get length() { return values.size; },
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { writes.push(`${key}:${value}`); values.set(key, value); },
    clear: () => values.clear(),
    writes,
  } as FakeStorage;
};

const restoreWindow = (globalThis as { window?: Window }).window;
try {
  const storage = fakeStorage();
  (globalThis as { window?: Window }).window = { localStorage: storage } as unknown as Window;
  const ordersA = salesSortPreferenceKey("orders", "session-a", "org-a");
  const ordersB = salesSortPreferenceKey("orders", "session-a", "org-b");
  const quotesA = salesSortPreferenceKey("quotes", "session-a", "org-a");

  assert.equal(readSalesUpdatedSort(undefined), defaultSalesUpdatedSort, "unavailable scope uses the canonical default");
  assert.equal(readSalesUpdatedSort(ordersA), defaultSalesUpdatedSort, "no saved preference uses the default");
  assert.equal(mayWriteSalesUpdatedSort(ordersA, undefined), false, "boot defaults cannot write before hydration");
  assert.equal(storage.writes.length, 0);

  writeSalesUpdatedSort(ordersA, "updated_asc");
  assert.equal(readSalesUpdatedSort(ordersA), "updated_asc", "saved oldest rehydrates after trusted scope resolution");
  assert.equal(readSalesUpdatedSort(ordersB), defaultSalesUpdatedSort, "organization preferences remain independent");
  assert.equal(readSalesUpdatedSort(quotesA), defaultSalesUpdatedSort, "Quote and Order preferences remain independent");
  assert.equal(mayWriteSalesUpdatedSort(ordersA, ordersA), true, "user changes persist only after exact-scope hydration");

  writeSalesUpdatedSort(quotesA, "updated_desc");
  assert.equal(readSalesUpdatedSort(quotesA), "updated_desc", "saved newest restores");
  storage.setItem(ordersB, "unexpected-value");
  assert.equal(readSalesUpdatedSort(ordersB), defaultSalesUpdatedSort, "invalid storage values fail safely");

  (globalThis as { window?: Window }).window = {
    get localStorage() { throw new Error("storage unavailable"); },
  } as unknown as Window;
  assert.equal(readSalesUpdatedSort(ordersA), defaultSalesUpdatedSort, "storage failure does not crash reads");
  writeSalesUpdatedSort(ordersA, "updated_asc");
} finally {
  (globalThis as { window?: Window }).window = restoreWindow;
}

console.log("Scoped Sales sort-preference helper tests passed.");

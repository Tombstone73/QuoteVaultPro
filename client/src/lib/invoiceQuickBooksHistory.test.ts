import { describe, expect, test } from "@jest/globals";
import { hasPreviousQuickBooksSync, quickBooksHistoryLabel } from "./invoiceQuickBooksHistory";

describe("Invoice QuickBooks history presentation", () => {
  test("revoked approval and needs_resync do not erase the earlier export", () => {
    const history = hasPreviousQuickBooksSync({ qbSyncStatus: "needs_resync", lastQbSyncedVersion: 1 });
    expect(quickBooksHistoryLabel("Not Synced", history, false)).toBe("Previously synced · Update required");
  });
  test.each(["Failed", "Queued", "Approval Required"])("preserves current %s alongside prior history", label => {
    expect(quickBooksHistoryLabel(label, true, false)).toBe(`Previously synced · ${label}`);
  });
  test("IDs or an unsuccessful attempt alone do not claim successful sync", () => {
    expect(hasPreviousQuickBooksSync({ qbSyncStatus: "failed" })).toBe(false);
    expect(hasPreviousQuickBooksSync({ qbSyncStatus: "pending" })).toBe(false);
    expect(quickBooksHistoryLabel("Not Synced", false, false)).toBe("Not Synced");
    expect(quickBooksHistoryLabel("Synced", true, true)).toBe("Synced");
    expect(quickBooksHistoryLabel("Imported", true, false)).toBe("Imported");
  });
});

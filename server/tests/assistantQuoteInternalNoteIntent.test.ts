import { describe, expect, test } from "@jest/globals";
import { resolveQuoteInternalNoteIntent } from "../services/assistant/execution/quoteInternalNoteIntent";

const quoteContext = {
  contextVersion: "v1" as const,
  route: "/quotes/quote_1",
  pageTitle: "Quote Q-1042",
  entityType: "quote" as const,
  entityId: "quote_1",
  selectedRecordIds: [],
  activeFilters: [],
  capturedAt: "2026-07-21T12:00:00.000Z",
  unsavedChanges: false,
};

describe("quote internal-note intent", () => {
  test("resolves a note on the trusted current quote", () => {
    expect(resolveQuoteInternalNoteIntent(
      "Add a note to this quote that the customer is supplying final artwork tomorrow.", quoteContext,
    )).toEqual({ kind: "resolved", quoteId: "quote_1", noteText: "the customer is supplying final artwork tomorrow." });
  });

  test("keeps a quoted number as display validation only", () => {
    const context = { ...quoteContext, entityType: undefined, entityId: undefined };
    expect(resolveQuoteInternalNoteIntent("Put an internal note on quote Q-1042: Artwork arrives tomorrow.", context)).toEqual({
      kind: "resolved", expectedQuoteNumber: "Q-1042", noteText: "Artwork arrives tomorrow.",
    });
  });

  test("refuses requests that try to change customer-facing state", () => {
    expect(resolveQuoteInternalNoteIntent("Add a customer-facing note to this quote that changes pricing.", quoteContext))
      .toEqual({ kind: "unsupported" });
  });

  test("does not treat free-text GO as an executable intent", () => {
    expect(resolveQuoteInternalNoteIntent("GO", quoteContext)).toEqual({ kind: "unsupported" });
  });
});

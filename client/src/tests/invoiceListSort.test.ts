import { describe, expect, test } from "@jest/globals";
import { getNextInvoiceSortState } from "@/lib/invoiceListSort";

describe("invoice list sorting", () => {
  test("new numeric and date sorts choose predictable default directions", () => {
    expect(getNextInvoiceSortState({ sortKey: "issueDate", sortDir: "desc" }, "invoiceNumber")).toEqual({
      sortKey: "invoiceNumber",
      sortDir: "asc",
    });
    expect(getNextInvoiceSortState({ sortKey: "invoiceNumber", sortDir: "asc" }, "dueDate")).toEqual({
      sortKey: "dueDate",
      sortDir: "desc",
    });
    expect(getNextInvoiceSortState({ sortKey: "dueDate", sortDir: "desc" }, "balance")).toEqual({
      sortKey: "balance",
      sortDir: "desc",
    });
    expect(getNextInvoiceSortState({ sortKey: "balance", sortDir: "desc" }, "lastSentAt")).toEqual({
      sortKey: "lastSentAt",
      sortDir: "desc",
    });
  });

  test("clicking the active sort key toggles direction", () => {
    expect(getNextInvoiceSortState({ sortKey: "balance", sortDir: "desc" }, "balance")).toEqual({
      sortKey: "balance",
      sortDir: "asc",
    });
    expect(getNextInvoiceSortState({ sortKey: "balance", sortDir: "asc" }, "balance")).toEqual({
      sortKey: "balance",
      sortDir: "desc",
    });
  });
});

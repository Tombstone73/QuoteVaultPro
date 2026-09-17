import { describe, expect, test } from "@jest/globals";
import { getInvoiceEditLockMessage } from "@/lib/invoiceEditLockCopy";

describe("invoice edit lock copy", () => {
  test("draft invoices do not show lock copy", () => {
    expect(getInvoiceEditLockMessage("draft", "financial")).toBe("");
  });

  test("finalized invoices show finalized-specific financial lock copy", () => {
    expect(getInvoiceEditLockMessage("finalized", "financial")).toBe(
      "Financial edits are locked after an invoice is finalized. Void or create a revised invoice to make changes.",
    );
  });

  test("paid and void invoices show paid/void-specific copy", () => {
    expect(getInvoiceEditLockMessage("paid", "details")).toBe("Paid and void invoices cannot be edited.");
    expect(getInvoiceEditLockMessage("void", "financial")).toBe("Paid and void invoices cannot be edited.");
  });

  test("receivable fields remain editable through normal sent and billed states", () => {
    expect(getInvoiceEditLockMessage("billed", "receivable")).toBe("");
    expect(getInvoiceEditLockMessage("finalized", "receivable")).toBe("");
    expect(getInvoiceEditLockMessage("sent", "receivable")).toBe("");
    expect(getInvoiceEditLockMessage("partially_paid", "receivable")).toBe("");
    expect(getInvoiceEditLockMessage("void", "receivable")).toBe("Paid and void invoices cannot be edited.");
  });
});

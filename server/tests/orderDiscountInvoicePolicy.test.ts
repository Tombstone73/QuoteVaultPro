import { describe, expect, test } from "@jest/globals";
import { orderDiscountInvoiceBlocker } from "../services/orders/orderDiscountInvoicePolicy";

describe("saved Order discount Invoice checkpoint policy", () => {
  test("allows one native unpaid Invoice, including one needing QuickBooks resync", () => {
    expect(orderDiscountInvoiceBlocker({ liveInvoiceCount: 1, invoice: { status: "billed" } })).toBeNull();
    expect(orderDiscountInvoiceBlocker({ liveInvoiceCount: 1, invoice: { status: "billed", importSource: null } })).toBeNull();
  });

  test.each([
    [{ liveInvoiceCount: 0 }, "no single live native Invoice"],
    [{ liveInvoiceCount: 2 }, "multiple live Invoices"],
    [{ liveInvoiceCount: 1, invoice: { importSource: "quickbooks" } }, "imported or historical"],
    [{ liveInvoiceCount: 1, invoice: { historicalArState: "open" } }, "imported or historical"],
    [{ liveInvoiceCount: 1, invoice: { status: "paid" } }, "paid checkpoint"],
    [{ liveInvoiceCount: 1, invoice: { status: "billed", amountPaid: "1.00" } }, "payment history"],
    [{ liveInvoiceCount: 1, invoice: { status: "void" } }, "no longer editable"],
    [{ liveInvoiceCount: 1, hasAppliedPayment: true }, "payment history"],
    [{ liveInvoiceCount: 1, hasCreditHistory: true }, "credit history"],
    [{ liveInvoiceCount: 1, hasRefundHistory: true }, "refund history"],
    [{ liveInvoiceCount: 1, lineSnapshotsChanged: true }, "line items differ"],
  ] as const)("blocks incompatible billing evidence: %p", (input, phrase) => {
    expect(orderDiscountInvoiceBlocker(input)).toContain(phrase);
  });
});

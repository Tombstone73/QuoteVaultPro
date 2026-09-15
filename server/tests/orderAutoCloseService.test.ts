import { describe, expect, test } from "@jest/globals";
import { assessOrderAutoClose } from "../services/orderAutoClosePolicy";

const physicalLine = [{ workflowIntent: "standard_production", status: "active" }];
const paidInvoice = { status: "paid", balanceDue: "0" };
const unpaidInvoice = { status: "sent", balanceDue: "25.00" };

function assess(input: Partial<Parameters<typeof assessOrderAutoClose>[0]> = {}) {
  return assessOrderAutoClose({
    state: "production_complete",
    fulfillmentStatus: "delivered",
    routingTarget: "fulfillment",
    lineItems: physicalLine,
    invoices: [paidInvoice],
    ...input,
  });
}

describe("order auto-close policy adapter", () => {
  test("closes only when terminal fulfillment and every applicable invoice is settled", () => {
    expect(assess()).toMatchObject({ action: "closed", unpaidInvoiceCount: 0, eligibility: { requiresUnpaidConfirmation: false } });
  });

  test("keeps the Order open when fulfillment completes before a final payment", () => {
    expect(assess({ invoices: [paidInvoice, unpaidInvoice] })).toMatchObject({
      action: "not_eligible", reason: "UNPAID_INVOICES", unpaidInvoiceCount: 1,
    });
  });

  test("keeps the Order open when payment completes before terminal fulfillment", () => {
    expect(assess({ fulfillmentStatus: "packed", routingTarget: "fulfillment" })).toMatchObject({
      action: "not_eligible", reason: "OPERATIONAL_COMPLETION_REQUIRED",
    });
  });

  test("waits for a final additional invoice before closing", () => {
    expect(assess({ invoices: [paidInvoice, unpaidInvoice] }).action).toBe("not_eligible");
    expect(assess({ invoices: [paidInvoice, { status: "paid", balanceDue: "0" }] }).action).toBe("closed");
  });

  test("does not close without an applicable invoice, and ignores void invoices", () => {
    expect(assess({ invoices: [] })).toMatchObject({ action: "not_eligible", reason: "INVOICE_REQUIRED" });
    expect(assess({ invoices: [{ status: "void", balanceDue: "0" }] })).toMatchObject({ action: "not_eligible", reason: "INVOICE_REQUIRED" });
  });

  test("does not bypass production completion or an unpaid confirmation", () => {
    expect(assess({ state: "open" })).toMatchObject({ action: "not_eligible", reason: "PRODUCTION_COMPLETION_REQUIRED" });
    expect(assess({ invoices: [unpaidInvoice] })).toMatchObject({ action: "not_eligible", reason: "UNPAID_INVOICES" });
  });

  test("is idempotent for already closed and canceled Orders", () => {
    expect(assess({ state: "closed" })).toEqual({ action: "no_op", reason: "ORDER_CLOSED" });
    expect(assess({ state: "canceled" })).toEqual({ action: "no_op", reason: "ORDER_CANCELED" });
  });
});

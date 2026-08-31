import { describe, expect, test } from "@jest/globals";
import { deriveOrderInvoiceState } from "../orderInvoiceState";

describe("order invoice state", () => {
  test("distinguishes not invoiced from ready to invoice", () => {
    expect(deriveOrderInvoiceState({ billingStatus: "not_ready", invoices: [] }).key).toBe("not_invoiced");
    expect(deriveOrderInvoiceState({ billingStatus: "ready", invoices: [] }).key).toBe("ready_to_invoice");
  });

  test("reports draft, sent, partial, paid, and overdue states", () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    expect(deriveOrderInvoiceState({ invoices: [{ status: "draft", total: 25, balanceDue: 25 }], now }).key).toBe("invoice_draft");
    expect(deriveOrderInvoiceState({ invoices: [{ status: "sent", total: 25, balanceDue: 25 }], now }).key).toBe("invoice_sent");
    expect(deriveOrderInvoiceState({ invoices: [{ status: "partially_paid", total: 25, amountPaid: 10, balanceDue: 15 }], now }).key).toBe("partially_paid");
    expect(deriveOrderInvoiceState({ invoices: [{ status: "paid", total: 25, balanceDue: 0 }], now }).key).toBe("paid");
    expect(deriveOrderInvoiceState({ invoices: [{ status: "credit", total: 25, amountPaid: 30, balanceDue: 0 }], now }).key).toBe("credit");
    expect(deriveOrderInvoiceState({ invoices: [{ status: "sent", dueDate: "2026-07-18T12:00:00.000Z", balanceDue: 25 }], now }).key).toBe("overdue");
  });

  test("does not mistake an empty draft invoice for a paid invoice", () => {
    expect(deriveOrderInvoiceState({ invoices: [{ status: "draft", total: null, balanceDue: null }] }).key)
      .toBe("invoice_draft");
  });
});

import { describe, expect, test } from "@jest/globals";
import { assessOrderOperationalCompletion } from "../services/orderCompletionPolicy";

describe("order operational completion policy", () => {
  test("allows an invoice-only service order and routes it to invoicing", () => {
    expect(assessOrderOperationalCompletion({
      state: "open",
      lineItems: [{ workflowIntent: "service_fee", status: "new" }],
      invoices: [],
    })).toMatchObject({ ok: true, serviceFeeOnly: true, needsInvoicing: true, activeInvoiceCount: 0 });
  });

  test("requires production completion for production and mixed orders", () => {
    expect(assessOrderOperationalCompletion({
      state: "open",
      lineItems: [{ workflowIntent: "standard_production", status: "complete" }],
      invoices: [],
    })).toMatchObject({ ok: false, code: "PRODUCTION_COMPLETION_REQUIRED" });
  });

  test("does not let a production order skip fulfillment", () => {
    expect(assessOrderOperationalCompletion({
      state: "production_complete",
      fulfillmentStatus: "pending",
      lineItems: [{ workflowIntent: "standard_production", status: "complete" }],
      invoices: [],
    })).toMatchObject({ ok: false, code: "FULFILLMENT_COMPLETION_REQUIRED" });
  });

  test("does not request another invoice when a non-void invoice already exists", () => {
    expect(assessOrderOperationalCompletion({
      state: "production_complete",
      fulfillmentStatus: "shipped",
      lineItems: [{ workflowIntent: "standard_production", status: "complete" }],
      invoices: [{ status: "sent", balanceDue: 25 }],
    })).toMatchObject({ ok: true, needsInvoicing: false, activeInvoiceCount: 1, allInvoicesPaid: false });
  });

  test("recognizes paid orders as financially complete without closing them", () => {
    expect(assessOrderOperationalCompletion({
      state: "production_complete",
      fulfillmentStatus: "delivered",
      lineItems: [{ workflowIntent: "standard_production", status: "complete" }],
      invoices: [{ status: "paid", balanceDue: 0 }],
    })).toMatchObject({ ok: true, needsInvoicing: false, allInvoicesPaid: true });
  });
});

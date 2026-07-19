import { describe, expect, test } from "@jest/globals";
import { assessOrderCloseEligibility } from "../services/orderCloseEligibility";

describe("order close eligibility", () => {
  test("requires an invoiced service-fee-only order to be operationally complete before closing", () => {
    expect(assessOrderCloseEligibility({
      state: "open",
      lineItems: [{ workflowIntent: "service_fee", status: "new" }],
      invoiceCount: 1,
      unpaidInvoiceCount: 1,
    })).toMatchObject({ ok: false, code: "PRODUCTION_COMPLETION_REQUIRED" });

    expect(assessOrderCloseEligibility({
      state: "production_complete",
      routingTarget: null,
      lineItems: [{ workflowIntent: "service_fee", status: "new" }],
      invoiceCount: 1,
      unpaidInvoiceCount: 1,
    })).toEqual({ ok: true, requiresUnpaidConfirmation: true, serviceFeeOnly: true });
  });

  test("keeps a mixed order behind the production-completion gate", () => {
    expect(assessOrderCloseEligibility({
      state: "open",
      lineItems: [{ workflowIntent: "service_fee" }, { workflowIntent: "standard_production" }],
      invoiceCount: 1,
      unpaidInvoiceCount: 0,
    })).toMatchObject({ ok: false, code: "PRODUCTION_COMPLETION_REQUIRED" });
  });

  test("does not close a production-complete order that is still routed to fulfillment", () => {
    expect(assessOrderCloseEligibility({
      state: "production_complete",
      routingTarget: "fulfillment",
      lineItems: [{ workflowIntent: "standard_production" }],
      invoiceCount: 1,
      unpaidInvoiceCount: 0,
    })).toMatchObject({ ok: false, code: "OPERATIONAL_COMPLETION_REQUIRED" });
  });

  test("requires an invoice for a fee-only order", () => {
    expect(assessOrderCloseEligibility({
      state: "production_complete",
      lineItems: [{ workflowIntent: "service_fee" }],
      invoiceCount: 0,
      unpaidInvoiceCount: 0,
    })).toMatchObject({ ok: false, code: "INVOICE_REQUIRED" });
  });
});

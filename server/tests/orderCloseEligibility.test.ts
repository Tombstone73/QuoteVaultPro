import { describe, expect, test } from "@jest/globals";
import { assessOrderCloseEligibility } from "../services/orderCloseEligibility";

describe("order close eligibility", () => {
  test("allows an invoiced service-fee-only order to close without production", () => {
    expect(assessOrderCloseEligibility({
      state: "open",
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

  test("requires an invoice for a fee-only order", () => {
    expect(assessOrderCloseEligibility({
      state: "open",
      lineItems: [{ workflowIntent: "service_fee" }],
      invoiceCount: 0,
      unpaidInvoiceCount: 0,
    })).toMatchObject({ ok: false, code: "INVOICE_REQUIRED" });
  });
});

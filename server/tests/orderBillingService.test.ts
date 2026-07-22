import { describe, expect, test } from "@jest/globals";
import { isLineItemReadyForBilling, resolveInvoiceFinancialEligibility } from "../services/orderBillingService";

describe("order billing readiness", () => {
  test("a priced service/fee line is ready without production completion", () => {
    expect(isLineItemReadyForBilling({
      workflowIntent: "service_fee",
      status: "new",
      totalPrice: "25.00",
      allowZeroPrice: false,
    })).toBe(true);
  });

  test("an unconfigured service/fee price is not invoiceable unless zero pricing is explicit", () => {
    expect(isLineItemReadyForBilling({
      workflowIntent: "service_fee",
      status: "new",
      totalPrice: "0.00",
      allowZeroPrice: false,
    })).toBe(false);
    expect(isLineItemReadyForBilling({
      workflowIntent: "service_fee",
      status: "new",
      totalPrice: "0.00",
      allowZeroPrice: true,
    })).toBe(true);
  });

  test("production and quantity-only lines are billable before production is complete", () => {
    expect(isLineItemReadyForBilling({ workflowIntent: "standard_production", status: "ready_for_production", totalPrice: "25.00" })).toBe(true);
    expect(isLineItemReadyForBilling({ workflowIntent: "standard_production", status: "done", totalPrice: "25.00" })).toBe(true);
    expect(isLineItemReadyForBilling({ workflowIntent: "quantity_only", status: "new", totalPrice: "25.00" })).toBe(true);
    expect(isLineItemReadyForBilling({ workflowIntent: "standard_production", status: "ready_for_pickup", totalPrice: "25.00" })).toBe(true);
    expect(isLineItemReadyForBilling({ workflowIntent: "standard_production", status: "shipped", totalPrice: "25.00" })).toBe(true);
  });

  test("only financial line conditions block invoice creation", () => {
    expect(resolveInvoiceFinancialEligibility([
      { workflowIntent: "standard_production", totalPrice: "25.00" },
      { workflowIntent: "quantity_only", totalPrice: "10.00" },
    ])).toEqual({ canCreateInvoice: true });
    expect(resolveInvoiceFinancialEligibility([]).code).toBe("ORDER_HAS_NO_BILLABLE_LINES");
    expect(resolveInvoiceFinancialEligibility([
      { workflowIntent: "service_fee", totalPrice: "0.00", allowZeroPrice: false },
    ]).code).toBe("UNPRICED_SERVICE_FEE");
  });
});

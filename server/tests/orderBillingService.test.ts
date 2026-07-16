import { describe, expect, test } from "@jest/globals";
import { isLineItemReadyForBilling } from "../services/orderBillingService";

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

  test("production lines retain their existing completion gate", () => {
    expect(isLineItemReadyForBilling({ workflowIntent: "standard_production", status: "ready_for_production", totalPrice: "25.00" })).toBe(false);
    expect(isLineItemReadyForBilling({ workflowIntent: "standard_production", status: "done", totalPrice: "25.00" })).toBe(true);
  });
});

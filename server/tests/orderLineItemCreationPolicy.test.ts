import { describe, expect, it } from "@jest/globals";
import { shouldAutoScheduleCreatedOrderLineItem } from "../services/orderLineItemCreationPolicy";

describe("order line item creation policy", () => {
  it("does not create production work while duplicating a line item", () => {
    expect(shouldAutoScheduleCreatedOrderLineItem({
      duplicateSourceLineItemId: "11111111-1111-4111-8111-111111111111",
      isServiceFee: false,
      sendToProductionDefault: true,
      workflowState: "ready_for_production",
    })).toBe(false);
  });

  it("preserves normal create auto-scheduling", () => {
    expect(shouldAutoScheduleCreatedOrderLineItem({
      isServiceFee: false,
      sendToProductionDefault: true,
      workflowState: "ready_for_production",
    })).toBe(true);
  });
});

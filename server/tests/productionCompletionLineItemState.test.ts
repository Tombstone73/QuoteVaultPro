import { describe, expect, test } from "@jest/globals";
import { resolveProductionCompletionLineItemState } from "../services/productionCompletionLineItemState";

describe("production completion line-item state", () => {
  test("marks a line item completed when its production route reaches fulfillment", () => {
    expect(resolveProductionCompletionLineItemState("fulfillment")).toEqual({
      workflowState: "completed",
      status: "complete",
    });
  });

  test("does not complete a line item while it is routed to another production station", () => {
    expect(resolveProductionCompletionLineItemState("finishing")).toBeNull();
  });
});

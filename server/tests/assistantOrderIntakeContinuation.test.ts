import { describe, expect, it } from "@jest/globals";
import { pendingOrderIntakeRequest } from "../services/assistant/orderIntakeContinuation";
import { directOrderRequestText, parseOrderQuantity } from "../services/assistant/orderIntakeParsing";

describe("order intake continuation", () => {
  it("reuses only the request immediately preceding an order missing-information response", () => {
    expect(pendingOrderIntakeRequest([
      { role: "user", content: "Create an order for Acme" },
      { role: "assistant", content: "I need Product", provider: "local_order_intake", structuredCards: [{ kind: "missing_information", title: "Order information needed" }] },
    ])).toBe("Create an order for Acme");
  });

  it("fails closed for another provider, another card, or no prior user request", () => {
    expect(pendingOrderIntakeRequest([
      { role: "user", content: "Create an order for Acme" },
      { role: "assistant", content: "I need Product", provider: "local_crm_intake", structuredCards: [{ kind: "missing_information", title: "Order information needed" }] },
    ])).toBeNull();
    expect(pendingOrderIntakeRequest([
      { role: "user", content: "Create an order for Acme" },
      { role: "assistant", content: "I need Product", provider: "local_order_intake", structuredCards: [{ kind: "missing_information", title: "Customer information needed" }] },
    ])).toBeNull();
  });

  it("adds a follow-up only to the immediately pending direct-order request", () => {
    expect(directOrderRequestText(
      "Use ACM Tester at 12in x 12in, 1 qty.",
      "Create an order for DEV Customer",
    )).toBe("Create an order for DEV Customer\nUse ACM Tester at 12in x 12in, 1 qty.");
    expect(directOrderRequestText("Create an order for Another Customer", "Create an order for DEV Customer"))
      .toBe("Create an order for Another Customer");
    expect(directOrderRequestText("Use ACM Tester at 12in x 12in, 1 qty.", null)).toBeNull();
  });

  it("recognizes both explicit quantity forms without accepting zero", () => {
    expect(parseOrderQuantity("1 qty")).toBe(1);
    expect(parseOrderQuantity("quantity 1")).toBe(1);
    expect(parseOrderQuantity("quantity 0")).toBeNull();
  });
});

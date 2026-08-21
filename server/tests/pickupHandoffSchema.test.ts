import { describe, expect, test } from "@jest/globals";
import { pickupHandoffSchema } from "../services/fulfillment/schemas";

describe("pickup handoff request schema", () => {
  test("accepts two 200-quantity line items and the idempotency client request id", () => {
    expect(pickupHandoffSchema.parse({
      items: [
        { orderLineItemId: "coroplast-line", quantity: 200 },
        { orderLineItemId: "stake-line", quantity: 200 },
      ],
      clientRequestId: "request-20152",
    })).toMatchObject({
      items: [
        { orderLineItemId: "coroplast-line", quantity: 200 },
        { orderLineItemId: "stake-line", quantity: 200 },
      ],
      clientRequestId: "request-20152",
    });
  });

  test("accepts partial pickup quantities and rejects zero or negative quantities", () => {
    expect(pickupHandoffSchema.parse({ items: [{ orderLineItemId: "coroplast-line", quantity: 75 }] }))
      .toMatchObject({ items: [{ orderLineItemId: "coroplast-line", quantity: 75 }] });
    for (const quantity of [0, -1]) {
      expect(() => pickupHandoffSchema.parse({ items: [{ orderLineItemId: "coroplast-line", quantity }] })).toThrow();
    }
  });
});

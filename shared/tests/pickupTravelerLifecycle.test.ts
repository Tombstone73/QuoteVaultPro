import { describe, expect, test } from "@jest/globals";
import { buildPickupTravelerProgressSnapshot, pickupReversalHistory, pickupTravelerBoxSchema, pickupTravelerContext } from "../pickupTravelerProgress";
import { resolveFulfillmentLineQuantity } from "../fulfillmentReadiness";
import { netTerminalFulfillmentQuantity, terminalReversalQuantitiesByLine } from "../fulfillmentTerminalReversal";

describe("manual package labels", () => {
  test.each([{}, { currentBox: "", totalBoxes: "" }, { currentBox: " ", totalBoxes: null }])("omits blank pair %j", input => {
    expect(pickupTravelerBoxSchema.parse(input)).toBeNull();
  });
  test.each([[1, 1], [1, 3], [2, 3], [3, 3]])("accepts %s of %s", (currentBox, totalBoxes) => {
    expect(pickupTravelerBoxSchema.parse({ currentBox, totalBoxes })).toEqual({ current: currentBox, total: totalBoxes });
  });
  test.each([[1, ""], ["", 3], [0, 3], [4, 3], [1, 0], ["abc", 3], [1.5, 3], [-1, 3], [true, 3]])("rejects %j of %j", (currentBox, totalBoxes) => {
    expect(pickupTravelerBoxSchema.safeParse({ currentBox, totalBoxes }).success).toBe(false);
  });
  test("context round trip preserves the exact optional label and quantity snapshot", () => {
    const context = { fulfillmentMode: "pickup", boxCount: 1, box: { current: 2, total: 3 },
      lineQuantities: [{ orderLineItemId: "signs", quantity: 150 }],
      progressSnapshot: buildPickupTravelerProgressSnapshot([{ id: "signs", production: resolveFulfillmentLineQuantity({ orderedQuantity: 500, pickedUpQuantity: 250 }) }], [{ orderLineItemId: "signs", quantity: 150 }], "2026-09-25T12:00:00Z") };
    expect(pickupTravelerContext(JSON.parse(JSON.stringify(context)))).toEqual(context);
    expect(pickupTravelerContext({ ...context, box: null })?.box).toBeNull();
    expect(pickupTravelerContext({ ...context, box: { current: 4, total: 3 } })).toBeNull();
  });
});

describe("canonical pickup reversal presentation", () => {
  const items = [{ orderLineItemId: "signs", quantity: 150 }];
  const reversal = (quantity: number, sourceId = "pickup-2") => ({ id: "reversal", eventType: "PICKUP_HANDOFF_REVERSED", createdAt: "2026-09-25T13:00:00Z",
    actorUserId: "staff", actorFirstName: "Dale", actorLastName: null, payloadJson: { sourceId, reason: "Recorded in error", items: [{ orderLineItemId: "signs", quantity }] } });
  test("history retains original event, status, time, staff and reason without guessing other-event reversals", () => {
    const history = pickupReversalHistory("pickup-2", items, [reversal(150), reversal(250, "pickup-1")]);
    expect(history).toMatchObject({ status: "REVERSED", remainingByLine: { signs: 0 },
      reversals: [{ createdAt: "2026-09-25T13:00:00.000Z", actorName: "Dale", actorUserId: "staff", reason: "Recorded in error" }] });
    expect(items[0].quantity).toBe(150);
    expect(pickupReversalHistory("other", items, [reversal(150)]).status).toBe("COMPLETED");
    expect(pickupReversalHistory("pickup-2", items, [reversal(50)]).status).toBe("PARTIALLY_REVERSED");
  });
  test("250 + 150 completed, reverse second: current total is 250 and remaining 250; new preparation uses that obligation", () => {
    const events = [reversal(150)];
    const reversed = terminalReversalQuantitiesByLine(events, ["signs"]).pickup.get("signs")!;
    const current = resolveFulfillmentLineQuantity({ orderedQuantity: 500, pickedUpQuantity: netTerminalFulfillmentQuantity(400, reversed) });
    expect(current).toMatchObject({ pickedUpQuantity: 250, remainingQuantity: 250 });
    const next = buildPickupTravelerProgressSnapshot([{ id: "signs", production: current }], items, "2026-09-25T14:00:00Z");
    expect(next.lines[0]).toMatchObject({ previouslyPickedUpQuantity: 250, afterPickupQuantity: 400, remainingAfterPickupQuantity: 100 });
  });
  test("full first pickup reversal returns 0/500 and never invents missing metadata", () => {
    const history = pickupReversalHistory("pickup-1", [{ orderLineItemId: "signs", quantity: 250 }], [{ id: "r", eventType: "PICKUP_HANDOFF_REVERSED", payloadJson: { sourceId: "pickup-1", items: [{ orderLineItemId: "signs", quantity: 250 }] } }]);
    expect(history.reversals[0]).toEqual({ id: "r", createdAt: null, actorName: null, actorUserId: null, reason: null });
    expect(resolveFulfillmentLineQuantity({ orderedQuantity: 500, pickedUpQuantity: history.remainingByLine.signs })).toMatchObject({ pickedUpQuantity: 0, remainingQuantity: 500 });
  });
});

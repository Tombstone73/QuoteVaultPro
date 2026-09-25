import { describe, expect, test } from "@jest/globals";
import { resolveFulfillmentLineQuantity } from "../fulfillmentReadiness";
import { netTerminalFulfillmentQuantity } from "../fulfillmentTerminalReversal";
import { buildPickupTravelerProgressSnapshot, pickupTravelerContext } from "../pickupTravelerProgress";

const preparedAt = "2026-09-25T12:00:00.000Z";
const canonical = (orderedQuantity: number, pickedUpQuantity = 0, extra = {}) => ({
  id: "signs", production: resolveFulfillmentLineQuantity({ orderedQuantity, pickedUpQuantity, ...extra }),
});
const request = (quantity: number) => [{ orderLineItemId: "signs", quantity }];

describe("Pickup Traveler canonical preparation snapshot", () => {
  test.each([
    ["full", 250, 0, 250, 250, 0],
    ["first partial", 500, 0, 250, 250, 250],
    ["second partial", 500, 250, 150, 400, 100],
    ["final", 500, 400, 100, 500, 0],
    ["corrected obligation", 450, 250, 150, 400, 50],
  ])("%s pickup uses current canonical obligation", (_, ordered, previous, current, after, remaining) => {
    const result = buildPickupTravelerProgressSnapshot([canonical(ordered, previous)], request(current), preparedAt);
    expect(result.lines[0]).toEqual({ orderLineItemId: "signs", orderedQuantity: ordered,
      previouslyPickedUpQuantity: previous, thisPickupQuantity: current, afterPickupQuantity: after,
      remainingAfterPickupQuantity: remaining, otherResolvedQuantity: 0 });
  });

  test("independent child lines do not use order-wide totals or replacement production counts", () => {
    const lines = [canonical(500, 150, { lineItemRole: "child", productionCompleteQuantity: 750 }),
      { ...canonical(50, 0, { lineItemRole: "child" }), id: "stakes" }];
    const snapshot = buildPickupTravelerProgressSnapshot(lines,
      [...request(250), { orderLineItemId: "stakes", quantity: 50 }], preparedAt);
    expect(snapshot.lines.map(l => [l.orderedQuantity, l.afterPickupQuantity, l.remainingAfterPickupQuantity]))
      .toEqual([[500, 400, 100], [50, 50, 0]]);
  });

  test.each([{ workflowState: "canceled" }, { lifecycleStatus: "cancelled" },
    { workflowIntent: "service_fee" }, { lineItemRole: "parent" }])("does not print excluded obligations %j", extra => {
    const line = canonical(500, 0, extra);
    expect(line.production.requiresFulfillment).toBe(false);
    expect(() => buildPickupTravelerProgressSnapshot([line], request(1), preparedAt)).toThrow();
  });

  test("shipped and administratively resolved quantities reduce remaining without becoming picked up", () => {
    const snapshot = buildPickupTravelerProgressSnapshot([canonical(500, 100,
      { shippedQuantity: 50, administrativelyReconciledQuantity: 150 })], request(100), preparedAt);
    expect(snapshot.lines[0]).toMatchObject({ afterPickupQuantity: 200, remainingAfterPickupQuantity: 100, otherResolvedQuantity: 200 });
  });

  test("a delayed render/reprint never adds this pickup to the now-completed live aggregate", () => {
    const line = canonical(500, 250);
    const context = { fulfillmentMode: "pickup" as const, boxCount: 3, lineQuantities: request(150),
      progressSnapshot: buildPickupTravelerProgressSnapshot([line], request(150), preparedAt) };
    // Complete Pickup happens independently between queue and first render.
    line.production = canonical(500, 400).production;
    const first = pickupTravelerContext(JSON.parse(JSON.stringify(context)))!;
    const reprint = pickupTravelerContext(JSON.parse(JSON.stringify(context)))!;
    expect(first.progressSnapshot!.lines[0]).toMatchObject({ previouslyPickedUpQuantity: 250,
      thisPickupQuantity: 150, afterPickupQuantity: 400, remainingAfterPickupQuantity: 100 });
    expect(reprint).toEqual(first);
    expect(line.production.pickedUpQuantity).toBe(400);
    expect(first.boxCount).toBe(3);
  });

  test("completed lines and requests beyond remaining cannot prepare another pickup", () => {
    expect(canonical(500, 500).production.remainingQuantity).toBe(0);
    expect(() => buildPickupTravelerProgressSnapshot([canonical(500, 500)], request(1), preparedAt)).toThrow();
    expect(() => buildPickupTravelerProgressSnapshot([canonical(500, 400)], request(101), preparedAt)).toThrow();
  });

  test("canonical pickup corrections use net completed evidence", () => {
    const netPickedUp = netTerminalFulfillmentQuantity(300, 50);
    const snapshot = buildPickupTravelerProgressSnapshot([canonical(500, netPickedUp)], request(150), preparedAt);
    expect(snapshot.lines[0]).toMatchObject({ previouslyPickedUpQuantity: 250,
      afterPickupQuantity: 400, remainingAfterPickupQuantity: 100 });
  });

  test("legacy jobs have no fabricated progress; corrupt or double-counted snapshots fail closed", () => {
    const legacy = { fulfillmentMode: "pickup" as const, boxCount: 1, lineQuantities: request(150) };
    expect(pickupTravelerContext(legacy)).toEqual(legacy);
    const valid = { ...legacy, progressSnapshot: buildPickupTravelerProgressSnapshot([canonical(500, 250)], request(150), preparedAt) };
    expect(pickupTravelerContext(valid)).toEqual(valid);
    const corrupt = structuredClone(valid);
    corrupt.progressSnapshot.lines[0].afterPickupQuantity = 550;
    expect(pickupTravelerContext(corrupt)).toBeNull();
    expect(pickupTravelerContext({ ...valid, lineQuantities: request(200) })).toBeNull();
    expect(pickupTravelerContext({ ...legacy, lineQuantities: [...request(150), ...request(150)] })).toBeNull();
  });
});

import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { buildPickupTravelerProgressSnapshot, pickupTravelerContext } from "../../shared/pickupTravelerProgress";
import { buildOrderTravelerData, DEFAULT_TICKET_TEMPLATE } from "../../shared/productionTicket";

const select = jest.fn();
const write = jest.fn(() => { throw new Error("Rendering must never write state"); });
jest.unstable_mockModule("../db", () => ({ db: { select, insert: write, update: write, delete: write } }));
jest.unstable_mockModule("../routes/flatStockNesting.shared", () => ({
  collectLineItemProductionMaterialIds: () => [], resolveLineItemMaterialDisplayLabel: () => "Coroplast - 4mm",
}));
const { getOrderTravelerSource } = await import("../services/orderTravelerSourceService");

beforeEach(() => { select.mockReset(); write.mockClear(); });
function readChain(result: unknown[]) {
  const chain: any = { then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
  for (const method of ["from", "leftJoin", "where", "limit", "orderBy"]) chain[method] = () => chain;
  return chain;
}

describe("claimed Pickup Traveler source", () => {
  test("repeated reads preserve queued progress after completion/correction and never write operational or financial data", async () => {
    const lineQuantities = [{ orderLineItemId: "signs", quantity: 150 }];
    const context = pickupTravelerContext({ fulfillmentMode: "pickup", boxCount: 2, lineQuantities,
      progressSnapshot: buildPickupTravelerProgressSnapshot([{ id: "signs", production: {
        orderedQuantity: 500, pickedUpQuantity: 250, remainingQuantity: 250,
      } }], lineQuantities, "2026-09-25T12:00:00Z") })!;
    // Only order/line metadata is re-read. A later completed aggregate is not
    // consulted or incremented; a later quantity edit cannot rewrite this document.
    const orderRows = [{ id: "order-20538", orderNumber: "20538", customerName: "Fixture customer" }];
    const lineRows = [{ id: "signs", description: "Coroplast", quantity: 600, width: "24.00", height: "20.00" },
      { id: "unselected", quantity: 99 }];
    select.mockImplementation(() => readChain(select.mock.calls.length % 2 ? orderRows : lineRows));
    const before = JSON.stringify(context);
    const first = await getOrderTravelerSource("org", "order-20538", context);
    const reprint = await getOrderTravelerSource("org", "order-20538", context);
    expect(reprint).toEqual(first);
    expect(first!.lineItems).toHaveLength(1);
    expect(first!.lineItems[0]).toMatchObject({ quantity: 150, pickupProgress: {
      orderedQuantity: 500, afterPickupQuantity: 400, remainingAfterPickupQuantity: 100,
    } });
    expect(buildOrderTravelerData(first!, DEFAULT_TICKET_TEMPLATE).lineItems[0].pickupProgress)
      .toEqual(context.progressSnapshot!.lines[0]);
    expect(JSON.stringify(context)).toBe(before);
    expect(select).toHaveBeenCalledTimes(4);
    expect(write).not.toHaveBeenCalled();
  });
});

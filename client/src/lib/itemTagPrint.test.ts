import { itemTagPrintUrl, parseItemTagRequest, validTagQuantity } from "./itemTagPrint";

describe("item tag print-only scope", () => {
  test("whole order retains the existing Traveler route", () => {
    expect(itemTagPrintUrl({ orderId: "order-1", lineItemId: "line-1", scope: "order", orderedQuantity: 0, includeThumbnails: false })).toBe("/orders/order-1/traveler");
  });

  test("one selected line and 5 of 15 preserve line identity without completion semantics", () => {
    const url = itemTagPrintUrl({ orderId: "order-1", lineItemId: "line-2", scope: "partial", orderedQuantity: 15, quantity: 5, includeThumbnails: true });
    const parsed = new URL(url!, "https://dev.printershero.com");
    expect(parsed.pathname).toBe("/orders/order-1/traveler");
    expect(parseItemTagRequest(parsed.searchParams)).toEqual({ lineItemId: "line-2", quantity: 5, includeThumbnails: true });
    expect(parsed.search).not.toMatch(/completion|fulfilled|shipped|pickedUp/);
  });

  test.each([0, -1, 1.5, 16, NaN, Infinity])("rejects invalid partial quantity %s", quantity => {
    expect(validTagQuantity(quantity, 15)).toBe(false);
    expect(itemTagPrintUrl({ orderId: "order-1", lineItemId: "line-1", scope: "partial", orderedQuantity: 15, quantity, includeThumbnails: false })).toBeNull();
  });

  test("selected line defaults to all ordered units and no thumbnail requests", () => {
    const url = itemTagPrintUrl({ orderId: "order-1", lineItemId: "line-1", scope: "line", orderedQuantity: 15, includeThumbnails: false });
    expect(url).toBe("/orders/order-1/traveler?lineItemId=line-1");
  });
});

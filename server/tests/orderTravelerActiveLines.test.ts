import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { buildOrderTravelerData } from "../../shared/productionTicket";

const select = jest.fn();
const write = jest.fn(() => { throw new Error("A traveler read must not mutate records"); });
const collectMaterialIds = jest.fn(() => []);
jest.unstable_mockModule("../db", () => ({ db: { select, insert: write, update: write, delete: write } }));
jest.unstable_mockModule("../routes/flatStockNesting.shared", () => ({
  collectLineItemProductionMaterialIds: collectMaterialIds,
  resolveLineItemMaterialDisplayLabel: () => "Synthetic material",
  buildPrepressOptionRows: () => [],
}));
const { getOrderTravelerSource } = await import("../services/orderTravelerSourceService");

function readChain(rows: unknown[]) {
  const chain: any = { then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve) };
  for (const method of ["from", "leftJoin", "where", "limit", "orderBy"]) chain[method] = () => chain;
  return chain;
}

const order = { id: "order-20937-synthetic", orderNumber: "20937-SYNTHETIC", customerName: "Synthetic customer", jobLabel: "Edited job" };
const line = (id: string, status: string, description = id) => ({ id, status, description, quantity: 3, width: "24", height: "12", createdAt: new Date(), sortOrder: 1 });

beforeEach(() => { select.mockReset(); write.mockClear(); collectMaterialIds.mockClear(); });

function fixture(lines: ReturnType<typeof line>[]) {
  const rows = [[order], lines];
  select.mockImplementation(() => readChain(rows[select.mock.calls.length - 1] ?? []));
}

describe("current Order traveler line eligibility", () => {
  test("retains three active saved Order lines and their current identity, descriptions, and quantities", async () => {
    fixture([line("one", "new", "Current first"), line("two", "in_production"), line("three", "complete")]);
    const source = await getOrderTravelerSource("tenant-one", order.id);
    expect(source).toMatchObject({ orderId: order.id, orderNumber: order.orderNumber, jobLabel: order.jobLabel });
    expect(source?.lineItems.map(({ orderLineItemId, quantity, description }) => ({ orderLineItemId, quantity, description }))).toEqual([
      { orderLineItemId: "one", quantity: 3, description: "Current first" },
      { orderLineItemId: "two", quantity: 3, description: "two" },
      { orderLineItemId: "three", quantity: 3, description: "three" },
    ]);
    expect(write).not.toHaveBeenCalled();
  });

  test("excludes retained historical cancellations and voids before current traveler rendering", async () => {
    fixture([line("retained", "new", "Only current line"), line("correctively-removed", "canceled"), line("historical-void", "VOIDED")]);
    const source = await getOrderTravelerSource("tenant-one", order.id);
    expect(source?.lineItems.map((item) => item.orderLineItemId)).toEqual(["retained"]);
    expect(buildOrderTravelerData(source!).lineItems.map((item) => item.description)).toEqual(["Only current line"]);
    // Item tags select by ID from this same source; removed IDs are unavailable.
    expect(source?.lineItems.find((item) => item.orderLineItemId === "correctively-removed")).toBeUndefined();
    expect(collectMaterialIds).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
  });

  test("a converted and edited Order uses saved current lines, not deleted Quote-era lines", async () => {
    // Physical deletion leaves no row; historical cancellation leaves one canceled row.
    fixture([line("remaining-order-line", "new", "Edited description"), line("original-quote-line", "cancelled")]);
    const source = await getOrderTravelerSource("tenant-one", order.id);
    expect(source?.lineItems).toMatchObject([{ orderLineItemId: "remaining-order-line", description: "Edited description" }]);
    expect(source?.lineItems).toHaveLength(1);
  });

  test("an Order with no active lines cannot produce current production instructions", async () => {
    fixture([line("historical", "canceled"), line("void", "void")]);
    expect(await getOrderTravelerSource("tenant-one", order.id)).toBeNull();
    expect(write).not.toHaveBeenCalled();
  });
});

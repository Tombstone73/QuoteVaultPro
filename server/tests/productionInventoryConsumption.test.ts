import { describe, expect, jest, test } from "@jest/globals";
import { consumeReservedMaterialsForLineItem } from "../routes/production.shared";

function createConsumptionTx() {
  const inserts: any[] = [];
  let selectCount = 0;

  const tx: any = {
    inserts,
    select: jest.fn(() => {
      selectCount += 1;
      const rows = selectCount === 1
        ? [{
          sourceKey: "mat-1",
          uom: "sqft",
          qty: "12.5",
          materialType: "roll",
          materialUnitOfMeasure: "sqft",
          materialInventoryUnit: null,
        }]
        : [];

      const chain: any = {
        from: jest.fn(() => chain),
        leftJoin: jest.fn(() => chain),
        where: jest.fn(() => (selectCount === 1 ? Promise.resolve(rows) : chain)),
        orderBy: jest.fn(() => chain),
        limit: jest.fn(() => Promise.resolve(rows)),
      };
      return chain;
    }),
    insert: jest.fn(() => ({
      values: jest.fn((value: any) => {
        inserts.push(value);
        return Promise.resolve([]);
      }),
    })),
    update: jest.fn(() => ({
      set: jest.fn(() => ({
        where: jest.fn(() => Promise.resolve([])),
      })),
    })),
  };

  return tx;
}

describe("production inventory consumption", () => {
  test("fails before insert when inventory adjustment organization context is missing", async () => {
    const tx = createConsumptionTx();

    await expect(consumeReservedMaterialsForLineItem(tx, {
      organizationId: "",
      orderId: "order-1",
      lineItemId: "line-1",
      productionJobId: "job-1",
      userId: "user-1",
    })).rejects.toThrow("Missing organization context for inventory adjustment");

    expect(tx.insert).not.toHaveBeenCalled();
  });

  test("writes organizationId onto job usage inventory adjustments", async () => {
    const tx = createConsumptionTx();

    await consumeReservedMaterialsForLineItem(tx, {
      organizationId: "org-1",
      orderId: "order-1",
      lineItemId: "line-1",
      productionJobId: "job-1",
      userId: "user-1",
    });

    const adjustment = tx.inserts.find((value: any) => value.type === "job_usage");
    expect(adjustment).toEqual(expect.objectContaining({
      organizationId: "org-1",
      materialId: "mat-1",
      orderId: "order-1",
      userId: "user-1",
    }));
  });
});

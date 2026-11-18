import { describe, expect, test } from "@jest/globals";
import { actualPurchaseLandedCosts, expectedPurchaseLandedCosts, type PurchaseLandedLine } from "../purchaseLandedCosts";
import { defaultPurchaseAllocation, purchaseChargeAmount, purchaseLineTotal, purchaseTotals } from "../purchaseOrderWorkflow";

const material: PurchaseLandedLine = {
  materialId: "material", purchaseUnit: "each", quantityOrdered: "2", lineTotal: "10.0000",
  inventoryUnitsPerPurchaseUnit: "2.000000",
};
const service = { ...material, materialId: null, lineTotal: "40.0000" };
const header = { shippingTotal: "1.01", otherCharges: [], landedCostAllocation: defaultPurchaseAllocation };

describe("purchase charges and landed costs", () => {
  test("rounds subtotal once and adds tax, freight, and other charges exactly", () => {
    const lines = [{ lineTotal: purchaseLineTotal("0.01", "0.5000") }, { lineTotal: "0.0050" }];
    expect(purchaseTotals(lines, "0.01", "0.02", [{ amount: "0.03" }])).toEqual({ subtotal: "0.01", grandTotal: "0.07" });
    for (const invalid of ["-0.01", "0.005", "NaN", "100000000.00"]) expect(purchaseChargeAmount.safeParse(invalid).success).toBe(false);
    expect(purchaseChargeAmount.safeParse("0.00").success).toBe(true);
  });

  test("allocates by value with deterministic cents and excludes services", () => {
    const result = expectedPurchaseLandedCosts(header, [material, service, material]);
    expect(result).toMatchObject({ eligibleTotal: "1.01", allocatedTotal: "1.01", unallocatedTotal: "0.00",
      lines: [
        { index: 0, amount: "0.51", purchaseUnitCost: "5.2550", inventoryUnitCost: "2.6275" },
        { index: 2, amount: "0.50", purchaseUnitCost: "5.2500", inventoryUnitCost: "2.6250" },
      ],
    });
  });

  test("allocates by compatible purchase units and fails closed for mixed or unknown units", () => {
    const order = { ...header, landedCostAllocation: { method: "quantity", includeFreight: true } } as const;
    const small = { ...material, quantityOrdered: "1" };
    expect(expectedPurchaseLandedCosts(order, [material, small]).lines.map(line => line.amount)).toEqual(["0.67", "0.34"]);
    for (const purchaseUnit of [null, "case"]) {
      expect(expectedPurchaseLandedCosts(order, [material, { ...small, purchaseUnit }])).toMatchObject({
        error: expect.stringContaining("same known purchase unit"), allocatedTotal: "0.00", unallocatedTotal: "1.01",
      });
    }
  });

  test("reconciles manual splits and keeps excluded charges in the PO total", () => {
    const order = {
      ...header,
      landedCostAllocation: { method: "manual", includeFreight: false } as const,
      otherCharges: [{ id: "handling", description: "Handling", amount: "2.00", allocatable: true }],
    };
    expect(expectedPurchaseLandedCosts(order, [material]).error).toContain("must add up");
    expect(expectedPurchaseLandedCosts(order, [{ ...material, manualLandedAmount: "2.00" }])).toMatchObject({
      eligibleTotal: "2.00", allocatedTotal: "2.00", unallocatedTotal: "1.01",
    });
    expect(expectedPurchaseLandedCosts({ ...order, landedCostAllocation: { method: "none", includeFreight: false } }, [material]))
      .toMatchObject({ allocatedTotal: "0.00", unallocatedTotal: "3.01" });
  });

  test("prorates an actual total by the saved manual split only after full material receipt", () => {
    const cost = { quantity: null, unitCost: null, total: "10.00", final: true, reason: "Vendor invoice", date: "2026-11-18", reference: null };
    const order = {
      ...header,
      shippingTotal: "1.00",
      landedCostAllocation: { method: "manual", includeFreight: true } as const,
      actualCosts: { first: cost, second: cost, freight: { ...cost, total: "1.99" }, tax: { ...cost, total: "100.00" } },
    };
    const lines = [
      { ...material, id: "first", quantityReceived: "2", manualLandedAmount: "0.25" },
      { ...material, id: "second", quantityReceived: "1", manualLandedAmount: "0.75" },
    ];
    expect(actualPurchaseLandedCosts(order, lines)).toBeNull();
    lines[1].quantityReceived = "2";
    expect(actualPurchaseLandedCosts(order, lines)).toMatchObject({
      final: true, allocatedTotal: "1.99", lines: [{ amount: "0.50" }, { amount: "1.49" }],
    });
  });
});

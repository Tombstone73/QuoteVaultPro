import { calculateDiscountedOrderTax } from "@shared/orderDiscountTax";

describe("Order discount allocation", () => {
  test("zero and full discounts preserve or remove taxable selling amount", () => {
    const lines = [{ totalCents: 50_000, isTaxable: true }];
    expect(calculateDiscountedOrderTax({ lines, discountCents: 0, taxRate: 0.07 }).taxCents).toBe(3500);
    expect(calculateDiscountedOrderTax({ lines, discountCents: 50_000, taxRate: 0.07 }))
      .toMatchObject({ taxableSubtotalCents: 0, taxCents: 0 });
  });

  test("leftover discount cents follow largest remainder and stable line order", () => {
    const result = calculateDiscountedOrderTax({
      lines: [
        { totalCents: 5, isTaxable: true },
        { totalCents: 5, isTaxable: true },
        { totalCents: 5, isTaxable: false },
      ], discountCents: 2, taxRate: 0.1,
    });
    expect(result.lineDiscountCents).toEqual([1, 1, 0]);
    expect(result.taxableSubtotalCents).toBe(8);
    expect(result.lineTaxCents).toEqual([0, 0, 0]);
  });

  test("tax is rounded on each discounted taxable line and reconciles to the header", () => {
    const result = calculateDiscountedOrderTax({
      lines: [{ totalCents: 15, isTaxable: true }, { totalCents: 15, isTaxable: true }],
      discountCents: 1, taxRate: 0.1,
    });
    expect(result.lineDiscountCents).toEqual([1, 0]);
    expect(result.lineTaxCents).toEqual([1, 2]);
    expect(result.taxCents).toBe(result.lineTaxCents.reduce((sum, cents) => sum + cents, 0));
  });

  test("line price changes change the allocated taxable amount", () => {
    const lines = [{ totalCents: 10_000, isTaxable: true }, { totalCents: 10_000, isTaxable: false }];
    expect(calculateDiscountedOrderTax({ lines, discountCents: 2_000, taxRate: 0.1 }).taxCents).toBe(900);
    expect(calculateDiscountedOrderTax({ lines: [{ ...lines[0]!, totalCents: 20_000 }, lines[1]!],
      discountCents: 2_000, taxRate: 0.1 }).taxCents).toBe(1867);
  });
});

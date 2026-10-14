import { describe, expect, test } from "@jest/globals";
import { calculateQuoteOrderTotals } from "../quoteOrderPricing";
import {
  formatTaxRatePercent,
  taxRateDecimalFromPercent,
  taxRatePercentFromDecimal,
} from "@shared/salesTax";

const organization = { id: "org-sales-tax", taxEnabled: true, defaultTaxRate: 0.07 };
const taxableLine = { productId: "taxable", linePrice: 100, isTaxable: true };

describe("sales tax configuration and calculation", () => {
  test("converts settings percentages to persisted decimal rates and back", () => {
    expect(taxRateDecimalFromPercent(7)).toBe(0.07);
    expect(taxRatePercentFromDecimal("0.0700")).toBe(7);
    expect(formatTaxRatePercent(0.07)).toBe("7.00");
  });

  test("does not tax any lines when organization sales tax is disabled", async () => {
    const result = await calculateQuoteOrderTotals([taxableLine], { ...organization, taxEnabled: false });
    expect(result).toMatchObject({ taxableSubtotal: 100, taxRate: 0, taxAmount: 0, total: 100 });
  });

  test("customer tax exemption wins over the organization default", async () => {
    const result = await calculateQuoteOrderTotals([taxableLine], organization, {
      isTaxExempt: true,
      taxRateOverride: null,
    } as any);
    expect(result).toMatchObject({ taxRate: 0, taxAmount: 0, total: 100 });
  });

  test("customer override, including an intentional zero rate, wins over the organization default", async () => {
    const fivePercent = await calculateQuoteOrderTotals([taxableLine], organization, {
      isTaxExempt: false,
      taxRateOverride: "0.0500",
    } as any);
    const zeroPercent = await calculateQuoteOrderTotals([taxableLine], organization, {
      isTaxExempt: false,
      taxRateOverride: "0.0000",
    } as any);

    expect(fivePercent).toMatchObject({ taxRate: 0.05, taxAmount: 5, total: 105 });
    expect(zeroPercent).toMatchObject({ taxRate: 0, taxAmount: 0, total: 100 });
  });

  test("uses the configured organization default as the final fallback regardless of address data", async () => {
    const result = await calculateQuoteOrderTotals(
      [taxableLine],
      organization,
      null,
      null,
      { country: "US", state: "IN", city: "Indianapolis", postalCode: "46201" },
    );
    expect(result).toMatchObject({ taxRate: 0.07, taxAmount: 7, total: 107 });
  });

  test("only taxable product lines contribute to taxable subtotal and tax", async () => {
    const result = await calculateQuoteOrderTotals([
      taxableLine,
      { productId: "non-taxable", linePrice: 25, isTaxable: false },
    ], organization);

    expect(result).toMatchObject({ subtotal: 125, taxableSubtotal: 100, taxRate: 0.07, taxAmount: 7, total: 132 });
    expect(result.lineItemsWithTax.map((line) => line.taxAmount)).toEqual([7, 0]);
  });

  test("an Order exempt policy overrides automatic customer and organization tax resolution", async () => {
    const result = await calculateQuoteOrderTotals([taxableLine], organization, {
      isTaxExempt: false,
      taxRateOverride: "0.0500",
    } as any, null, null, { mode: "exempt" });

    expect(result).toMatchObject({ taxableSubtotal: 100, taxRate: 0, taxAmount: 0, total: 100 });
  });

  test("an Order rate policy taxes only effective taxable lines", async () => {
    const result = await calculateQuoteOrderTotals([
      taxableLine,
      { productId: "non-taxable-on-order", linePrice: 50, isTaxable: false },
    ], organization, null, null, null, { mode: "rate", rate: 0.07 });

    expect(result).toMatchObject({ subtotal: 150, taxableSubtotal: 100, taxRate: 0.07, taxAmount: 7, total: 157 });
    expect(result.lineItemsWithTax.map((line) => line.taxAmount)).toEqual([7, 0]);
  });

  test("Order discount reduces taxable selling amount before tax", async () => {
    const result = await calculateQuoteOrderTotals([
      { productId: "sign", linePrice: 500, isTaxable: true },
    ], organization, null, null, null, { mode: "auto" }, 50);
    expect(result).toMatchObject({ subtotal: 500, taxableSubtotal: 450, taxAmount: 31.5, total: 481.5 });
    expect(result.lineItemsWithTax.map((line) => line.taxAmount)).toEqual([31.5]);
  });

  test("mixed Order discount is allocated across taxable and exempt lines", async () => {
    const result = await calculateQuoteOrderTotals([
      { productId: "taxable", linePrice: 100, isTaxable: true },
      { productId: "exempt", linePrice: 100, isTaxable: false },
    ], organization, null, null, null, { mode: "rate", rate: 0.1 }, 20);
    expect(result).toMatchObject({ subtotal: 200, taxableSubtotal: 90, taxAmount: 9, total: 189 });
    expect(result.lineItemsWithTax.map((line) => line.taxAmount)).toEqual([9, 0]);
  });

  test("Order discount retains exemptions and authorized rate overrides", async () => {
    const exempt = await calculateQuoteOrderTotals([taxableLine], organization, null, null, null,
      { mode: "exempt" }, 10);
    const override = await calculateQuoteOrderTotals([taxableLine], organization, null, null, null,
      { mode: "rate", rate: 0.05 }, 10);
    expect(exempt).toMatchObject({ taxableSubtotal: 90, taxAmount: 0, total: 90 });
    expect(override).toMatchObject({ taxableSubtotal: 90, taxAmount: 4.5, total: 94.5 });
  });
});

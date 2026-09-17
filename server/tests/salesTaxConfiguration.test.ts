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
});

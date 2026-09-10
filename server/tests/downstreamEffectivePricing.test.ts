import { describe, expect, test } from "@jest/globals";

import {
  buildQuickBooksInvoiceLinePayloads,
  buildQuickBooksInvoiceLinePayloadsWithDiagnostics,
  resolveOrderLineItemInvoicePricing,
} from "../lib/downstreamEffectivePricing";

describe("downstream effective line item pricing consumers", () => {
  test("invoice snapshot pricing uses effective order line totals instead of base PBV2 totals", () => {
    const pricing = resolveOrderLineItemInvoicePricing({
      quantity: 1,
      unitPrice: "19.80",
      totalPrice: "19.80",
      pbv2SnapshotJson: { pricing: { totalCents: 1500 } },
      specsJson: {
        priceOverride: {
          mode: "override_total_after_margin",
          valueCents: 1980,
          baseCalculatedTotalCents: 1500,
          effectiveTotalCents: 1980,
        },
      },
    });

    expect(pricing.effectiveUnitPriceCents).toBe(1980);
    expect(pricing.effectiveTotalCents).toBe(1980);
  });

  test("invoice snapshot pricing prefers explicit effective cents when present", () => {
    const pricing = resolveOrderLineItemInvoicePricing({
      quantity: 2,
      unitPrice: "80.00",
      totalPrice: "160.00",
      effectiveUnitPriceCents: 1980,
      effectiveTotalCents: 3960,
      baseCalculatedTotalCents: 16000,
    });

    expect(pricing.quantity).toBe(2);
    expect(pricing.effectiveUnitPriceCents).toBe(1980);
    expect(pricing.effectiveTotalCents).toBe(3960);
  });

  test("QuickBooks invoice payload uses effective line amount and per-unit price", () => {
    const [line] = buildQuickBooksInvoiceLinePayloads([
      {
        description: "Override unit item",
        quantity: 2,
        unitPriceCents: 1980,
        lineTotalCents: 3960,
        totalPrice: "160.00",
      },
    ]);

    expect(line.Amount).toBe(39.6);
    expect(line.SalesItemLineDetail.Qty).toBe(2);
    expect(line.SalesItemLineDetail.UnitPrice).toBe(19.8);
  });

  test("QuickBooks invoice payload falls back to effective total cents over stale decimal total", () => {
    const [line] = buildQuickBooksInvoiceLinePayloads([
      {
        description: "Legacy effective cents item",
        quantity: 1,
        effectiveUnitPriceCents: 1980,
        effectiveTotalCents: 1980,
        totalPrice: "160.00",
      },
    ]);

    expect(line.Amount).toBe(19.8);
    expect(line.SalesItemLineDetail.UnitPrice).toBe(19.8);
  });

  test("QuickBooks preserves an $181 total override using provider precision instead of the displayed $22.63 rate", () => {
    const [line] = buildQuickBooksInvoiceLinePayloads([{
      description: "Eight overridden pieces",
      quantity: 8,
      unitPriceCents: 2263,
      lineTotalCents: 18100,
      specsJson: { priceOverride: { mode: "override_total_after_margin", valueCents: 18100, effectiveTotalCents: 18100 } },
    }]);

    expect(line.Amount).toBe(181);
    expect(line.SalesItemLineDetail).toEqual({ Qty: 8, UnitPrice: 22.625 });
    expect(Math.round(line.SalesItemLineDetail.Qty * line.SalesItemLineDetail.UnitPrice * 100)).toBe(18100);
    expect(resolveOrderLineItemInvoicePricing({ quantity: 8, unitPriceCents: 2263, lineTotalCents: 18100 }).effectiveTotalCents).toBe(18100);
  });

  test("QuickBooks preserves a repeating total override without the $2,058.94 display-rate drift", () => {
    const [line] = buildQuickBooksInvoiceLinePayloads([{
      description: "Twenty-six overridden pieces",
      quantity: 26,
      unitPriceCents: 7919,
      lineTotalCents: 205900,
      specsJson: { priceOverride: { mode: "override_total_after_margin", valueCents: 205900, effectiveTotalCents: 205900 } },
    }]);

    expect(line.Amount).toBe(2059);
    expect(line.SalesItemLineDetail.UnitPrice).toBe(79.1923077);
    expect(Math.round(line.SalesItemLineDetail.Qty * line.SalesItemLineDetail.UnitPrice * 100)).toBe(205900);
    expect(line.Amount).not.toBe(2058.94);
  });

  test("Force Sync's invoice builder preserves an authoritative historic formula total when its display rate is rounded", () => {
    // Production invoice 20298 shape: this line is not marked as an override,
    // but its immutable $116.16 total cannot be represented by 214 × $0.54.
    const built = buildQuickBooksInvoiceLinePayloadsWithDiagnostics([{
      description: "Historic formula-priced line",
      quantity: 214,
      unitPriceCents: 54,
      lineTotalCents: 11616,
      specsJson: null,
    }]);

    expect(built.payloads).toHaveLength(1);
    expect(built.payloads[0]).toMatchObject({
      Amount: 116.16,
      SalesItemLineDetail: { Qty: 214, UnitPrice: 0.5428037 },
    });
    expect(Math.round(built.payloads[0].SalesItemLineDetail.Qty * built.payloads[0].SalesItemLineDetail.UnitPrice * 100)).toBe(11616);
    expect(built.diagnostics).toEqual([{
      lineNum: 1,
      quantity: 214,
      unitPrice: 0.5428037,
      amount: 116.16,
      overrideType: null,
      precisionReason: "authoritative_total_mismatch",
    }]);
  });

  test("total overrides use provider precision for clean, half-cent, and repeating rates while preserving each authoritative cent total", () => {
    const lines = buildQuickBooksInvoiceLinePayloads([
      { quantity: 8, lineTotalCents: 18000, specsJson: { priceOverride: { mode: "total" } } },
      { quantity: 8, lineTotalCents: 18100, specsJson: { priceOverride: { mode: "override_total_before_margin" } } },
      { quantity: 6, lineTotalCents: 100, specsJson: { priceOverride: { mode: "override_total_after_margin" } } },
    ]);

    expect(lines.map((line) => line.SalesItemLineDetail.UnitPrice)).toEqual([22.5, 22.625, 0.1666667]);
    expect(lines.map((line) => Math.round(line.SalesItemLineDetail.Qty * line.SalesItemLineDetail.UnitPrice * 100))).toEqual([18000, 18100, 100]);
    expect(lines.reduce((sum, line) => sum + Math.round(line.Amount * 100), 0)).toBe(36200);
  });

  test("normal and unit-price override payload rates remain customer-currency rounded", () => {
    const [normal, unitOverride] = buildQuickBooksInvoiceLinePayloads([
      { quantity: 2, unitPriceCents: 1980, lineTotalCents: 3960 },
      { quantity: 2, unitPriceCents: 1980, lineTotalCents: 3960, specsJson: { priceOverride: { mode: "override_unit_after_margin", valueCents: 1980 } } },
    ]);

    expect(normal).toMatchObject({ Amount: 39.6, SalesItemLineDetail: { Qty: 2, UnitPrice: 19.8 } });
    expect(unitOverride).toMatchObject({ Amount: 39.6, SalesItemLineDetail: { Qty: 2, UnitPrice: 19.8 } });
  });

  test("hourly PBV2 snapshots retain fractional hours and rate for QuickBooks", () => {
    const snapshot = {
      treeJson: { meta: { billingUnit: { kind: "hour", selectionKey: "hours", step: 0.25 }, pricingFormulaVariables: { hourly_rate: 60 } } },
      selections: { hours: { value: 2.5 } },
    };
    const pricing = resolveOrderLineItemInvoicePricing({ quantity: 1, unitPrice: "150.00", totalPrice: "150.00", pbv2SnapshotJson: snapshot });
    expect(pricing.quantity).toBe(1); // Physical line quantity remains intact.
    expect(pricing.commercialQuantity).toBe(2.5);
    expect(pricing.commercialRateCents).toBe(6000);

    const [line] = buildQuickBooksInvoiceLinePayloads([{ description: "Design", quantity: 1, unitPriceCents: 15000, lineTotalCents: 15000, pbv2SnapshotJson: snapshot }]);
    expect(line.Amount).toBe(150);
    expect(line.SalesItemLineDetail).toEqual({ Qty: 2.5, UnitPrice: 60 });
  });
});

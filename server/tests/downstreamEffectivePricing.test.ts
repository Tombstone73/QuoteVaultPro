import { describe, expect, test } from "@jest/globals";

import {
  buildQuickBooksInvoiceLinePayloads,
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
});

import { expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseCurrencyDollarsToCents } from "@shared/currencyInput";
import { applyLineItemEditPriceOverride } from "@shared/lineItemPriceOverrides";

test("currency entry accepts valid cents and commits deterministic integer cents", () => {
  expect(parseCurrencyDollarsToCents("25")).toBe(2500);
  expect(parseCurrencyDollarsToCents("25.5")).toBe(2550);
  expect(parseCurrencyDollarsToCents("25.50")).toBe(2550);
  expect(parseCurrencyDollarsToCents("25.55")).toBe(2555);
  expect(parseCurrencyDollarsToCents("0.50")).toBe(50);
});

test("currency entry rejects negative, malformed, and more-than-cent values without affecting quantity rules", () => {
  for (const value of ["-1", ".50", "25.555", "25x", "Infinity", ""]) {
    expect(parseCurrencyDollarsToCents(value)).toBeNull();
  }
});

test("a service-fee total override keeps exact cents through the canonical pricing operation", () => {
  const pricing = applyLineItemEditPriceOverride({
    baseCalculatedTotalCents: 1000,
    quantity: 1,
    mode: "override_total_after_margin",
    valueCents: parseCurrencyDollarsToCents("37.25"),
  });

  expect(pricing.effectiveTotalCents).toBe(3725);
  expect(pricing.effectiveUnitPriceCents).toBe(3725);
});

test("the shared Order total editor is decimal-keyboard capable and continues through cents-backed Invoice synchronization", () => {
  const lineItemCard = readFileSync(path.join(process.cwd(), "client/src/components/line-items/LineItemCard.tsx"), "utf8");
  const orderLines = readFileSync(path.join(process.cwd(), "client/src/components/orders/OrderLineItemsSection.tsx"), "utf8");
  const invoiceService = readFileSync(path.join(process.cwd(), "server/invoicesService.ts"), "utf8");

  expect(lineItemCard).toContain('inputMode="decimal"');
  expect(orderLines).toContain("parseCurrencyDollarsToCents(rawValue)");
  expect(orderLines).toContain("valueCents: nextCents");
  expect(invoiceService).toContain("synchronizeOrderBackedInvoiceFromOrderInTransaction");
});

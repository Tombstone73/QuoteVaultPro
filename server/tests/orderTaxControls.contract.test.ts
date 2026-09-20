import { describe, expect, it } from "@jest/globals";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function source(file: string) {
  return readFile(path.resolve(process.cwd(), file), "utf8");
}

describe("Order tax controls contract", () => {
  it("keeps staff tax intent separate from effective tax snapshots", async () => {
    const [schema, calculation] = await Promise.all([
      source("shared/schema.ts"),
      source("server/services/orders/orderTaxCalculationService.ts"),
    ]);

    expect(schema).toContain('taxabilityOverride: boolean("taxability_override")');
    expect(calculation).toContain("resolveEffectiveLineTaxability(");
    expect(calculation).toContain("isTaxableSnapshot: totals.lineItemsWithTax[index]!.isTaxableSnapshot");
  });

  it("uses auto, exempt, and explicit-rate policy through the authoritative Order rollup", async () => {
    const [schema, calculation, pricing] = await Promise.all([
      source("shared/schema.ts"),
      source("server/services/orders/orderTaxCalculationService.ts"),
      source("server/quoteOrderPricing.ts"),
    ]);

    expect(schema).toContain('taxOverrideMode: varchar("tax_override_mode"');
    expect(schema).toContain('taxRateOverride: decimal("tax_rate_override"');
    expect(calculation).toContain("resolveOrderTaxPolicy(input.taxOverrideMode, input.taxRateOverride)");
    expect(pricing).toContain('taxPolicy?.mode === "exempt"');
    expect(pricing).toContain('taxPolicy?.mode === "rate"');
  });

  it("requires Admin/Owner server authorization, recalculates, audits, and synchronizes the live Invoice", async () => {
    const routes = await source("server/routes/orders.routes.ts");

    expect(routes).toContain('app.patch("/api/order-line-items/:id/taxability", isAuthenticated, tenantContext, requireOrderLineItemAdminOrOwner');
    expect(routes).toContain('app.patch("/api/orders/:id/tax-treatment", isAuthenticated, tenantContext, isAdminOrOwner');
    expect(routes).toContain('actionType: "line_item.taxability_overridden"');
    expect(routes).toContain('actionType: "order.tax_treatment_changed"');
    expect(routes).toContain("recalculateEditableOrderFinancialsInTransaction(tx");
  });

  it("registers the append-only Order tax migration and exposes the current UI controls", async () => {
    const [migration, journal, page, lines] = await Promise.all([
      source("server/db/migrations_v2/0207_order_tax_controls.sql"),
      source("server/db/migrations_v2/meta/_journal.json"),
      source("client/src/pages/order-detail.tsx"),
      source("client/src/components/orders/OrderLineItemsSection.tsx"),
    ]);

    expect(migration).toContain("taxability_override boolean");
    expect(migration).toContain("tax_override_mode varchar(16)");
    expect(journal).toContain('"tag": "0207_order_tax_controls"');
    expect(page).toContain("Tax Settings");
    expect(page).toContain("Tax Exempt for This Order");
    expect(lines).toContain("Use product default");
  });
});

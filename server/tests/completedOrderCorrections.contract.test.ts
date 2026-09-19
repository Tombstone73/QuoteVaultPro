import { describe, expect, it } from "@jest/globals";
import { readFile } from "node:fs/promises";
import path from "node:path";

const source = (file: string) => readFile(path.resolve(process.cwd(), file), "utf8");

describe("completed Order correction contract", () => {
  it("keeps completed lines editable in the normal editor while preserving cancelled/void locks", async () => {
    const [section, routes] = await Promise.all([
      source("client/src/components/orders/OrderLineItemsSection.tsx"),
      source("server/routes/orders.routes.ts"),
    ]);

    expect(section).toContain('const lockedStates = new Set(["canceled", "cancelled", "void", "voided"])');
    expect(section).toContain('onSave={readOnly ? undefined : handleSaveItem}');
    expect(routes).toContain('const LINE_ITEM_EDIT_LOCKED_STATES = new Set(["canceled", "cancelled", "void", "voided"])');
    expect(routes).toContain('requireOrderLineItemAdminOrOwner');
  });

  it("preserves operational history on removal and excludes the historical line from billing", async () => {
    const [routes, bundles] = await Promise.all([
      source("server/routes/orders.routes.ts"),
      source("server/services/lineItemBundles.ts"),
    ]);

    expect(routes).toContain('getLineItemHistoricalDependencyTypes');
    expect(routes).toContain('line_item.removed_after_completion');
    expect(routes).toContain('removalMode: "historical_cancellation"');
    expect(bundles).toContain('isCommerciallyRemovedLine');
    expect(bundles).toContain('const activeLines = lineItems.filter((line) => !isCommerciallyRemovedLine(line));');
  });

  it("updates an unpaid live invoice but retains paid invoice history for reconciliation", async () => {
    const invoices = await source("server/invoicesService.ts");

    expect(invoices).toContain('accountingApprovalRevocationPatch(invoice as any)');
    expect(invoices).toContain('status: "paid_invoice_adjustment_required" as const');
    expect(invoices).toContain('order_paid_invoice_adjustment_required');
  });
});

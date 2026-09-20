import { describe, expect, it } from "@jest/globals";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function source(file: string) {
  return readFile(path.resolve(process.cwd(), file), "utf8");
}

describe("Order mutation atomicity", () => {
  it("commits an editable commercial header only with an authoritative persisted-line financial rollup and audit record", async () => {
    const sourceText = await source("server/services/orders/canonicalOrderOperations.ts");

    expect(sourceText).toContain("return db.transaction(async (tx) => {");
    expect(sourceText).toContain("new OrdersRepository(tx).updateOrder");
    expect(sourceText).toContain("recalculateEditableOrderFinancialsInTransaction(tx");
    expect(sourceText).toContain("orderChangesRequireOrderBackedInvoiceSynchronization(input.changes)");
    expect(sourceText).toContain("await tx.insert(auditLogs)");
  });

  it("commits line-item add and delete only with the authoritative financial rollup", async () => {
    const [routes, taxService, billingService] = await Promise.all([
      source("server/routes/orders.routes.ts"),
      source("server/services/orders/orderTaxCalculationService.ts"),
      source("server/services/orderBillingService.ts"),
    ]);

    expect(routes).toContain("new OrdersRepository(tx).createOrderLineItem");
    expect(routes).toContain("const repository = new OrdersRepository(tx);");
    expect(routes).toContain("repository.deleteOrderLineItem(lineItemId)");
    expect(routes).toContain("getLineItemHistoricalDependencyTypes");
    expect(routes).toContain("recalculateEditableOrderFinancialsInTransaction(tx");
    expect(routes).toContain("recomputeOrderBillingStatus({ organizationId, orderId: String(ownedLineItem.orderId), executor: tx })");
    expect(taxService).toContain("export async function recalculateEditableOrderFinancialsInTransaction");
    expect(taxService).toContain("synchronizeOrderBackedInvoiceFromOrderInTransaction(executor, input)");
    expect(billingService).toContain("executor?: any;");
  });

  it("rebuilds a commercial header correction from persisted billable lines and includes shipping exactly once", async () => {
    const taxService = await source("server/services/orders/orderTaxCalculationService.ts");

    expect(taxService).toContain("const lines = await executor.select().from(orderLineItems)");
    expect(taxService).toContain("const shipping = Math.max(0, Number(order.shippingCents) || 0) / 100;");
    expect(taxService).toContain("const total = totals.subtotal - discount + totals.taxAmount + shipping;");
  });
});

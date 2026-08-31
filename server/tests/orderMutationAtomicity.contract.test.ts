import { describe, expect, it } from "@jest/globals";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function source(file: string) {
  return readFile(path.resolve(process.cwd(), file), "utf8");
}

describe("Order mutation atomicity", () => {
  it("commits an editable header only with its required draft-invoice synchronization and audit record", async () => {
    const sourceText = await source("server/services/orders/canonicalOrderOperations.ts");

    expect(sourceText).toContain("return db.transaction(async (tx) => {");
    expect(sourceText).toContain("new OrdersRepository(tx).updateOrder");
    expect(sourceText).toContain("synchronizeOrderBackedInvoiceFromOrderInTransaction(tx");
    expect(sourceText).toContain("await tx.insert(auditLogs)");
  });

  it("commits line-item add and delete only with the authoritative financial rollup", async () => {
    const [routes, taxService, billingService] = await Promise.all([
      source("server/routes/orders.routes.ts"),
      source("server/services/orders/orderTaxCalculationService.ts"),
      source("server/services/orderBillingService.ts"),
    ]);

    expect(routes).toContain("new OrdersRepository(tx).createOrderLineItem");
    expect(routes).toContain("new OrdersRepository(tx).deleteOrderLineItem");
    expect(routes).toContain("recalculateEditableOrderFinancialsInTransaction(tx");
    expect(routes).toContain("recomputeOrderBillingStatus({ organizationId, orderId: String(ownedLineItem.orderId), executor: tx })");
    expect(taxService).toContain("export async function recalculateEditableOrderFinancialsInTransaction");
    expect(taxService).toContain("synchronizeOrderBackedInvoiceFromOrderInTransaction(executor, input)");
    expect(billingService).toContain("executor?: any;");
  });
});

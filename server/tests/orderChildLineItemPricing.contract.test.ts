import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("normal parent/child order commercial pricing", () => {
  test("does not mutate a normal parent's price when a child is linked, changed, or unlinked", () => {
    const orders = source("server/routes/orders.routes.ts");
    const quotes = source("server/routes/quotes.routes.ts");

    expect(orders).toContain('app.patch("/api/order-line-items/:id/parent"');
    expect(orders).not.toContain("const childAmount = Number(child.totalPrice)");
    expect(orders).not.toContain("formula: \"linked_children\"");
    expect(quotes).not.toContain("const childAmount = Number(child.linePrice)");
    expect(quotes).not.toContain("formula: \"linked_children\"");
  });

  test("uses the shared bundle commercial-line authority for order tax and invoice snapshots", () => {
    const tax = source("server/services/orders/orderTaxCalculationService.ts");
    const invoices = source("server/invoicesService.ts");

    expect(tax).toContain('getBillableBundleRoots(input.lines)');
    expect(invoices).toContain('getBillableBundleRoots(pricedLineItems.map((item) => item.lineItem))');
  });
});

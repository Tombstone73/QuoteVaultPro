import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("purchase order related order contract", () => {
  test("schema stores an authoritative nullable related order id", () => {
    const schema = read("shared/schema.ts");
    const migration = read("server/db/migrations_v2/0113_purchase_order_related_order.sql");

    expect(schema).toContain("relatedOrderId: varchar('related_order_id').references(() => orders.id");
    expect(schema).toContain("purchase_orders_related_order_id_idx");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS related_order_id");
    expect(migration).toContain("REFERENCES orders(id) ON DELETE SET NULL");
  });

  test("search endpoint is registered before the parameterized detail route", () => {
    const routes = read("server/routes/procurement.routes.ts");

    expect(routes.indexOf("app.get('/api/purchase-orders/related-orders/search'")).toBeGreaterThan(-1);
    expect(routes.indexOf("app.get('/api/purchase-orders/related-orders/search'")).toBeLessThan(routes.indexOf("app.get('/api/purchase-orders/:id'"));
  });

  test("search is tenant scoped, capped, and supports order/customer/product matching", () => {
    const repo = read("server/storage/accounting.repo.ts");

    expect(repo).toContain("if (!recent && query.length < 2) return []");
    expect(repo).toContain("Math.min(25");
    expect(repo).toContain("WHERE o.organization_id = ${organizationId}");
    expect(repo).toContain("o.order_number ILIKE");
    expect(repo).toContain("c.company_name ILIKE");
    expect(repo).toContain("oli_search.description ILIKE");
  });

  test("create and update validate organization ownership and allow clearing the relationship", () => {
    const repo = read("server/storage/accounting.repo.ts");

    expect(repo).toContain("assertRelatedOrderIsLinkable");
    expect(repo).toContain("RELATED_ORDER_NOT_FOUND");
    expect(repo).toContain("if (!orderId) return null");
    expect(repo).toContain("headerUpdates.relatedOrderId");
    expect(repo).toContain("relatedOrderId = await this.assertRelatedOrderIsLinkable");
  });

  test("PO header, related order, and line items remain transactional", () => {
    const repo = read("server/storage/accounting.repo.ts");

    expect(repo).toContain("return await this.dbInstance.transaction(async (tx)");
    expect(repo).toContain("const relatedOrderId = await this.assertRelatedOrderIsLinkable");
    expect(repo).toContain("await tx.insert(purchaseOrders)");
    expect(repo).toContain("await tx.insert(purchaseOrderLineItems)");
  });
});

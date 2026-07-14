import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const repoSource = () => fs.readFileSync(path.join(process.cwd(), "server/storage/accounting.repo.ts"), "utf8");
const serviceSource = () => fs.readFileSync(path.join(process.cwd(), "server/services/documentNumberingService.ts"), "utf8");
const migrationSource = () => fs.readFileSync(path.join(process.cwd(), "server/db/migrations_v2/0112_purchase_order_numbering.sql"), "utf8");
const schemaSource = () => fs.readFileSync(path.join(process.cwd(), "shared/schema.ts"), "utf8");

describe("purchase order numbering contract", () => {
  test("vendor purchase order creation uses the shared document numbering service", () => {
    const source = repoSource();

    expect(source).toContain('allocateDocumentNumber(organizationId, "purchase_order"');
    expect(source).not.toContain("next_po_number");
    expect(source).not.toContain("MAX(CAST(SUBSTRING");
    expect(source).not.toContain("maxNum + 1");
  });

  test("permanent purchase order creation keeps number assignment inside the transaction", () => {
    const source = repoSource();

    expect(source).toContain("return await this.dbInstance.transaction(async (tx)");
    expect(source).toContain("const poNumber = await this.generateNextPoNumber(organizationId, tx)");
    expect(source).toContain("await tx.insert(purchaseOrders)");
    expect(source).toContain("isDocumentNumberUniqueViolation(error)");
    expect(source).toContain("toDocumentNumberConflictError(error)");
  });

  test("shared allocator supports tenant-scoped purchase order sequences atomically", () => {
    const source = serviceSource();

    expect(source).toContain('purchase_order: "next_purchase_order_number"');
    expect(source).toContain("ON CONFLICT (organization_id, name) DO UPDATE");
    expect(source).toContain("RETURNING (value::integer - 1) AS number_core");
  });

  test("migration seeds purchase order settings and enforces tenant-scoped uniqueness", () => {
    const source = migrationSource();

    expect(source).toContain("purchase_order_number_prefix");
    expect(source).toContain("next_purchase_order_number");
    expect(source).toContain("purchase_orders_org_po_number_unique");
    expect(source).toContain("ON purchase_orders(organization_id, po_number)");
  });

  test("customer PO references remain separate from internal vendor purchase order numbers", () => {
    const source = schemaSource();

    expect(source).toContain('poNumber: varchar("po_number", { length: 64 }), // Customer PO number');
    expect(source).toContain("customerPoNumber: varchar(\"customer_po_number\"");
    expect(source).toContain("export const purchaseOrders = pgTable('purchase_orders'");
    expect(source).toContain("poNumber: varchar('po_number', { length: 50 }).notNull()");
  });
});

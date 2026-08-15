import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const migration = () => fs.readFileSync(path.join(process.cwd(), "server/db/migrations_v2/0187_v2_sales_commercial_persistence.sql"), "utf8");

describe("M1.6 commercial persistence migration", () => {
  test("is additive, module-scoped, and does not introduce a public commercial writer", () => {
    const sql = migration();
    for (const table of ["v2_sales_documents", "v2_sales_document_lines", "v2_sales_quote_details", "v2_sales_order_details", "v2_sales_quote_checkpoints", "v2_sales_quote_conversions"]) expect(sql).toContain(`CREATE TABLE ${table}`);
    expect(sql).not.toMatch(/CREATE\s+TABLE\s+v2_(?:invoices|billing|routes|production)/i);
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+(?:quotes|orders|invoices)\b/i);
    expect(sql).not.toMatch(/CREATE\s+TABLE\s+v2_sales_audit/i);
  });

  test("has physical backstops for tenancy, numbering, checkpoints, and conversion", () => {
    const sql = migration();
    expect(sql).toContain("UNIQUE (organization_id, document_kind, business_number)");
    expect(sql).toContain("FOREIGN KEY (document_id, organization_id)");
    expect(sql).toContain("v2_sales_quote_checkpoint_immutable");
    expect(sql).toContain("v2_sales_quote_conversions_org_quote_uidx");
    const allocator = fs.readFileSync(path.join(process.cwd(), "v2/infrastructure/sales/postgresCommercialPrimitives.ts"), "utf8");
    expect(allocator).toContain("ON CONFLICT (organization_id, document_kind)");
    const relationIntegrity = fs.readFileSync(path.join(process.cwd(), "server/db/migrations_v2/0188_v2_sales_customer_contact_reference_integrity.sql"), "utf8");
    expect(relationIntegrity).toContain("customer_contact_links");
    expect(relationIntegrity).toContain("v2_sales_document_customer_contact_validate");
    const hardening = fs.readFileSync(path.join(process.cwd(), "server/db/migrations_v2/0191_v2_sales_subtype_and_terms_hardening.sql"), "utf8");
    expect(hardening).toContain("v2_sales_quote_detail_retained_validate");
    expect(hardening).toContain("commercial_notes");
  });
});

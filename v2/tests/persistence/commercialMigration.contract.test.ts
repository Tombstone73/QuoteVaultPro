import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import { PostgresSalesDocumentNumberAllocator } from "../../infrastructure/sales/postgresCommercialPrimitives";

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
    expect(sql).toMatch(/PRIMARY KEY\s*\(organization_id, document_kind\)/);
    const convergence = fs.readFileSync(path.join(process.cwd(), "server/db/migrations_v2/0243_v2_quote_order_numbering_writer_convergence.sql"), "utf8");
    const allocation = convergence.slice(convergence.indexOf("CREATE OR REPLACE FUNCTION v2_allocate_sales_document_number("));
    expect(allocation).toMatch(/p_document_kind NOT IN \('quote', 'order'\)/);
    expect(allocation).toMatch(/VALUES \(p_organization_id, p_document_kind, 1001, initial_prefix, 1\)/);
    expect(allocation).toMatch(/ON CONFLICT \(organization_id, document_kind\) DO UPDATE/);
    expect(allocation).toMatch(/next_number = v2_sales_document_number_counters\.next_number \+ 1/);
    expect(allocation).toMatch(/revision = v2_sales_document_number_counters\.revision \+ 1/);
    expect(allocation).toMatch(/RETURNING\s+v2_sales_document_number_counters\.next_number - 1,\s+v2_sales_document_number_counters\.display_prefix/);
    expect(allocation).not.toMatch(/\b(?:COMMIT|ROLLBACK)\b/);
    const relationIntegrity = fs.readFileSync(path.join(process.cwd(), "server/db/migrations_v2/0188_v2_sales_customer_contact_reference_integrity.sql"), "utf8");
    expect(relationIntegrity).toContain("customer_contact_links");
    expect(relationIntegrity).toContain("v2_sales_document_customer_contact_validate");
    const hardening = fs.readFileSync(path.join(process.cwd(), "server/db/migrations_v2/0191_v2_sales_subtype_and_terms_hardening.sql"), "utf8");
    expect(hardening).toContain("v2_sales_quote_detail_retained_validate");
    expect(hardening).toContain("commercial_notes");
  });

  test("allocates through the shared atomic function on the caller's client and rejects invalid results", async () => {
    const allocator = new PostgresSalesDocumentNumberAllocator();
    for (const kind of ["quote", "order"] as const) {
      const calls: unknown[] = [];
      const client = { query: async (text: string, values?: readonly unknown[]) => {
        calls.push({ text, values });
        return { rows: [{ allocated_core: "1000", display_prefix: kind === "quote" ? "QT-" : "ORD-" }] };
      } };
      await expect(allocator.allocate(client as any, "org-a", kind)).resolves.toEqual({ kind, core: 1000n, display: `${kind === "quote" ? "QT-" : "ORD-"}1000` });
      expect(calls).toEqual([{ text: "SELECT allocated_core::text, display_prefix FROM v2_allocate_sales_document_number($1,$2)", values: ["org-a", kind] }]);
    }
    for (const row of [{ allocated_core: "999", display_prefix: "QT-" }, { allocated_core: "1000", display_prefix: "invalid prefix" }]) {
      await expect(allocator.allocate({ query: async () => ({ rows: [row] }) } as any, "org-a", "quote")).rejects.toThrow(/invalid/);
    }
  });
});

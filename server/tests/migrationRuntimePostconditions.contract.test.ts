import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const runner = () => readFileSync(path.join(process.cwd(), "server", "runMigrations.ts"), "utf8");

describe("runtime-critical migration postconditions", () => {
  test("startup verifies the three audited repair contracts from PostgreSQL catalog metadata", () => {
    const source = runner();

    expect(source).toContain('type: "exact_foreign_key"');
    expect(source).toContain('label: "production_runs.order_id has exactly one orders(id) SET NULL FK"');
    expect(source).toContain('type: "enum_value_exists", enumType: "line_item_file_status", value: "retired"');
    expect(source).toContain('type: "column_nullable", table: "orders", column: "customer_id"');
    expect(source).toContain("FROM pg_constraint c");
    expect(source).toContain("JOIN pg_enum e ON e.enumtypid = t.oid");
    expect(source).toContain("is_nullable = 'YES'");
  });

  test("startup verifies Formula-domain tables, indexes, constraints, and immutability triggers", () => {
    const source = runner();

    expect(source).toContain('table: "v2_formula_identities"');
    expect(source).toContain('table: "formula_revisions"');
    expect(source).toContain('table: "v2_product_version_formula_revision_bindings"');
    expect(source).toContain('index: "v2_formula_identities_catalog_idx"');
    expect(source).toContain('index: "formula_revisions_formula_idx"');
    expect(source).toContain('index: "v2_product_version_formula_revision_formula_idx"');
    expect(source).toContain('constraint: "v2_formula_identities_current_revision_tenant_fk"');
    expect(source).toContain('constraint: "formula_revisions_formula_tenant_fk"');
    expect(source).toContain('constraint: "v2_product_version_formula_revision_formula_fk"');
    expect(source).toContain('trigger: "v2_formula_revision_immutable_trg"');
    expect(source).toContain('trigger: "v2_product_version_formula_binding_immutable_trg"');
    expect(source).toContain("FROM pg_constraint c");
    expect(source).toContain("FROM pg_trigger tg");
  });
});

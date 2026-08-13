import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("material vendor purchase-unit migration repair", () => {
  test("registers the schema fields selected by the material repository in the active V2 stream", () => {
    const migration = read("server/db/migrations_v2/0172_material_vendor_purchase_units.sql");
    const journal = read("server/db/migrations_v2/meta/_journal.json");
    const migrationRunner = read("server/runMigrations.ts");

    expect(migration).toContain("ADD COLUMN IF NOT EXISTS inventory_units_per_purchase_unit numeric(14,6)");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS minimum_purchase_quantity numeric(14,6)");
    expect(migration).toContain("purchase_order_line_items");
    expect(migration).toContain("NOT NULL DEFAULT 1");
    expect(migration).toContain("pg_constraint");
    expect(journal).toContain('"tag": "0172_material_vendor_purchase_units"');
    expect(migrationRunner).toContain('label: "materials.inventory_units_per_purchase_unit"');
    expect(migrationRunner).toContain('label: "materials.minimum_purchase_quantity"');
    expect(migrationRunner).toContain('label: "purchase_order_line_items.inventory_units_per_purchase_unit"');
  });

  test("keeps a failed material query distinct from an empty active-material list in Product Builder", () => {
    const form = read("client/src/components/ProductForm.tsx");
    const editor = read("client/src/pages/ProductEditorPage.tsx");

    expect(editor).toContain("const materialsQuery = useMaterials();");
    expect(editor).toContain("materialsError={materialsQuery.isError}");
    expect(form).toContain("Materials could not be loaded. The selector is disabled until the list is available.");
    expect(form).toContain('disabled={materialsLoading || materialsError}');
    expect(form).toContain("No active materials are available in this organization.");
    expect(form).toContain("onRetryMaterials");
  });
});

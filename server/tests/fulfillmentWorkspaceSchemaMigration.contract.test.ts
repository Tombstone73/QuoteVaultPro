import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("fulfillment workspace schema migration repair", () => {
  test("registers package-aware workspace fields in the active V2 stream", () => {
    const migration = read("server/db/migrations_v2/0173_fulfillment_packages_and_references.sql");
    const journal = read("server/db/migrations_v2/meta/_journal.json");
    const migrationRunner = read("server/runMigrations.ts");

    expect(migration).toContain("ADD COLUMN IF NOT EXISTS shipment_reference varchar(80)");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS shipment_packages");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS package_id varchar");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS fulfilled_quantity integer NOT NULL DEFAULT 0");
    expect(migration).toContain("pg_constraint");
    expect(journal).toContain('"tag": "0173_fulfillment_packages_and_references"');
    expect(migrationRunner).toContain('label: "shipments.shipment_reference"');
    expect(migrationRunner).toContain('label: "shipment_packages table"');
    expect(migrationRunner).toContain('label: "shipment_items.package_id"');
    expect(migrationRunner).toContain('label: "fulfillment_checklist_items.fulfilled_quantity"');
  });

  test("keeps active V2 journal entries strictly monotonic", () => {
    const journal = JSON.parse(read("server/db/migrations_v2/meta/_journal.json"));
    const entries = journal.entries as Array<{ idx: number; when: number }>;
    for (let index = 1; index < entries.length; index += 1) {
      expect(entries[index].idx).toBeGreaterThan(entries[index - 1].idx);
      expect(entries[index].when).toBeGreaterThan(entries[index - 1].when);
    }
  });
});

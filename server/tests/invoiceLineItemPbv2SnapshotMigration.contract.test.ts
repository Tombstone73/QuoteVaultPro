import { expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

test("0189 registers the nullable invoice PBV2 snapshot column in the active V2 migration stream", () => {
  const migration = read("server/db/migrations_v2/0189_invoice_line_item_pbv2_snapshot.sql");
  const journal = JSON.parse(read("server/db/migrations_v2/meta/_journal.json"));
  const entries = journal.entries as Array<{ idx: number; when: number; tag: string }>;
  const entry = entries.find((candidate) => candidate.tag === "0189_invoice_line_item_pbv2_snapshot");

  expect(migration).toContain('ALTER TABLE "invoice_line_items"');
  expect(migration).toContain('ADD COLUMN IF NOT EXISTS "pbv2_snapshot_json" jsonb');
  expect(migration).not.toMatch(/pbv2_snapshot_json[\s\S]*NOT NULL/i);
  expect(entry).toEqual({
    idx: 190,
    when: 1788048000036,
    tag: "0189_invoice_line_item_pbv2_snapshot",
    version: "7",
    breakpoints: true,
  });
  expect(entries.at(-1)?.tag).toBe("0189_invoice_line_item_pbv2_snapshot");
});

test("invoice snapshots preserve the PBV2 terms that the migration makes durable", () => {
  const schema = read("shared/schema.ts");
  const invoicesService = read("server/invoicesService.ts");
  const migrationRunner = read("server/runMigrations.ts");

  expect(schema).toContain('pbv2SnapshotJson: jsonb("pbv2_snapshot_json").$type<Record<string, any>>(),');
  expect(invoicesService).toContain("pbv2SnapshotJson: li.pbv2SnapshotJson ?? null,");
  expect(migrationRunner).toContain('table: "invoice_line_items", column: "pbv2_snapshot_json", label: "invoice_line_items.pbv2_snapshot_json"');
});

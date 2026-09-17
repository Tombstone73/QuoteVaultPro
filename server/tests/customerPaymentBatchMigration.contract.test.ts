import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), "utf8");

test("customer payment batch migration is registered, protected, and guarded at startup", () => {
  const journal = JSON.parse(read("server/db/migrations_v2/meta/_journal.json"));
  const entries = journal.entries as Array<{ idx: number; when: number; tag: string }>;
  const migration = entries.find((entry) => entry.tag === "0205_customer_payment_batches");
  const previous = entries.find((entry) => entry.tag === "0204_quick_note_direct_print");

  expect(migration).toEqual(expect.objectContaining({ idx: 206, when: 1788048000052 }));
  expect(previous).toBeDefined();
  expect(migration!.when).toBeGreaterThan(previous!.when);
  expect(entries.map((entry) => entry.tag)).toContain("0205_customer_payment_batches");

  const manifest = JSON.parse(read("server/db/migrations_v2/meta/_history-integrity.json"));
  expect(manifest.immutableThrough).toEqual({ idx: 206, when: 1788048000052, tag: "0205_customer_payment_batches" });

  const sql = read("server/db/migrations_v2/0205_customer_payment_batches.sql");
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS customer_payment_batches");
  expect(sql).toContain("ADD COLUMN IF NOT EXISTS customer_payment_batch_id");
  expect(sql).toContain("payments_customer_payment_batch_id_idx");
  expect(read("shared/schema.ts")).toContain('varchar("customer_payment_batch_id")');

  const runner = read("server/runMigrations.ts");
  expect(runner).toContain('table: "customer_payment_batches"');
  expect(runner).toContain('column: "customer_payment_batch_id"');
  expect(runner).toContain('index: "payments_customer_payment_batch_id_idx"');
});

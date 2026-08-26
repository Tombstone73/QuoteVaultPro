import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@jest/globals";

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

test("0188 initializes shared Job Numbers with bounded legacy parsing and preserves nullable history", () => {
  const migration = read("server/db/migrations_v2/0188_shared_commercial_job_numbering.sql");

  expect(migration).toContain("ADD COLUMN IF NOT EXISTS job_number integer");
  expect(migration).toContain("ADD COLUMN IF NOT EXISTS invoice_sequence integer");
  expect(migration).toContain("[0-9]{1,10}");
  expect(migration).toContain("2147483647");
  expect(migration).toContain("shared Job Number counter exceeds PostgreSQL integer range");
  expect(migration).toContain("DROP INDEX IF EXISTS invoices_org_number_core_unique");
  expect(migration).not.toContain("(?i:");
  expect(migration).toContain("substring(upper(display_number) FROM '^QT[-_ ]?([0-9]{1,10})$')");
  expect(migration).toContain("substring(upper(display_number) FROM '^ORD(?:ER)?[-_ ]?([0-9]{1,10})$')");
  expect(migration).toContain("substring(upper(display_number) FROM '^INV[-_ ]?([0-9]{1,10})(?:-[0-9]+)?$')");
});

test("release checks verify the Job Number columns and indexes required after migration 0188", () => {
  const runner = read("server/runMigrations.ts");

  expect(runner).toContain('quotes_org_job_number_unique');
  expect(runner).toContain('orders_org_job_number_unique');
  expect(runner).toContain('invoices_org_job_sequence_unique');
  expect(runner).toContain('invoices_org_number_core_unique index removed');
});

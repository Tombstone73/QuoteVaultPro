import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { resolve } from "path";

const migrationSql = readFileSync(
  resolve(process.cwd(), "server/db/migrations_v2/0088_bug_report_reference_numbers.sql"),
  "utf8",
);

describe("bug report reference number migration", () => {
  test("adds permanent indexed globally unique reference number column", () => {
    expect(migrationSql).toContain("ADD COLUMN IF NOT EXISTS reference_number text");
    expect(migrationSql).toContain("ALTER COLUMN reference_number SET NOT NULL");
    expect(migrationSql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS bug_reports_reference_number_uidx");
    expect(migrationSql).toContain("ON bug_reports (reference_number)");
  });

  test("backfills oldest first with separate bug and feature counters", () => {
    expect(migrationSql).toContain("PARTITION BY type");
    expect(migrationSql).toContain("ORDER BY created_at ASC, id ASC");
    expect(migrationSql).toContain("'F-' || lpad");
    expect(migrationSql).toContain("'B-' || lpad");
  });

  test("creates separate global sequences and immutable assignment triggers", () => {
    expect(migrationSql).toContain("CREATE SEQUENCE IF NOT EXISTS bug_reports_bug_reference_seq");
    expect(migrationSql).toContain("CREATE SEQUENCE IF NOT EXISTS bug_reports_feature_reference_seq");
    expect(migrationSql).toContain("assign_bug_report_reference_number");
    expect(migrationSql).toContain("prevent_bug_report_reference_number_update");
    expect(migrationSql).toContain("bug_reports.reference_number is immutable once assigned");
  });
});

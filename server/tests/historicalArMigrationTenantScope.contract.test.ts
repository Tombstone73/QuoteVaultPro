import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("unshipped historical A/R migration tenant dry-run", () => {
  it("performs no unscoped data backfill or cross-tenant invoice mutation", () => {
    const migration = readFileSync(path.resolve(process.cwd(), "server/db/migrations_v2/0223_historical_ar_authority.sql"), "utf8");
    expect(migration).toMatch(/ALTER TABLE invoices ADD COLUMN IF NOT EXISTS historical_ar_state/);
    expect(migration).toMatch(/ON invoices\(organization_id, historical_ar_state\)/);
    expect(migration).not.toMatch(/^\s*(?:UPDATE|DELETE|INSERT|MERGE|TRUNCATE)\b/im);
  });
});

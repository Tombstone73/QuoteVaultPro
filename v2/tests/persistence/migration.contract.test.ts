import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("V2 M0 foundation migration", () => {
  test("is append-only and creates only additive V2 infrastructure", () => {
    const migration = read("server/db/migrations_v2/0180_v2_foundation_persistence.sql");
    expect(migration).toContain("CREATE TABLE v2_operation_requests");
    expect(migration).toContain("CREATE TABLE v2_principal_attributions");
    expect(migration).toContain("CREATE TABLE v2_outbox_messages");
    expect(migration).not.toMatch(/ALTER\s+TABLE\s+(orders|invoices|customers|quotes)/i);
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX)/i);
    expect(migration).toContain("UNIQUE (organization_id, operation, business_request_id)");
    expect(migration).toContain("UNIQUE (organization_id, event_type, aggregate_type, aggregate_id, idempotency_key)");
  });

  test("is the next strictly appended journal entry", () => {
    const journal = JSON.parse(read("server/db/migrations_v2/meta/_journal.json")) as { entries: Array<{ idx: number; when: number; tag: string }> };
    const last = journal.entries.at(-1);
    const previous = journal.entries.at(-2);
    expect(last).toMatchObject({ idx: 181, when: 1788048000027, tag: "0180_v2_foundation_persistence" });
    expect(last!.when).toBeGreaterThan(previous!.when);
  });
});

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("default-on customer portal contract", () => {
  const access = source("server/services/customerPortalAccessService.ts");
  const auth = source("server/localAuth.ts");
  const migration = source("server/db/migrations_v2/0192_customer_portal_default_on_guest_invoice_payment.sql");
  const schema = source("shared/schema.ts");

  test("migrates legacy rollout disables to enabled without restoring suspended access", () => {
    expect(migration).toContain("ALTER COLUMN state SET DEFAULT 'enabled'");
    expect(migration).toContain("WHERE state = 'disabled'");
    expect(migration).toContain("state = 'enabled'");
    expect(migration).not.toContain("WHERE state = 'suspended'");
    expect(schema).toContain('.default("enabled").$type<"disabled" | "enabled" | "suspended">()');
  });

  test("starts first-time password setup only for one exact active customer-contact identity", () => {
    expect(access).toContain("startDefaultPortalPasswordSetup");
    expect(access).toContain("matches.length !== 1");
    expect(access).toContain("eq(customerContactLinks.status, \"active\")");
    expect(access).toContain("contactStatus || \"active\") !== \"active\"");
    expect(access).toContain('existing?.status === "DISABLED"');
    expect(access).toContain('existing?.status === "SUSPENDED"');
    expect(auth).toContain("startDefaultPortalPasswordSetup");
  });
});

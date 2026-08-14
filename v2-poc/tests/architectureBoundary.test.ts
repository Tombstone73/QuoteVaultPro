import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";

const source = (path: string) => fs.readFileSync(path, "utf8");

describe("V2 canonical authority boundaries", () => {
  test("the representative order and quote application operations do not contain staff membership SQL", () => {
    for (const path of ["v2-poc/src/postgres/postgresOrderCreate.ts", "v2-poc/src/postgres/postgresQuoteConversion.ts"]) {
      expect(source(path)).not.toMatch(/user_organizations/i);
    }
    expect(source("v2-poc/src/authorization/postgresPrincipalContext.ts")).toMatch(/user_organizations/i);
  });

  test("policy is persistence-free and adapters cannot perform business persistence", () => {
    const policy = source("v2-poc/src/authorization/authorityPolicy.ts");
    expect(policy).not.toMatch(/from\s+["']pg["']|\bquery\s*\(|\bselect\b|\binsert\b|\bupdate\b|\bdelete\b/i);
    const adapters = source("v2-poc/src/interfaces/convergence.ts");
    expect(adapters).not.toMatch(/postgres|drizzle|server\/services|\bquery\s*\(|\bselect\b|\binsert\b|\bupdate\b|\bdelete\b/i);
  });

  test("principal helpers leave portal and service without a fabricated staff actor", async () => {
    const { staffActor } = await import("../src/authorization/authorityPolicy");
    expect(staffActor({ kind: "portal", organizationId: "o", customerId: "c", portalSubjectId: "p", capabilities: ["quotes.convert"] })).toBeNull();
    expect(staffActor({ kind: "service", organizationId: "o", clientId: "s", capabilities: ["orders.create"] })).toBeNull();
  });
});

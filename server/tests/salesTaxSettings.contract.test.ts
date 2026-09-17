import { expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

test("organization sales tax settings are owner/admin guarded and persist decimal rates", () => {
  const routes = read("server/routes/organization.routes.ts");
  expect(routes).toContain("app.get('/api/organization/tax-settings', isAuthenticated, tenantContext, requireOrgOwnerAdmin");
  expect(routes).toContain("app.patch('/api/organization/tax-settings', isAuthenticated, tenantContext, requireOrgOwnerAdmin");
  expect(routes).toContain("defaultTaxRate: z.number().finite().min(0).max(0.3)");
  expect(routes).toContain("defaultTaxRate: parsed.data.defaultTaxRate.toFixed(4)");
});

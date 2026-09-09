import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@jest/globals";

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

test("QuickBooks console APIs require the existing tenant Admin-or-Owner capability", () => {
  const routes = read("server/routes/quickbooks.routes.ts");
  for (const endpoint of ["status", "queue", "queue/items", "flush", "jobs", "jobs/:id"]) {
    expect(routes).toContain(`/api/integrations/quickbooks/${endpoint}', isAuthenticated, tenantContext, isAdminOrOwner`);
  }
  expect(routes).toContain("queue/enqueue-selected', isAuthenticated, tenantContext, isAdminOrOwner");
  expect(routes).toContain("queue/sync-selected', isAuthenticated, tenantContext, isAdminOrOwner");
  expect(routes).toContain("syncMode: 'manual_force'");
});

test("QuickBooks UI uses the active organization role and one canonical settings console", () => {
  const integrations = read("client/src/pages/settings/integrations.tsx");
  const queue = read("client/src/pages/settings/quickbooks-sync-queue.tsx");
  const app = read("client/src/App.tsx");
  expect(integrations).toContain("useActiveOrganizationRole({ enabled: Boolean(user) })");
  expect(integrations).toContain("!isLoadingOrganizationRole && !isAdminOrOwner");
  expect(queue).toContain("!isLoadingOrganizationRole && !isAdminOrOwner");
  expect(app).toContain('<Route path="integrations" element={<SettingsIntegrations />} />');
});

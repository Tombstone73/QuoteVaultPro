import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "@jest/globals";

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("status settings route contract", () => {
  const routes = read("server/routes/orders.routes.ts");

  test("the status catalog has a protected all-record settings view without changing the active Orders view", () => {
    expect(routes).toContain('app.get(["/api/orders/status-pills", "/api/order-status-pills"]');
    expect(routes).toContain("listStatusPills(organizationId, stateScope as any, true)");
    expect(routes).toContain('app.get("/api/settings/order-status-pills", isAuthenticated, tenantContext, isAdminOrOwner');
    expect(routes).toContain("listStatusPills(organizationId, undefined, false)");
  });

  test("workflow mapping list and update endpoints are tenant- and admin-scoped", () => {
    expect(routes).toContain('app.get("/api/settings/workflow-status-pill-mappings", isAuthenticated, tenantContext, isAdminOrOwner');
    expect(routes).toContain('app.patch("/api/settings/workflow-status-pill-mappings/:triggerKey", isAuthenticated, tenantContext, isAdminOrOwner');
    expect(routes).toContain("upsertWorkflowStatusPillMapping({ organizationId, triggerKey, ...payload })");
  });

  test("status mutation routes share the owner/admin settings permission boundary", () => {
    expect(routes).toContain('app.patch("/api/orders/status-pills/:pillId", isAuthenticated, tenantContext, isAdminOrOwner');
  });
});

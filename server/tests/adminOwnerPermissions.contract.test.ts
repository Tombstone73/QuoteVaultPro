import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("admin and owner permission contract", () => {
  test("saved order line item mutations use the shared owner/admin operational guard", () => {
    const routes = read("server/routes/orders.routes.ts");

    expect(routes).toContain('app.post("/api/order-line-items", isAuthenticated, tenantContext, isAdminOrOwner');
    expect(routes).toContain('app.post("/api/order-line-items/:id/production-bypass", isAuthenticated, tenantContext, isAdminOrOwner');
    expect(routes).toContain('app.patch("/api/order-line-items/:id/parent", isAuthenticated, tenantContext, isAdminOrOwner');
    expect(routes).toContain('app.patch("/api/order-line-items/:id", isAuthenticated, tenantContext, requireOrderLineItemAdminOrOwner');
    expect(routes).toContain("LINE_ITEM_EDIT_LOCKED_STATES");
    expect(routes).toContain("Cannot edit line items on a cancelled order.");
  });

  test("saved order line-item mutations use the tenantContext organization role", () => {
    const routes = read("server/routes/orders.routes.ts");

    expect(routes).toContain("const requireOrderLineItemAdminOrOwner");
    expect(routes).toContain("req.actorOrgRole ?? req.orgRole");
    expect(routes).toContain("Organization Admin or Owner role required.");
  });

  test("Settings route registrations retain the owner/admin membership guard", () => {
    const routes = read("server/routes.ts");

    expect(routes).toContain("registerCompanySettingsRoutes(app, { isAuthenticated, tenantContext, requireOrgOwnerAdmin });");
    expect(routes).toContain("registerCatalogSettingsRoutes(app, { isAuthenticated, tenantContext, isAdmin: requireOrgAdmin, requireOrgOwnerAdmin });");
    expect(routes).toContain("registerAdminStorageRoutes(app, { isAuthenticated, tenantContext, isAdmin: requireOrgAdmin, requireOrgOwnerAdmin });");
  });

  test("Admin Tools danger-zone endpoints are owner-only after tenant role resolution", () => {
    const routes = read("server/routes/organization.routes.ts");

    expect(routes).toContain("hasOwnerOnlyAdminToolsRole");
    expect(routes).toContain("const adminToolsGuards = [isAuthenticated, tenantContext, requireOrgOwnerAdmin, requireAdminToolsOwner]");
    expect(routes).toContain('app.post("/api/admin/org/reset", ...adminToolsGuards');
    expect(routes).toContain('app.post("/api/admin/org/reset-quickbooks-import", ...adminToolsGuards');
    expect(routes).toContain('app.post("/api/admin/org/disable", ...adminToolsGuards');
    expect(routes).toContain('app.delete("/api/admin/org", ...adminToolsGuards');
  });
});

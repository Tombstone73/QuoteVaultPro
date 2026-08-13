import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import { hasAdminOrOwnerOperationalRole, hasOwnerOnlyAdminToolsRole } from "@shared/roleAccess";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("tenant authorization role source contract", () => {
  test("membership roles are evaluated independently of global identity roles", () => {
    // The caller supplies only the active membership role. The same identity can
    // therefore be Admin in Org A and Member in Org B without authority leaking.
    expect(hasAdminOrOwnerOperationalRole("admin")).toBe(true);
    expect(hasAdminOrOwnerOperationalRole("owner")).toBe(true);
    expect(hasAdminOrOwnerOperationalRole("member")).toBe(false);
    expect(hasOwnerOnlyAdminToolsRole("owner")).toBe(true);
    expect(hasOwnerOnlyAdminToolsRole("admin")).toBe(false);
  });

  test("tenant router wiring uses active organization guards, while platform auth remains separate", () => {
    const routes = read("server/routes.ts");
    const platformRoutes = read("server/routes/platform.ts");

    expect(routes).toContain("const requireOrgAdminOrOwner");
    expect(routes).toContain("req.actorOrgRole ?? req.orgRole");
    expect(routes).toContain("isAdmin: requireOrgAdmin");
    expect(routes).toContain("isAdminOrOwner: requireOrgAdminOrOwner");
    expect(routes).toContain("isOwner: requireOrgOwner");
    expect(platformRoutes).toContain("isPlatformAdmin");
  });

  test("Quote, Order, organization, fulfillment, and portal operations do not use global roles for tenant authority", () => {
    const quotes = read("server/routes/quotes.routes.ts");
    const orders = read("server/routes/orders.routes.ts");
    const organization = read("server/routes/organization.routes.ts");
    const fulfillment = read("server/routes/fulfillment.routes.ts");
    const portalFollowUps = read("server/routes/portalFollowUps.routes.ts");

    expect(quotes).toContain("normalizeRole(req.actorOrgRole ?? req.orgRole)");
    expect(quotes).not.toContain("const userRole = req.user.role");
    expect(orders).toContain("const userRole = String(req.actorOrgRole ?? req.orgRole ?? '').toLowerCase()");
    expect(fulfillment).toContain("req.actorOrgRole ?? req.orgRole");
    expect(organization).toContain("const role = req.actorOrgRole ?? req.orgRole;");
    expect(portalFollowUps).not.toContain("user.isAdmin");
    expect(portalFollowUps).not.toContain("globalRole");
  });

  test("Quote approval UI and organization switching derive and refresh membership authority", () => {
    const activeRoleHook = read("client/src/hooks/useActiveOrganizationRole.ts");
    const approvals = read("client/src/pages/ApprovalsPage.tsx");
    const workflowActions = read("client/src/components/QuoteWorkflowActions.tsx");
    const switcher = read("client/src/components/OrgSwitcher.tsx");
    const selector = read("client/src/pages/SelectOrgPage.tsx");

    expect(activeRoleHook).toContain("lastActiveOrgId");
    expect(activeRoleHook).not.toContain("user.role");
    expect(approvals).toContain("useActiveOrganizationRole");
    expect(workflowActions).toContain("useActiveOrganizationRole");
    expect(switcher).toContain("queryClient.clear()");
    expect(selector).toContain("queryClient.clear()");
  });

  test("legacy product mutations now establish tenant context and product ownership before org-admin checks", () => {
    const products = read("server/routes/products.routes.ts");
    const attachments = read("server/routes/attachments.routes.ts");

    expect(products).toContain('app.post("/api/products/:id/options", isAuthenticated, tenantContext, isAdmin');
    expect(products).toContain('app.patch("/api/products/:productId/variants/:id", isAuthenticated, tenantContext, isAdmin');
    expect(products).toContain("eq(productOptions.productId, req.params.productId)");
    expect(products).toContain("eq(productVariants.productId, req.params.productId)");
    expect(attachments).toContain("platformIsAdmin");
  });
});

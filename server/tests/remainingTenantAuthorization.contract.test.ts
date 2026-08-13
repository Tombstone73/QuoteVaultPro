import fs from "node:fs";
import path from "node:path";

import { hasAdminOrOwnerOperationalRole, normalizeRole } from "../../shared/roleAccess";

describe("remaining tenant authorization hardening", () => {
  const root = process.cwd();
  const productionRuns = fs.readFileSync(path.join(root, "server/routes/productionRuns.routes.ts"), "utf8");
  const prepressFiles = fs.readFileSync(path.join(root, "server/routes/prepressFiles.routes.ts"), "utf8");
  const inbound = fs.readFileSync(path.join(root, "server/routes/inboundOrders.routes.ts"), "utf8");
  const email = fs.readFileSync(path.join(root, "server/routes/email.routes.ts"), "utf8");
  const reminderRoute = fs.readFileSync(path.join(root, "server/routes/mvpInvoicing.routes.ts"), "utf8");
  const reminderJob = fs.readFileSync(path.join(root, "server/invoiceReminderJob.ts"), "utf8");
  const portalAccess = fs.readFileSync(path.join(root, "server/routes/customerPortalAccess.routes.ts"), "utf8");
  const attachments = fs.readFileSync(path.join(root, "server/routes/attachments.routes.ts"), "utf8");

  test("active organization Admin authority does not inherit or lose global identity roles", () => {
    expect(hasAdminOrOwnerOperationalRole(normalizeRole("admin"))).toBe(true);
    expect(hasAdminOrOwnerOperationalRole(normalizeRole("member"))).toBe(false);
    expect(hasAdminOrOwnerOperationalRole(normalizeRole("employee"))).toBe(false);
  });

  test("production-run and prepress recovery use only the active organization role", () => {
    expect(productionRuns).toContain("normalizeRole(req.actorOrgRole ?? req.orgRole)");
    expect(productionRuns).toContain("hasAdminOrOwnerOperationalRole(actorRole(req))");
    expect(productionRuns).not.toContain("req.user?.isAdmin === true");
    expect(prepressFiles).toContain("normalizeRole(req.actorOrgRole ?? req.orgRole)");
    expect(prepressFiles).toContain("hasAdminOrOwnerOperationalRole(actorRole)");
    expect(prepressFiles).not.toContain("req.user?.isAdmin === true");
  });

  test("inbound mailbox administration and email staff behavior use tenant membership", () => {
    expect(inbound).toContain("hasAdminOrOwnerOperationalRole(String(req.actorOrgRole ?? req.orgRole ?? \"\"))");
    expect(inbound).not.toContain("const role = req.user?.role");
    expect(email.match(/normalizeRole\(req\.actorOrgRole \?\? req\.orgRole\)/g)).toHaveLength(2);
    expect(email).not.toContain("const userRole = req.user.role");
  });

  test("manual reminder runs are owner/admin scoped and process only the active organization", () => {
    expect(reminderRoute).toContain("[isAuthenticated, tenantContext, requireOrgOwnerAdmin]");
    expect(reminderRoute).toContain("runInvoiceReminderJob(new Date(), undefined, organizationId)");
    expect(reminderJob).toContain("organizationId?: string");
    expect(reminderJob).toContain("getInvoiceReminderSettingsForOrg(organizationId)");
  });

  test("portal management remains organization-scoped while legacy object ACL remains platform-only", () => {
    expect(portalAccess).toContain("deps.requireOrgOwnerAdmin");
    expect(attachments).toContain('app.post("/api/objects/acl", isAuthenticated, platformIsAdmin');
    expect(attachments).toContain("Object paths are not tenant-scoped by this legacy endpoint");
  });
});

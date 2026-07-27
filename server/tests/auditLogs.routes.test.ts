import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

const source = fs.readFileSync(path.resolve(process.cwd(), "server/routes/timeline.routes.ts"), "utf8");

describe("audit log route tenant scope", () => {
  test("passes the authenticated tenant to the tenant-scoped repository", () => {
    expect(source).toContain('app.get("/api/audit-logs", isAuthenticated, tenantContext, isOwner');
    expect(source).toContain("const organizationId = getRequestOrganizationId(req);");
    expect(source).toContain("storage.getAuditLogs(organizationId, filters)");
  });
});

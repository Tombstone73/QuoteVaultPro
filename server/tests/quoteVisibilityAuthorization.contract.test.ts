import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("Quote visibility authorization contract", () => {
  test("list and CSV export use the active organization role, never the global user role", () => {
    const routes = read("server/routes/quotes.routes.ts");
    const listRoute = routes.slice(routes.indexOf('app.get("/api/quotes",'), routes.indexOf('app.get("/api/quotes/export.csv"'));
    const exportRoute = routes.slice(routes.indexOf('app.get("/api/quotes/export.csv"'), routes.indexOf('app.get("/api/quotes/:id/pdf"'));

    expect(listRoute).toContain("normalizeRole(req.actorOrgRole ?? req.orgRole)");
    expect(exportRoute).toContain("normalizeRole(req.actorOrgRole ?? req.orgRole)");
    expect(listRoute).not.toContain("req.user.role");
    expect(exportRoute).not.toContain("req.user.role");
  });

  test("repository gives only owner and admin tenant-wide visibility while retaining tenant scope", () => {
    const repository = read("server/storage/quotes.repo.ts");

    expect(repository).toContain("const conditions = [eq(quotes.organizationId, organizationId)]");
    expect(repository).toContain("['owner', 'admin'].includes(filters.userRole)");
    expect(repository).toContain("conditions.push(eq(quotes.userId, userId))");
  });
});
